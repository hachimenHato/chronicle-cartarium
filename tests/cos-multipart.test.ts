import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, rename, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createCosStore,
  loadCosConfig,
  publishCosMirror,
  type CosSdkClient,
} from '../scripts/lib/cos-publisher';
import {
  COS_MULTIPART_PART_BYTES,
  COS_MULTIPART_THRESHOLD,
  uploadCosMultipart,
} from '../scripts/lib/cos-multipart';
import { CosPublishError, formatCosDiagnostic } from '../scripts/lib/cos-diagnostics';
import { createCosProgressLogger } from '../scripts/lib/cos-progress';

const body = Buffer.alloc(COS_MULTIPART_THRESHOLD + 997, 73);
const partNumbers = Array.from(
  { length: Math.ceil(body.length / COS_MULTIPART_PART_BYTES) },
  (_, index) => index + 1,
);
const sha256 = createHash('sha256').update(body).digest('hex');
const md5 = createHash('md5').update(body).digest('base64');
const relative = 'v0.2.0-beta.20/chronicle-cartarium-0.2.0-beta.20-win-x64.ccupdate';
const config = loadCosConfig({
  COS_BUCKET: 'multipart-fixture-1250000000',
  COS_REGION: 'ap-shanghai',
  COS_PUBLIC_BASE_URL: 'https://not-contacted.example/chronicle-cartarium/updates',
});
const credentials = {
  TENCENT_COS_SECRET_ID: 'FAKE_MULTIPART_TEST_ID',
  TENCENT_COS_SECRET_KEY: 'FAKE_MULTIPART_TEST_SECRET',
};
const sdkError = (statusCode: number | undefined, code: string) => ({
  statusCode,
  code,
  message: 'FAKE_MULTIPART_TEST_SECRET',
  headers: { Authorization: 'FAKE_MULTIPART_TEST_ID' },
  url: 'https://not-contacted.example/?signature=FAKE_MULTIPART_TEST_SECRET',
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chronicle-cos-multipart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'public-synthetic-package');
  await writeFile(file, body);
  const input = {
    key: config.prefix + '/' + relative,
    file,
    bytes: body.length,
    sha256,
    md5,
    immutable: true,
  };
  const init: Record<string, unknown>[] = [];
  const complete: Record<string, unknown>[] = [];
  const abort: Record<string, unknown>[] = [];
  const puts: Record<string, unknown>[] = [];
  const uploads: { number: number; bytes: Buffer; stream: any; params: Record<string, unknown> }[] =
    [];
  const chunks = new Map<number, Buffer>();
  let remote: Buffer | undefined;
  const pauses: number[] = [];
  const retries: number[][] = [];
  const progress: number[] = [];
  const client: CosSdkClient = {
    async getBucketVersioning() {
      return {};
    },
    async headObject(params) {
      if (params.Key === input.key && remote)
        return { headers: { 'content-length': String(remote.length) } };
      throw sdkError(404, '404');
    },
    async getObject() {
      assert.fail('the multipart adapter never reads credentials or remote bodies');
    },
    async putObject(params) {
      puts.push(params);
      return {};
    },
    async multipartInit(params) {
      init.push(params);
      return { UploadId: 'owned-fixture-upload' };
    },
    async multipartUpload(params) {
      const values: Buffer[] = [];
      const stream = params.Body as any;
      for await (const value of stream) values.push(Buffer.from(value));
      const bytes = Buffer.concat(values);
      const number = Number(params.PartNumber);
      uploads.push({ number, bytes, stream, params });
      assert.equal(params.UploadId, 'owned-fixture-upload');
      assert.equal(params.ContentLength, bytes.length);
      assert.equal(params.ContentMD5, createHash('md5').update(bytes).digest('base64'));
      assert.deepEqual(
        bytes,
        body.subarray((number - 1) * COS_MULTIPART_PART_BYTES, number * COS_MULTIPART_PART_BYTES),
      );
      chunks.set(number, bytes);
      (params.onProgress as ((v: { loaded: number }) => void) | undefined)?.({
        loaded: bytes.length,
      });
      return { ETag: '"' + createHash('md5').update(bytes).digest('hex') + '"' };
    },
    async multipartComplete(params) {
      complete.push(params);
      remote = Buffer.concat(
        [...chunks.entries()].sort(([a], [b]) => a - b).map(([, value]) => value),
      );
      return {};
    },
    async multipartAbort(params) {
      abort.push(params);
      return {};
    },
  };
  const store = createCosStore(config, credentials, client, undefined, {
    wait: async (duration) => {
      pauses.push(duration);
    },
  });
  return {
    file,
    client,
    store,
    init,
    complete,
    abort,
    puts,
    uploads,
    pauses,
    retries,
    progress,
    input: {
      ...input,
      onPartRetry: (attempt: number, number: number, count: number) =>
        retries.push([attempt, number, count]),
      onProgress: (p: { loaded?: unknown }) => {
        if (typeof p.loaded === 'number') progress.push(p.loaded);
      },
    },
    setRemote(value?: Buffer) {
      remote = value;
    },
    remote: () => remote,
  };
}

test('large official file uploads use bounded sequential parts and guarded low-level completion', async (t) => {
  const f = await fixture(t);
  await f.store.put(f.input);
  assert.equal(f.puts.length, 0, 'never fall back to the long single PUT');
  assert.equal(f.init.length, 1);
  assert.equal(f.init[0].ContentType, 'application/octet-stream');
  assert.equal(f.init[0].CacheControl, 'public, max-age=31536000, immutable');
  assert.deepEqual(f.init[0].Headers, {
    'x-cos-meta-sha256': sha256,
    'x-cos-forbid-overwrite': 'true',
  });
  assert.deepEqual(
    f.uploads.map((p) => p.number),
    partNumbers,
  );
  assert.deepEqual(
    f.uploads.map((p) => p.bytes.length),
    partNumbers.map((number) =>
      Math.min(COS_MULTIPART_PART_BYTES, body.length - (number - 1) * COS_MULTIPART_PART_BYTES),
    ),
  );
  assert.equal(new Set(f.uploads.map((p) => p.stream)).size, partNumbers.length);
  assert(f.uploads.every((p) => p.stream.destroyed));
  assert.deepEqual(f.complete[0].Headers, { 'x-cos-forbid-overwrite': 'true' });
  assert.deepEqual(
    (f.complete[0].Parts as any[]).map((p) => p.PartNumber),
    partNumbers,
  );
  assert.deepEqual(f.remote(), body);
  assert.equal(f.progress.at(-1), body.length);
  assert.equal(f.abort.length, 0);
  // Windows rejects this operation if a file handle remains open.
  await rename(f.file, f.file + '-closed');
});

test('a transient failed part retries only that part, using fresh identical streams and preserving completed chunks', async (t) => {
  const f = await fixture(t);
  const original = f.client.multipartUpload!;
  let failed = false;
  f.client.multipartUpload = async (params) => {
    const result = await original(params);
    if (params.PartNumber === 2 && !failed) {
      failed = true;
      throw sdkError(400, 'RequestTimeout');
    }
    return result;
  };
  await f.store.put(f.input);
  assert.deepEqual(
    f.uploads.map((p) => p.number),
    [1, 2, ...partNumbers.slice(1)],
  );
  assert.deepEqual(f.uploads[1].bytes, f.uploads[2].bytes);
  assert.notEqual(f.uploads[1].stream, f.uploads[2].stream);
  assert(f.uploads.every((p) => p.stream.destroyed));
  assert.deepEqual(f.pauses, [3000]);
  assert.deepEqual(f.retries, [[2, 2, partNumbers.length]]);
  assert.deepEqual(f.remote(), body);
});

test('part retries stop at three attempts and abort only the session created by this invocation', async (t) => {
  const f = await fixture(t);
  const original = f.client.multipartUpload!;
  f.client.multipartUpload = async (params) => {
    await original(params);
    throw sdkError(undefined, 'ECONNRESET');
  };
  await assert.rejects(
    f.store.put(f.input),
    (error) => error instanceof CosPublishError && error.code === 'COS_MULTIPART_PART',
  );
  assert.deepEqual(
    f.uploads.map((p) => p.number),
    [1, 1, 1],
  );
  assert.deepEqual(f.pauses, [3000, 6000]);
  assert.equal(f.complete.length, 0);
  assert.equal(f.abort.length, 1);
  assert.deepEqual(f.abort[0], {
    Bucket: config.bucket,
    Region: config.region,
    Key: f.input.key,
    UploadId: 'owned-fixture-upload',
  });
  assert.equal(f.remote(), undefined);
});

test('multipart permission errors are explicit, permanent and never fall back to a long PUT', async (t) => {
  for (const stage of ['multipartInit', 'multipartUpload', 'multipartComplete'] as const) {
    const f = await fixture(t);
    let count = 0;
    f.client[stage] = async () => {
      count++;
      throw sdkError(403, 'AccessDenied');
    };
    await assert.rejects(f.store.put(f.input), (error) => {
      assert(error instanceof CosPublishError);
      assert.equal(
        formatCosDiagnostic(error),
        'COS_MULTIPART_PERMISSION / HTTP_403 / AccessDenied',
      );
      assert.doesNotMatch(`${JSON.stringify(error)} ${error.stack}`, /FAKE_MULTIPART|signature=/);
      return true;
    });
    assert.equal(count, 1);
    assert.equal(f.puts.length, 0);
    assert.deepEqual(f.pauses, []);
    assert.equal(f.abort.length, stage === 'multipartInit' ? 0 : 1);
  }
});

test('explicit provider HTTP400 and bad part ETags fail without retries or completion', async (t) => {
  for (const kind of [
    'unknownProvider',
    'badDigest',
    'nestedUnknown',
    'nestedDigest',
    'etag',
  ] as const) {
    const f = await fixture(t);
    let count = 0;
    f.client.multipartUpload = async (params) => {
      count++;
      (params.Body as any).destroy();
      if (kind === 'etag') return { ETag: '"not-a-valid-etag' };
      if (kind === 'nestedUnknown' || kind === 'nestedDigest')
        throw {
          ...sdkError(400, '400'),
          error: { Code: kind === 'nestedDigest' ? 'BadDigest' : 'UNRECOGNIZED_PROVIDER_CODE' },
        };
      throw sdkError(400, kind === 'unknownProvider' ? 'UNRECOGNIZED_PROVIDER_CODE' : 'BadDigest');
    };
    await assert.rejects(f.store.put(f.input), CosPublishError);
    assert.equal(count, 1);
    assert.equal(f.complete.length, 0);
    assert.equal(f.abort.length, 1);
    assert.equal(f.puts.length, 0);
    assert.deepEqual(f.pauses, []);
  }
});

test('a bare HTTP400 replays only identical bytes in the owned part, then completes with full hash', async (t) => {
  for (const nested of [false, true]) {
    const f = await fixture(t);
    const original = f.client.multipartUpload!;
    let failed = false;
    f.client.multipartUpload = async (params) => {
      const result = await original(params);
      if (params.PartNumber === 2 && !failed) {
        failed = true;
        if (nested) throw { statusCode: 400 };
        throw sdkError(400, '400');
      }
      return result;
    };
    await f.store.put(f.input);
    assert.deepEqual(
      f.uploads.map((p) => p.number),
      [1, 2, ...partNumbers.slice(1)],
    );
    assert.deepEqual(f.uploads[1].bytes, f.uploads[2].bytes);
    assert.notEqual(f.uploads[1].stream, f.uploads[2].stream);
    assert.deepEqual(f.pauses, [3000]);
    assert.equal(f.init.length, 1);
    assert.equal(f.complete.length, 1);
    assert.equal(f.abort.length, 0);
    assert.deepEqual(f.remote(), body);
  }
});

test('persistent bare HTTP400 is bounded to three part attempts and never publishes an object', async (t) => {
  const f = await fixture(t);
  const original = f.client.multipartUpload!;
  f.client.multipartUpload = async (params) => {
    await original(params);
    throw sdkError(400, '400');
  };
  await assert.rejects(f.store.put(f.input), (error) => {
    assert.equal(formatCosDiagnostic(error), 'COS_MULTIPART_PART / HTTP_400');
    assert.doesNotMatch(`${JSON.stringify(error)} ${(error as Error).stack}`, /FAKE_MULTIPART/);
    return true;
  });
  assert.deepEqual(
    f.uploads.map((p) => p.number),
    [1, 1, 1],
  );
  assert.deepEqual(f.pauses, [3000, 6000]);
  assert.equal(f.complete.length, 0);
  assert.equal(f.abort.length, 1);
  assert.equal(f.puts.length, 0);
  assert.equal(f.remote(), undefined);
});

test('bare HTTP400 is never replayed for initialization or completion', async (t) => {
  for (const stage of ['multipartInit', 'multipartComplete'] as const) {
    const f = await fixture(t);
    let count = 0;
    f.client[stage] = async () => {
      count++;
      throw sdkError(400, '400');
    };
    await assert.rejects(f.store.put(f.input), CosPublishError);
    assert.equal(count, 1);
    assert.deepEqual(f.pauses, []);
    assert.equal(f.remote(), undefined);
    assert.equal(f.puts.length, 0);
  }
});

test('local bytes changed after planning are never committed and the owned session is aborted', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.store.put({ ...f.input, sha256: '0'.repeat(64) }),
    (error) => error instanceof CosPublishError && error.code === 'FILE_HASH',
  );
  assert.equal(f.complete.length, 0);
  assert.equal(f.abort.length, 1);
  assert.equal(f.remote(), undefined);
});

test('completed object recovery uses HEAD and leaves full anonymous SHA verification mandatory', async (t) => {
  for (const code of ['ECONNRESET', 'NoSuchUpload', 'ObjectAlreadyExists']) {
    const f = await fixture(t);
    const original = f.client.multipartComplete!;
    const originalAbort = f.client.multipartAbort!;
    const stages: string[] = [];
    f.client.multipartAbort = async (params) => {
      await originalAbort(params);
      if (code === 'NoSuchUpload') throw sdkError(404, 'NoSuchUpload');
      return {};
    };
    f.client.multipartComplete = async (params) => {
      await original(params);
      throw sdkError(
        code === 'NoSuchUpload' ? 404 : code === 'ObjectAlreadyExists' ? 409 : undefined,
        code,
      );
    };
    let publicChecks = 0;
    await assert.rejects(
      publishCosMirror({
        directory: 'not-read-fixture',
        config,
        store: f.store,
        onProgress: (event) => stages.push(event.stage),
        dependencies: {
          plan: async () => ({
            files: [{ relative, filename: f.file, bytes: body.length, sha256, md5 }],
            releases: [],
          }),
        },
        verifyPublic: async (actual) => {
          publicChecks++;
          assert.equal(actual.sha256, sha256);
          throw new CosPublishError('FILE_HASH');
        },
      }),
      (error) => error instanceof CosPublishError && error.code === 'FILE_HASH',
    );
    assert.equal(publicChecks, 1);
    assert.equal(f.complete.length, 1);
    assert.equal(f.puts.length, 0, 'no catalog writes after failed public SHA');
    assert.equal(
      f.abort.length,
      1,
      'only the owned session may be cleaned after ambiguous completion',
    );
    assert.equal(f.abort[0].UploadId, 'owned-fixture-upload');
    assert.deepEqual(f.remote(), body, 'aborting a session never deletes a completed object');
    assert(
      !stages.includes('multipart-abort-unconfirmed'),
      'NoSuchUpload confirms the owned session is already gone',
    );
  }
});

test('completion errors without a committed object fail or retry only known transient metadata failures', async (t) => {
  const f = await fixture(t);
  const original = f.client.multipartComplete!;
  let attempts = 0;
  f.client.multipartComplete = async (params) => {
    attempts++;
    if (attempts === 1) throw sdkError(503, 'ServiceUnavailable');
    return original(params);
  };
  await f.store.put(f.input);
  assert.equal(attempts, 2);
  assert.deepEqual(f.pauses, [3000]);
  assert.deepEqual(f.remote(), body);
  const denied = await fixture(t);
  denied.client.multipartComplete = async () => {
    throw sdkError(200, 'InvalidPart');
  };
  await assert.rejects(
    denied.store.put(denied.input),
    (error) =>
      error instanceof CosPublishError &&
      error.code === 'COS_MULTIPART_COMPLETE' &&
      error.providerCode === 'InvalidPart',
  );
  assert.equal(denied.abort.length, 1);
});

test('existing objects are reused or refused without creating or adopting any multipart session', async (t) => {
  const f = await fixture(t);
  f.setRemote(body);
  await f.store.put(f.input);
  assert.equal(f.init.length, 0);
  assert.equal(f.uploads.length, 0);
  const changed = await fixture(t);
  changed.setRemote(Buffer.from('unrelated existing bytes'));
  await assert.rejects(
    changed.store.put(changed.input),
    (error) => error instanceof CosPublishError && error.code === 'EXISTING_OBJECT_CHANGED',
  );
  assert.equal(changed.init.length, 0);
  assert.equal(changed.abort.length, 0);
});

test('unknown initialization IDs never trigger an abort and cleanup failure never hides the primary error', async (t) => {
  const invalid = await fixture(t);
  invalid.client.multipartInit = async () => ({ UploadId: 'bad\nid' });
  await assert.rejects(
    invalid.store.put(invalid.input),
    (error) => error instanceof CosPublishError && error.code === 'COS_MULTIPART_UPLOAD_ID',
  );
  assert.equal(invalid.abort.length, 0);
  const failed = await fixture(t);
  let cleanupNotices = 0;
  failed.client.multipartUpload = async (params) => {
    (params.Body as any).destroy();
    throw sdkError(400, 'BadDigest');
  };
  failed.client.multipartAbort = async () => {
    throw sdkError(403, 'AccessDenied');
  };
  await assert.rejects(
    failed.store.put({
      ...failed.input,
      onCleanupFailure: () => {
        cleanupNotices++;
      },
    }),
    (error) =>
      error instanceof CosPublishError &&
      error.code === 'COS_MULTIPART_PART' &&
      error.providerCode === 'BadDigest',
  );
  assert.equal(cleanupNotices, 1);
});

test('multipart progress logs only bounded part counts and fixed cleanup text', () => {
  const lines: string[] = [];
  const log = createCosProgressLogger((line) => lines.push(line));
  log({
    stage: 'part-retry',
    fileIndex: 2,
    fileCount: 7,
    partNumber: 3,
    partCount: 22,
    attempt: 2,
  });
  log({
    stage: 'part-retry',
    fileIndex: 2,
    fileCount: 7,
    partNumber: 99,
    partCount: 22,
    attempt: 2,
  });
  log({ stage: 'multipart-abort-unconfirmed', fileIndex: 2, fileCount: 7 });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /第 2\/7.*第 3\/22.*第 2\/3/);
  assert.match(lines[1], /未删除任何已完成对象/);
});

test('small immutable files retain simple PUT while a missing multipart SDK never falls back for large files', async (t) => {
  const small = await fixture(t);
  const bytes = Buffer.from('small official signed descriptor fixture');
  await writeFile(small.file, bytes);
  await small.store.put({
    ...small.input,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    md5: createHash('md5').update(bytes).digest('base64'),
  });
  assert.equal(small.puts.length, 1);
  assert.equal(small.init.length, 0);
  const absent = await fixture(t);
  absent.client.multipartInit = undefined;
  await assert.rejects(
    absent.store.put(absent.input),
    (error) => error instanceof CosPublishError && error.code === 'COS_MULTIPART_SDK',
  );
  assert.equal(absent.puts.length, 0);
  assert.equal(absent.abort.length, 0);
});

test('a file-close failure still aborts the owned session and preserves the primary safe diagnostic', async (t) => {
  const f = await fixture(t);
  f.client.multipartUpload = async (params) => {
    (params.Body as any).destroy();
    throw sdkError(400, 'BadDigest');
  };
  await assert.rejects(
    uploadCosMultipart({
      client: f.client,
      base: { Bucket: config.bucket, Region: config.region },
      input: f.input,
      head: (key) => f.store.head(key),
      retryable: () => false,
      openFile: async (...args) => {
        const handle = await open(...args);
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'close')
              return async () => {
                await target.close();
                throw new Error('FAKE_PRIVATE_CLOSE_FAILURE');
              };
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      },
    }),
    (error) => {
      assert(error instanceof CosPublishError);
      assert.equal(formatCosDiagnostic(error), 'COS_MULTIPART_PART / HTTP_400 / BadDigest');
      assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, /FAKE_PRIVATE/);
      return true;
    },
  );
  assert.equal(f.abort.length, 1);
  assert.equal(f.abort[0].UploadId, 'owned-fixture-upload');
  await rename(f.file, f.file + '-closed');
});
