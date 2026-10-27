import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { stat, writeFile } from 'node:fs/promises';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { RequestOptions } from 'node:https';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createPublicVerifier } from '../scripts/lib/cos-public-verifier';
import { CosPublishError, formatCosDiagnostic } from '../scripts/lib/cos-diagnostics';
import { createUpdateDownloader } from '../server/update-download';

const content = Buffer.from('synthetic public signed package contents');
const file = {
  bytes: content.length,
  sha256: createHash('sha256').update(content).digest('hex'),
};
const url = 'https://mirror.example/chronicle-cartarium/updates/v1/package.ccupdate';
const secret = 'FAKE_PUBLIC_VERIFIER_PRIVATE_MARKER';
const problem = (code: string, message = secret) =>
  Object.assign(new Error(message), {
    code,
    headers: { Authorization: secret },
    url: `https://not-contacted.example/?signature=${secret}`,
    cause: new Error(secret),
  });
async function removed(paths: string[]) {
  assert.equal(new Set(paths.map((value) => path.dirname(value))).size, paths.length);
  for (const value of paths) await assert.rejects(stat(path.dirname(value)), { code: 'ENOENT' });
}
function safe(error: unknown, expected: string) {
  assert(error instanceof CosPublishError);
  assert.equal(formatCosDiagnostic(error), expected);
  assert.doesNotMatch(
    `${JSON.stringify(error)} ${error.stack}`,
    /FAKE_PUBLIC_VERIFIER|signature=|Authorization/,
  );
  assert.equal('cause' in error, false);
  assert.equal('url' in error, false);
  assert.equal('headers' in error, false);
  return true;
}

test('anonymous readback retries only known network, timeout and temporary HTTP failures in new directories', async () => {
  const errors = [
    ...[
      'ECONNRESET',
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'EAI_AGAIN',
      'ENETUNREACH',
      'EPIPE',
      'ERR_STREAM_PREMATURE_CLOSE',
    ].map((code) => problem(code)),
    ...[
      '更新下载超过总时限',
      '更新服务器连接或响应超时',
      '更新下载等待数据超时',
      '更新包传输不完整',
      '更新服务器返回 HTTP 408',
      '更新服务器返回 HTTP 429',
      '更新服务器返回 HTTP 503',
    ].map((message) => new Error(message)),
  ];
  for (const error of errors) {
    const paths: string[] = [],
      pauses: number[] = [],
      retries: number[] = [];
    const verify = createPublicVerifier({
      download: async (actualUrl, target, expected) => {
        assert.equal(actualUrl, url);
        assert.deepEqual(expected, file);
        paths.push(target);
        await writeFile(target, content, { flag: 'wx' });
        if (paths.length === 1) throw error;
      },
      wait: async (milliseconds) => {
        pauses.push(milliseconds);
      },
    });
    await verify(file, url, (attempt) => retries.push(attempt));
    assert.equal(paths.length, 2);
    assert.deepEqual(pauses, [3000]);
    assert.deepEqual(retries, [2]);
    await removed(paths);
  }
});

test('persistent readback network failure stops after three clean attempts with safe diagnostics', async () => {
  const paths: string[] = [],
    pauses: number[] = [],
    retries: number[] = [];
  const verify = createPublicVerifier({
    download: async (_url, target) => {
      paths.push(target);
      await writeFile(target, content.subarray(0, 3), { flag: 'wx' });
      throw problem('ECONNRESET');
    },
    wait: async (milliseconds) => {
      pauses.push(milliseconds);
    },
  });
  await assert.rejects(
    verify(file, url, (attempt) => retries.push(attempt)),
    (error) => safe(error, 'COS_PUBLIC_READ_NETWORK / ECONNRESET'),
  );
  assert.equal(paths.length, 3);
  assert.deepEqual(pauses, [3000, 6000]);
  assert.deepEqual(retries, [2, 3]);
  await removed(paths);
});

test('integrity, size, address, TLS, disk and unknown readback failures are permanent and sanitized', async () => {
  const cases: [Error, string][] = [
    [new Error('更新包 SHA-256 校验失败'), 'COS_PUBLIC_READ_HASH'],
    ...[
      '更新包声明的大小与发行信息不一致',
      '更新包实际大小超过发行信息',
      '更新服务器返回了无效的文件大小',
    ].map((message): [Error, string] => [new Error(message), 'COS_PUBLIC_READ_SIZE']),
    [new Error('更新服务器解析到了非公开网络地址'), 'COS_PUBLIC_READ_ADDRESS'],
    [new Error('更新服务器重定向地址无效'), 'COS_PUBLIC_READ_ADDRESS'],
    [problem('ENOTFOUND'), 'COS_PUBLIC_READ_ADDRESS'],
    [problem('CERT_HAS_EXPIRED'), 'COS_PUBLIC_READ_TLS'],
    [problem('ERR_TLS_CERT_ALTNAME_INVALID'), 'COS_PUBLIC_READ_TLS'],
    [problem('ERR_SSL_WRONG_VERSION_NUMBER'), 'COS_PUBLIC_READ_TLS'],
    [problem('EACCES'), 'COS_PUBLIC_READ_DISK'],
    [problem('ENOSPC'), 'COS_PUBLIC_READ_DISK'],
    [new Error('更新包写入未能完成'), 'COS_PUBLIC_READ_DISK'],
    [new Error('更新服务器返回 HTTP 400'), 'COS_PUBLIC_READ_HTTP / HTTP_400'],
    [new Error('更新服务器返回 HTTP 403'), 'COS_PUBLIC_READ_HTTP / HTTP_403'],
    [new Error('更新服务器返回 HTTP 404'), 'COS_PUBLIC_READ_HTTP / HTTP_404'],
    [new Error('更新服务器返回了不支持的压缩传输'), 'COS_PUBLIC_READ'],
    [problem('SOME_UNKNOWN_ERROR'), 'COS_PUBLIC_READ'],
  ];
  for (const [error, diagnostic] of cases) {
    const paths: string[] = [];
    const verify = createPublicVerifier({
      download: async (_url, target) => {
        paths.push(target);
        throw error;
      },
      wait: async () => {
        assert.fail('permanent readback failures never retry');
      },
    });
    await assert.rejects(verify(file, url), (error) => safe(error, diagnostic));
    assert.equal(paths.length, 1);
    await removed(paths);
  }
});

test('invalid expected data and unsafe URLs never reach even an injected readback transport', async () => {
  let calls = 0;
  const verify = createPublicVerifier({
    download: async () => {
      calls++;
    },
  });
  for (const invalid of [
    { ...file, bytes: 0 },
    { ...file, bytes: 512 * 1024 ** 2 + 1 },
    { ...file, sha256: secret },
  ])
    await assert.rejects(verify(invalid, url), (error) => safe(error, 'COS_PUBLIC_READ_SIZE'));
  for (const address of [
    'http://mirror.example/package',
    'https://127.0.0.1/package',
    `https://mirror.example/package?secret=${secret}`,
  ])
    await assert.rejects(verify(file, address), (error) => safe(error, 'COS_PUBLIC_READ_ADDRESS'));
  assert.equal(calls, 0);
});

test('all retries share one three-hour budget and no new attempt starts after it', async () => {
  let clock = 0;
  const paths: string[] = [];
  const verify = createPublicVerifier({
    now: () => clock,
    download: async (_url, target) => {
      paths.push(target);
      clock += 3 * 60 * 60 * 1000 - 1000;
      throw problem('ECONNRESET');
    },
    wait: async () => {
      assert.fail('not enough total budget remains for retry');
    },
  });
  await assert.rejects(verify(file, url), (error) => safe(error, 'COS_PUBLIC_READ_TIMEOUT'));
  assert.equal(paths.length, 1);
  await removed(paths);
  const late = createPublicVerifier({
    now: () => clock,
    download: async (_url, target) => {
      paths.push(target);
      clock += 3 * 60 * 60 * 1000 + 1;
    },
  });
  await assert.rejects(late(file, url), (error) => safe(error, 'COS_PUBLIC_READ_TIMEOUT'));
  await removed(paths);
});

interface Reply {
  chunks?: Buffer[];
  fail?: Error;
  status?: number;
  headers?: Record<string, string>;
}
function transport(replies: Reply[]) {
  const calls: RequestOptions[] = [],
    responses: PassThrough[] = [];
  const request = (settings: RequestOptions, callback: (response: IncomingMessage) => void) => {
    calls.push(settings);
    const reply = replies.shift();
    assert(reply, 'unexpected outbound request');
    const outgoing = new EventEmitter() as EventEmitter & { end(): void; destroy(): void };
    outgoing.destroy = () => outgoing;
    outgoing.end = () =>
      queueMicrotask(() => {
        const incoming = new PassThrough() as PassThrough & {
          statusCode: number;
          headers: Record<string, string>;
        };
        incoming.statusCode = reply.status ?? 200;
        incoming.headers = reply.headers ?? { 'content-length': String(content.length) };
        responses.push(incoming);
        callback(incoming as unknown as IncomingMessage);
        setImmediate(() => {
          for (const chunk of reply.chunks ?? []) incoming.write(chunk);
          if (reply.fail) incoming.destroy(reply.fail);
          else incoming.end();
        });
      });
    return outgoing as unknown as ClientRequest;
  };
  return { request, calls, responses };
}

test('real safe downloader retries a truncated network stream then verifies the entire fresh file SHA', async () => {
  const fake = transport([
    { chunks: [content.subarray(0, 4)], fail: problem('ECONNRESET') },
    { chunks: [content.subarray(0, 7), content.subarray(7)] },
  ]);
  let lookups = 0;
  const downloader = createUpdateDownloader({
    request: fake.request,
    lookup: async () => {
      lookups++;
      return [{ address: '93.184.216.34', family: 4 }];
    },
  }).downloadUpdateFile;
  const paths: string[] = [];
  await createPublicVerifier({
    download: async (...args) => {
      paths.push(args[1]);
      return downloader(...args);
    },
    wait: async () => {},
  })(file, url);
  assert.equal(lookups, 2);
  assert.equal(fake.calls.length, 2);
  assert(fake.responses.every((response) => response.destroyed));
  assert(
    fake.calls.every(
      (settings) => settings.rejectUnauthorized === true && settings.agent === false,
    ),
  );
  await removed(paths);
});

test('real safe downloader refuses a complete same-size corrupted file without retrying', async () => {
  const corrupted = Buffer.from(content);
  corrupted[3] ^= 1;
  const fake = transport([{ chunks: [corrupted] }]);
  const paths: string[] = [];
  const downloader = createUpdateDownloader({
    request: fake.request,
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  }).downloadUpdateFile;
  const verify = createPublicVerifier({
    download: async (...args) => {
      paths.push(args[1]);
      return downloader(...args);
    },
    wait: async () => {
      assert.fail('hash mismatch never retries');
    },
  });
  await assert.rejects(verify(file, url), (error) => safe(error, 'COS_PUBLIC_READ_HASH'));
  assert.equal(fake.calls.length, 1);
  await removed(paths);
});

test('real downloader still rejects private DNS answers before any outbound readback request', async () => {
  const fake = transport([]);
  const downloader = createUpdateDownloader({
    request: fake.request,
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
  }).downloadUpdateFile;
  const paths: string[] = [];
  const verify = createPublicVerifier({
    download: async (...args) => {
      paths.push(args[1]);
      return downloader(...args);
    },
    wait: async () => {
      assert.fail('private network answers never retry');
    },
  });
  await assert.rejects(verify(file, url), (error) => safe(error, 'COS_PUBLIC_READ_ADDRESS'));
  assert.equal(fake.calls.length, 0);
  await removed(paths);
});
