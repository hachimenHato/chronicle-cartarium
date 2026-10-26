import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  createCosStore,
  loadCosConfig,
  publishCosMirror,
  CosPublishError,
  type CosSdkClient,
} from '../scripts/lib/cos-publisher';
import { formatCosDiagnostic } from '../scripts/lib/cos-diagnostics';

// No SDK, real account, external network, installation files, or database.
const config = loadCosConfig({
  COS_BUCKET: 'retry-fixture-1250000000',
  COS_REGION: 'ap-shanghai',
  COS_PUBLIC_BASE_URL: 'https://not-contacted.example/chronicle-cartarium/updates',
});
const credentials = {
  TENCENT_COS_SECRET_ID: 'FAKE_RETRY_TEST_ID',
  TENCENT_COS_SECRET_KEY: 'FAKE_RETRY_TEST_SECRET',
};
const body = Buffer.from('public bytes only; never use a real release in these tests');
const sha256 = createHash('sha256').update(body).digest('hex');
const md5 = createHash('md5').update(body).digest('base64');
const relative = 'v0.2.0-beta.19/chronicle-cartarium-0.2.0-beta.19-win-x64.ccupdate';
const input = {
  key: `${config.prefix}/${relative}`,
  body,
  bytes: body.length,
  sha256,
  md5,
  immutable: true,
};

function failure(statusCode?: number, code = 'ECONNRESET') {
  return {
    statusCode,
    code,
    message: 'FAKE_RETRY_TEST_SECRET',
    headers: { Authorization: 'FAKE_RETRY_TEST_ID' },
    url: 'https://not-contacted.example/?signature=FAKE_RETRY_TEST_SECRET',
  };
}

function fixture() {
  let puts = 0;
  let heads = 0;
  let existingBytes: number | undefined;
  const pauses: number[] = [];
  const retries: number[] = [];
  const requests: Record<string, unknown>[] = [];
  const client: CosSdkClient = {
    async getBucketVersioning() {
      return { VersioningConfiguration: {} };
    },
    async headObject() {
      heads++;
      if (existingBytes === undefined) throw failure(404, '404');
      return { headers: { 'content-length': String(existingBytes) } };
    },
    async getObject() {
      assert.fail('these retry tests do not read a real remote object');
    },
    async putObject(params) {
      puts++;
      requests.push(params);
      return {};
    },
  };
  const store = createCosStore(config, credentials, client, undefined, {
    wait: async (milliseconds) => {
      pauses.push(milliseconds);
    },
  });
  return {
    client,
    store,
    requests,
    pauses,
    retries,
    input: { ...input, onRetry: (attempt: number) => retries.push(attempt) },
    setExisting(value?: number) {
      existingBytes = value;
    },
    stats: () => ({ puts, heads }),
  };
}

test('COS retries only known transient upload failures, checking HEAD before each fresh attempt', async () => {
  for (const error of [
    failure(400, 'RequestTimeout'),
    { ...failure(400, '400'), error: { Code: 'RequestTimeOut' } },
    failure(400, 'IncompleteBody'),
    failure(408, '408'),
    failure(429, 'SlowDown'),
    failure(500, 'InternalError'),
    failure(503, 'ServiceUnavailable'),
    ...['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNRESET', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH'].map(
      (code) => failure(undefined, code),
    ),
  ]) {
    const f = fixture();
    let attempt = 0;
    const successfulPut = f.client.putObject;
    f.client.putObject = async (params) => {
      attempt++;
      assert.equal(f.stats().heads, attempt - 1, 'a retry must follow HEAD, never a blind PUT');
      assert.equal(params.ContentMD5, md5);
      assert.deepEqual(params.Headers, {
        'x-cos-meta-sha256': sha256,
        'x-cos-forbid-overwrite': 'true',
      });
      if (attempt === 1) throw error;
      return successfulPut(params);
    };
    await f.store.put(f.input);
    assert.equal(attempt, 2);
    assert.deepEqual(f.pauses, [3000]);
    assert.deepEqual(f.retries, [2]);
  }
});

test('COS upload retries are bounded to three attempts and preserve only fixed diagnostic fields', async () => {
  const f = fixture();
  let attempts = 0;
  f.client.putObject = async () => {
    attempts++;
    throw failure(400, 'RequestTimeout');
  };
  await assert.rejects(f.store.put(f.input), (error) => {
    assert(error instanceof CosPublishError);
    assert.equal(formatCosDiagnostic(error), 'COS_WRITE / HTTP_400 / RequestTimeout');
    assert.doesNotMatch(`${JSON.stringify(error)} ${error.stack}`, /FAKE_RETRY|signature=/);
    return true;
  });
  assert.equal(attempts, 3);
  assert.equal(
    f.stats().heads,
    3,
    'even the last ambiguous response checks whether the server committed',
  );
  assert.deepEqual(f.pauses, [3000, 6000]);
  assert.deepEqual(f.retries, [2, 3]);
});

test('COS arbitrary 400, credentials, permissions, bad hashes and local file errors never retry', async () => {
  for (const error of [
    failure(400, '400'),
    failure(400, 'InvalidRequest'),
    failure(400, 'BadDigest'),
    failure(400, 'EntitySizeNotMatch'),
    failure(400, 'InvalidDigest'),
    failure(401, 'InvalidAccessKeyId'),
    failure(403, 'AccessDenied'),
    failure(404, 'NoSuchBucket'),
    failure(undefined, 'ENOENT'),
    failure(undefined, 'FAKE_RETRY_TEST_SECRET'),
  ]) {
    const f = fixture();
    let attempts = 0;
    f.client.putObject = async () => {
      attempts++;
      throw error;
    };
    await assert.rejects(f.store.put(f.input), CosPublishError);
    assert.equal(attempts, 1);
    assert.equal(f.stats().heads, 0);
    assert.deepEqual(f.pauses, []);
    assert.deepEqual(f.retries, []);
  }
});

test('COS mutable catalog writes are never replayed by the upload adapter', async () => {
  const f = fixture();
  let attempts = 0;
  f.client.putObject = async () => {
    attempts++;
    throw failure(503, 'ServiceUnavailable');
  };
  await assert.rejects(f.store.put({ ...f.input, immutable: false }), CosPublishError);
  assert.equal(attempts, 1);
  assert.equal(f.stats().heads, 0);
  assert.deepEqual(f.pauses, []);
});

test('COS recovers lost acknowledgements and guarded collisions without overwriting completed objects', async () => {
  for (const error of [
    failure(undefined, 'ECONNRESET'),
    failure(409, 'ObjectAlreadyExists'),
    failure(412, 'PreconditionFailed'),
  ]) {
    const f = fixture();
    f.setExisting(body.length);
    let attempts = 0;
    f.client.putObject = async () => {
      attempts++;
      throw error;
    };
    await f.store.put(f.input);
    assert.equal(attempts, 1);
    assert.equal(f.stats().heads, 1);
    assert.deepEqual(f.pauses, []);
  }
});

test('COS retries refuse changed objects, ambiguous collisions and failed HEAD checks', async () => {
  for (const scenario of ['changed', 'collision', 'head-denied'] as const) {
    const f = fixture();
    let attempts = 0;
    if (scenario === 'changed') f.setExisting(body.length + 1);
    if (scenario === 'head-denied')
      f.client.headObject = async () => {
        throw failure(403, 'AccessDenied');
      };
    f.client.putObject = async () => {
      attempts++;
      throw scenario === 'collision'
        ? failure(409, 'ObjectAlreadyExists')
        : failure(undefined, 'ECONNRESET');
    };
    await assert.rejects(f.store.put(f.input), (error) => {
      assert(error instanceof CosPublishError);
      assert.equal(
        error.code,
        scenario === 'changed'
          ? 'EXISTING_OBJECT_CHANGED'
          : scenario === 'head-denied'
            ? 'COS_HEAD'
            : 'COS_WRITE',
      );
      return true;
    });
    assert.equal(attempts, 1);
    assert.deepEqual(f.pauses, []);
  }
});

test('COS file retries reopen the original bytes and close every stream', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'chronicle-cos-retry-test-'));
  try {
    const filename = path.join(temporary, 'public-fixture');
    await writeFile(filename, body);
    const f = fixture();
    const streams: any[] = [];
    f.client.putObject = async (params) => {
      const stream = params.Body as NodeJS.ReadableStream;
      streams.push(stream);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      assert.deepEqual(Buffer.concat(chunks), body, 'each attempt must restart at offset zero');
      if (streams.length < 3) throw failure(undefined, 'ECONNRESET');
      return {};
    };
    await f.store.put({ ...f.input, body: undefined, file: filename });
    assert.equal(new Set(streams).size, 3);
    assert(streams.every((stream) => stream.destroyed));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('COS acknowledgement recovery still requires anonymous SHA verification before any catalog write', async () => {
  const f = fixture();
  let objectCommitted = false;
  let catalogWrites = 0;
  let publicChecks = 0;
  f.client.headObject = async (params) => {
    if (params.Key === input.key && objectCommitted)
      return { headers: { 'content-length': String(body.length) } };
    throw failure(404, '404');
  };
  f.client.putObject = async (params) => {
    if (params.Key === input.key) {
      objectCommitted = true;
      throw failure(undefined, 'ECONNRESET');
    }
    catalogWrites++;
    return {};
  };
  const file = { relative, filename: 'not-read-fixture', bytes: body.length, sha256, md5 };
  await assert.rejects(
    publishCosMirror({
      directory: 'not-read-fixture',
      config,
      store: f.store,
      dependencies: { plan: async () => ({ files: [file], releases: [] }) },
      verifyPublic: async (actual, url) => {
        publicChecks++;
        assert.equal(actual.sha256, sha256);
        assert.equal(url, `${config.publicBaseUrl}/${relative}`);
        // A synthetic same-length corrupt server response must still stop publication.
        throw new CosPublishError('FILE_HASH');
      },
    }),
    (error) => error instanceof CosPublishError && error.code === 'FILE_HASH',
  );
  assert.equal(publicChecks, 1);
  assert.equal(catalogWrites, 0);
});
