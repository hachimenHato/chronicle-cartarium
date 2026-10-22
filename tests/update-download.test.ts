import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  createUpdateDownloader,
  isPublicUpdateAddress,
  validateUpdateUrl,
} from '../server/update-download';

const PUBLIC = [{ address: '93.184.216.34', family: 4 }];
const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

interface Reply {
  status?: number;
  headers?: Record<string, string>;
  chunks?: (string | Buffer)[];
  hang?: boolean;
  delay?: number;
  fail?: Error;
}

function transport(replies: Reply[]) {
  const calls: RequestOptions[] = [];
  const responses: PassThrough[] = [];
  const requests: EventEmitter[] = [];
  const request = (settings: RequestOptions, callback: (response: IncomingMessage) => void) => {
    calls.push(settings);
    const reply = replies.shift();
    assert(reply, 'unexpected outbound request');
    const outgoing = new EventEmitter() as EventEmitter & {
      destroyed: boolean;
      end(): void;
      destroy(): void;
    };
    outgoing.destroyed = false;
    requests.push(outgoing);
    let timer: NodeJS.Timeout | undefined;
    outgoing.destroy = () => {
      outgoing.destroyed = true;
      clearTimeout(timer);
      return outgoing;
    };
    outgoing.end = () => {
      queueMicrotask(() => {
        if (outgoing.destroyed) return;
        const incoming = new PassThrough() as PassThrough & {
          statusCode: number;
          headers: Record<string, string>;
        };
        incoming.statusCode = reply.status ?? 200;
        incoming.headers = reply.headers ?? {};
        responses.push(incoming);
        callback(incoming as unknown as IncomingMessage);
        const chunks = [...(reply.chunks ?? [])];
        const send = () => {
          if (incoming.destroyed || outgoing.destroyed) return;
          const chunk = chunks.shift();
          if (chunk !== undefined) {
            incoming.write(chunk);
            timer = setTimeout(send, reply.delay ?? 0);
          } else if (reply.fail) incoming.destroy(reply.fail);
          else if (!reply.hang) incoming.end();
        };
        timer = setTimeout(send, reply.delay ?? 0);
      });
    };
    return outgoing as unknown as ClientRequest;
  };
  return { request, calls, responses, requests };
}

async function directory(t: { after(fn: () => Promise<unknown>): void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cartarium-update-download-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('address checks reject private, special-use and mapped private networks', () => {
  for (const address of [
    '0.0.0.0',
    '0.2.3.4',
    '10.2.3.4',
    '100.64.1.2',
    '100.127.255.254',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.1.1',
    '172.31.255.255',
    '192.0.0.9',
    '192.0.2.1',
    '192.88.99.1',
    '192.168.0.1',
    '198.18.1.1',
    '198.19.255.255',
    '198.51.100.2',
    '203.0.113.2',
    '224.1.2.3',
    '239.255.255.255',
    '240.1.2.3',
    '255.255.255.255',
    '::',
    '::1',
    '::127.0.0.1',
    'fc00::1',
    'fdff::1',
    'fe80::1',
    'ff02::1',
    'fe80::1%eth0',
    '2001:db8::1',
    '2001:2::1',
    '2001::1',
    '2002:a00:1::1',
    '3fff:100::1',
    '64:ff9b::a00:1',
    '::ffff:127.0.0.1',
    '::ffff:a00:1',
    '::ffff:192.168.1.1',
    '::ffff:7f00:1',
    '::ffff:203.0.113.1',
    'not-an-ip',
  ])
    assert.equal(isPublicUpdateAddress(address), false, address);
  for (const address of [
    '1.1.1.1',
    '8.8.8.8',
    '93.184.216.34',
    '100.128.0.1',
    '172.32.0.1',
    '2606:4700:4700::1111',
    '2001:4860:4860::8888',
    '::ffff:8.8.8.8',
    '::ffff:808:808',
  ])
    assert.equal(isPublicUpdateAddress(address), true, address);
});

test('URL validation rejects ambiguous/local addresses, credentials and untrusted queries', () => {
  for (const raw of [
    'http://example.org/a',
    'file:///a',
    'https://',
    'https:example.org/a',
    'https:///example.org/a',
    'https://user:pass@example.org/a',
    'https://user@example.org/a',
    'https://@example.org/a',
    'https://:@example.org/a',
    'https://example.org/a#',
    'https://example.org/a#part',
    'https://localhost/a',
    'https://machine.local/a',
    'https://a.localhost/a',
    'https://127.0.0.1/a',
    'https://2130706433/a',
    'https://0x7f000001/a',
    'https://[::ffff:127.0.0.1]/a',
    ' https://example.org/a',
    'https://example.org/a\n',
    'https://example.org\\@127.0.0.1/a',
    'https://example.org/a?token=secret',
    'https://example.org/a?',
    'https://objects.githubusercontent.com.evil.org/a?sig=a',
  ])
    assert.throws(() => validateUpdateUrl(raw), Error, raw);
  assert.equal(
    validateUpdateUrl('https://api.github.com/repos/a/b/releases').hostname,
    'api.github.com',
  );
  assert.equal(
    validateUpdateUrl('https://release-assets.githubusercontent.com/a?sig=abc').search,
    '?sig=abc',
  );
});

test('all DNS results must be public, with no request on mixed private/public answers', async () => {
  const fake = transport([]);
  const client = createUpdateDownloader({
    request: fake.request,
    lookup: async () => [...PUBLIC, { address: '127.0.0.1', family: 4 }],
  });
  await assert.rejects(client.readUpdateJson('https://mirror.example/releases.json'), /非公开/);
  assert.equal(fake.calls.length, 0);
});

test('request pins the validated address, keeps original TLS name and sends no credentials', async () => {
  const fake = transport([{ chunks: ['{"ok":true}'] }]);
  let lookups = 0;
  const client = createUpdateDownloader({
    request: fake.request,
    lookup: async () => {
      lookups++;
      return PUBLIC;
    },
  });
  assert.deepEqual(await client.readUpdateJson('https://mirror.example/releases.json'), {
    ok: true,
  });
  assert.equal(lookups, 1);
  const settings = fake.calls[0];
  assert.equal(settings.hostname, 'mirror.example');
  assert.equal(settings.servername, 'mirror.example');
  assert.equal(settings.rejectUnauthorized, true);
  assert.equal(settings.agent, false);
  const pinned = settings.lookup as Function;
  pinned('attacker-controlled.example', {}, (error: unknown, address: string, family: number) => {
    assert.equal(error, null);
    assert.equal(address, PUBLIC[0].address);
    assert.equal(family, 4);
  });
  pinned('mirror.example', { all: true }, (error: unknown, addresses: unknown) => {
    assert.equal(error, null);
    assert.deepEqual(addresses, PUBLIC);
  });
  assert.deepEqual(Object.keys(settings.headers ?? {}).sort(), [
    'Accept',
    'Accept-Encoding',
    'User-Agent',
  ]);
});

test('redirects are checked per hop, limited to five, and discarded streams are destroyed', async () => {
  const replies: Reply[] = Array.from({ length: 5 }, (_, i) => ({
    status: 302,
    headers: { location: `https://cdn${i}.example/package` },
    hang: true,
  }));
  const fake = transport([...replies, { chunks: ['{}'] }]);
  let lookups = 0;
  const client = createUpdateDownloader({
    request: fake.request,
    lookup: async () => {
      lookups++;
      return PUBLIC;
    },
  });
  assert.deepEqual(await client.readUpdateJson('https://mirror.example/start'), {});
  assert.equal(lookups, 6);
  assert(fake.responses.every((response) => response.destroyed));
  const signed = transport([
    {
      status: 302,
      headers: { location: 'https://release-assets.githubusercontent.com/file?sig=temporary' },
    },
    { chunks: ['{}'] },
  ]);
  assert.deepEqual(
    await createUpdateDownloader({
      request: signed.request,
      lookup: async () => PUBLIC,
    }).readUpdateJson('https://github.com/owner/repo/releases/download/v1/file'),
    {},
  );
  assert.equal(signed.calls[1].path, '/file?sig=temporary');
  const tooMany = transport([...replies, replies[0]]);
  await assert.rejects(
    createUpdateDownloader({ request: tooMany.request, lookup: async () => PUBLIC }).readUpdateJson(
      'https://mirror.example/start',
    ),
    /重定向次数/,
  );
  for (const location of [
    'http://public.example/a',
    'https://[::ffff:10.0.0.1]/a',
    'https://private.example/a',
    'https://user:secret@example.org/a',
  ]) {
    const bad = transport([{ status: 302, headers: { location }, hang: true }]);
    const restricted = createUpdateDownloader({
      request: bad.request,
      lookup: async (host) =>
        host === 'private.example' ? [{ address: '10.0.0.1', family: 4 }] : PUBLIC,
    });
    await assert.rejects(restricted.readUpdateJson('https://mirror.example/start'));
    assert.equal(bad.calls.length, 1);
    assert(bad.responses[0].destroyed);
  }
});

test('JSON reads bound real bytes, verify declared length, and reject errors without consuming their body', async () => {
  const replies: Reply[] = [
    { chunks: [Buffer.alloc(1024 * 1024 + 1, 32)] },
    { headers: { 'content-length': String(1024 * 1024 + 1) }, hang: true },
    { headers: { 'content-length': '9' }, chunks: ['{}'] },
    { headers: { 'content-length': '-1' }, chunks: ['{}'] },
    { chunks: ['not-json'] },
    { status: 503, chunks: ['secret error details'], hang: true },
    { headers: { 'content-encoding': 'gzip' }, chunks: ['{}'] },
  ];
  for (const reply of replies) {
    const fake = transport([reply]);
    const client = createUpdateDownloader({ request: fake.request, lookup: async () => PUBLIC });
    await assert.rejects(client.readUpdateJson('https://mirror.example/releases.json'));
    assert(fake.responses[0].destroyed);
  }
  const content = Buffer.from('{"中文":"正常"}');
  const fake = transport([{ chunks: [content.subarray(0, 4), content.subarray(4)] }]);
  assert.deepEqual(
    await createUpdateDownloader({
      request: fake.request,
      lookup: async () => PUBLIC,
    }).readUpdateJson('https://mirror.example/releases.json'),
    { 中文: '正常' },
  );
});

test('download writes and verifies a streamed package with monotonic progress', async (t) => {
  const root = await directory(t);
  const content = Buffer.from('signed release content');
  const fake = transport([
    {
      headers: { 'content-length': String(content.length) },
      chunks: [content.subarray(0, 5), content.subarray(5)],
    },
  ]);
  const client = createUpdateDownloader({ request: fake.request, lookup: async () => PUBLIC });
  const progress: number[] = [];
  const file = path.join(root, 'release.ccupdate');
  await client.downloadUpdateFile(
    'https://mirror.example/release.ccupdate',
    file,
    { bytes: content.length, sha256: sha256(content) },
    (bytes) => progress.push(bytes),
  );
  assert.deepEqual(await readFile(file), content);
  assert.deepEqual(progress, [0, 5, content.length]);
});

test('oversized, truncated, tampered and failed downloads remove only their own new file', async (t) => {
  const root = await directory(t);
  const content = 'good';
  const cases: Reply[] = [
    { chunks: ['too large'] },
    { headers: { 'content-length': '4' }, chunks: ['too large'] },
    { headers: { 'content-length': '4' }, chunks: ['a'] },
    { chunks: ['evil'] },
    { chunks: ['go'], fail: new Error('connection lost') },
    { headers: { 'content-length': '134217729' }, hang: true },
  ];
  for (const [i, reply] of cases.entries()) {
    const file = path.join(root, `${i}.ccupdate`);
    const fake = transport([reply]);
    const client = createUpdateDownloader({ request: fake.request, lookup: async () => PUBLIC });
    await assert.rejects(
      client.downloadUpdateFile(
        'https://mirror.example/a',
        file,
        { bytes: content.length, sha256: sha256(content) },
        () => {},
      ),
    );
    await assert.rejects(stat(file), { code: 'ENOENT' });
    assert(fake.responses[0].destroyed);
  }
  const file = path.join(root, 'existing.ccupdate');
  await writeFile(file, 'preserve');
  const fake = transport([]);
  const client = createUpdateDownloader({
    request: fake.request,
    lookup: async () => {
      assert.fail('must not resolve for an existing file');
    },
  });
  await assert.rejects(
    client.downloadUpdateFile(
      'https://mirror.example/a',
      file,
      { bytes: 4, sha256: sha256(content) },
      () => {},
    ),
    { code: 'EEXIST' },
  );
  assert.equal(await readFile(file, 'utf8'), 'preserve');
  assert.equal(fake.calls.length, 0);
  await assert.rejects(
    client.downloadUpdateFile(
      'https://mirror.example/a',
      path.join(root, 'invalid'),
      { bytes: 128 * 1024 * 1024 + 1, sha256: sha256(content) },
      () => {},
    ),
    /大小/,
  );
});

test('cancellation stops active streams and removes incomplete files, including pre-abort', async (t) => {
  const root = await directory(t);
  const fake = transport([{ chunks: ['first'], hang: true }]);
  const abort = new AbortController();
  const client = createUpdateDownloader({ request: fake.request, lookup: async () => PUBLIC });
  const file = path.join(root, 'canceled.ccupdate');
  await assert.rejects(
    client.downloadUpdateFile(
      'https://mirror.example/a',
      file,
      { bytes: 10, sha256: sha256('firstlater') },
      (bytes) => {
        if (bytes) abort.abort();
      },
      abort.signal,
    ),
    { name: 'AbortError' },
  );
  await assert.rejects(stat(file), { code: 'ENOENT' });
  assert(fake.responses[0].destroyed);
  assert((fake.requests[0] as EventEmitter & { destroyed: boolean }).destroyed);
  await assert.rejects(
    client.downloadUpdateFile(
      'https://mirror.example/a',
      path.join(root, 'never-created'),
      { bytes: 10, sha256: sha256('firstlater') },
      () => {},
      abort.signal,
    ),
    { name: 'AbortError' },
  );
  await assert.rejects(stat(path.join(root, 'never-created')), { code: 'ENOENT' });
});

test('timeouts cover DNS, header wait, stream idleness and total transfer duration', async () => {
  const never = createUpdateDownloader({
    lookup: () => new Promise(() => {}),
    timeouts: { headersMs: 10, totalMs: 100 },
  });
  await assert.rejects(never.readUpdateJson('https://mirror.example/a'), /连接或响应超时/);
  let disconnected = false;
  const noHeaders = Object.assign(new EventEmitter(), {
    end() {
      return this;
    },
    destroy() {
      disconnected = true;
      return this;
    },
  });
  await assert.rejects(
    createUpdateDownloader({
      request: () => noHeaders as unknown as ClientRequest,
      lookup: async () => PUBLIC,
      timeouts: { headersMs: 10, totalMs: 100 },
    }).readUpdateJson('https://mirror.example/a'),
    /连接或响应超时/,
  );
  assert(disconnected);
  const idle = transport([{ hang: true }]);
  await assert.rejects(
    createUpdateDownloader({
      request: idle.request,
      lookup: async () => PUBLIC,
      timeouts: { idleMs: 10, totalMs: 100 },
    }).readUpdateJson('https://mirror.example/a'),
    /等待数据超时/,
  );
  const total = transport([{ chunks: Array(100).fill(' '), delay: 3 }]);
  await assert.rejects(
    createUpdateDownloader({
      request: total.request,
      lookup: async () => PUBLIC,
      timeouts: { idleMs: 100, totalMs: 20 },
    }).readUpdateJson('https://mirror.example/a'),
    /总时限/,
  );
});

test('cancellation interrupts pending DNS without starting a transport', async () => {
  const abort = new AbortController();
  let requested = false;
  const client = createUpdateDownloader({
    lookup: () => new Promise(() => {}),
    request: () => {
      requested = true;
      throw new Error('must not connect');
    },
  });
  const pending = client.readUpdateJson('https://mirror.example/a', abort.signal);
  abort.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(requested, false);
});
