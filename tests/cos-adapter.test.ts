import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CosPublishError, createCosStore, loadCosConfig } from '../scripts/lib/cos-publisher';

// These are synthetic test credentials. No SDK, cloud connection, real account,
// installation files, or database is needed for adapter boundary regressions.
const fakeId = 'FAKE_COS_TEST_ID_NEVER_USE';
const fakeKey = 'FAKE_COS_TEST_KEY_NEVER_USE';
const fakeUrl = 'https://not-contacted.example/object?authorization=FAKE';
const env = { TENCENT_COS_SECRET_ID: fakeId, TENCENT_COS_SECRET_KEY: fakeKey };
const config = loadCosConfig({
  COS_BUCKET: 'adapter-fixture-1250000000',
  COS_REGION: 'ap-shanghai',
  COS_PREFIX: 'chronicle-cartarium/updates',
  COS_PUBLIC_BASE_URL: 'https://not-contacted.example/chronicle-cartarium/updates',
});
const key = `${config.prefix}/releases.json`;

interface Client {
  headObject(params: Record<string, unknown>): Promise<any>;
  getObject(params: Record<string, unknown>): Promise<any>;
  getBucketVersioning(params: Record<string, unknown>): Promise<any>;
  putObject(params: Record<string, unknown>): Promise<any>;
}

function client(overrides: Partial<Client> = {}): Client {
  return {
    async headObject() {
      return { headers: { 'content-length': '2' } };
    },
    async getObject() {
      return { Body: Buffer.from('[]') };
    },
    async getBucketVersioning() {
      return { VersioningConfiguration: {} };
    },
    async putObject() {
      return {};
    },
    ...overrides,
  };
}

function sdkFailure(statusCode = 403, code = 'AccessDenied') {
  return {
    statusCode,
    code,
    message: `${fakeId} ${fakeKey}`,
    url: fakeUrl,
    headers: { authorization: fakeKey },
  };
}

function safeFailure(error: unknown): boolean {
  assert(error instanceof CosPublishError);
  const output = `${error.code} ${error.message} ${error.stack}`;
  assert.match(error.code, /^[A-Z][A-Z0-9_]*$/);
  for (const sensitive of [fakeId, fakeKey, fakeUrl])
    assert(!output.includes(sensitive), 'raw SDK details must never reach a public error');
  return true;
}

test('COS adapter treats the real SDK empty HEAD 404 shape as an empty initial catalog', async () => {
  let reads = 0;
  const store = createCosStore(
    config,
    env,
    client({
      async headObject(params) {
        assert.deepEqual(params, { Bucket: config.bucket, Region: config.region, Key: key });
        // cos-nodejs-sdk-v5@3.0.0 returns numeric HTTP status but a string code
        // when HEAD has no XML error body. A real empty bucket takes this path.
        throw sdkFailure(404, '404');
      },
      async getObject() {
        reads++;
        assert.fail('an absent initial catalog must not trigger GET');
      },
    }),
  );
  assert.equal(await store.catalog(key), undefined);
  assert.equal(reads, 0);
});

test('COS adapter recognizes documented missing object variants without treating arbitrary 404 errors as missing', async () => {
  for (const code of ['404', 'NoSuchKey', 'NotFound', 'NoSuchObject', undefined]) {
    const store = createCosStore(
      config,
      env,
      client({
        async headObject() {
          throw { statusCode: 404, code };
        },
      }),
    );
    assert.equal(await store.head(key), undefined);
  }
  for (const [statusCode, code] of [
    [403, 'AccessDenied'],
    [403, '404'],
    [401, 'NotFound'],
    [404, 'NoSuchBucket'],
    [404, 'UnexpectedProviderError'],
    [500, 'NoSuchKey'],
  ] as const) {
    const store = createCosStore(
      config,
      env,
      client({
        async headObject() {
          throw sdkFailure(statusCode, code);
        },
      }),
    );
    await assert.rejects(store.catalog(key), safeFailure);
  }
  const missingBucket = createCosStore(
    config,
    env,
    client({
      async headObject() {
        throw { ...sdkFailure(404, '404'), error: { Code: 'NoSuchBucket' } };
      },
    }),
  );
  await assert.rejects(missingBucket.catalog(key), safeFailure);
});

test('COS adapter validates HEAD sizes and bounds a subsequent catalog GET', async () => {
  const body = Buffer.from('[{"public":"fixture"}]');
  const store = createCosStore(
    config,
    env,
    client({
      async headObject() {
        return { headers: { 'content-length': String(body.length) } };
      },
      async getObject(params) {
        assert.deepEqual(params, {
          Bucket: config.bucket,
          Region: config.region,
          Key: key,
          Range: 'bytes=0-1048576',
        });
        return { Body: body };
      },
    }),
  );
  assert.deepEqual(await store.catalog(key), body);

  for (const size of ['-1', '1.2', 'not-a-number', '9007199254740992']) {
    const invalid = createCosStore(
      config,
      env,
      client({
        async headObject() {
          return { headers: { 'content-length': size } };
        },
      }),
    );
    await assert.rejects(invalid.head(key), safeFailure);
  }
});

test('COS adapter refuses oversized or mismatching catalog responses and sanitizes GET failures', async () => {
  let gets = 0;
  const oversized = createCosStore(
    config,
    env,
    client({
      async headObject() {
        return { headers: { 'content-length': '1048577' } };
      },
      async getObject() {
        gets++;
        return { Body: Buffer.alloc(0) };
      },
    }),
  );
  await assert.rejects(oversized.catalog(key), safeFailure);
  assert.equal(gets, 0);
  for (const read of [
    async () => ({ Body: Buffer.from('wrong length') }),
    async () => {
      throw sdkFailure();
    },
  ]) {
    const store = createCosStore(config, env, client({ getObject: read }));
    await assert.rejects(store.catalog(key), safeFailure);
  }
});

test('COS adapter preserves never-enabled, enabled and suspended versioning states and sanitizes bucket failures', async () => {
  for (const status of [undefined, 'Enabled', 'Suspended']) {
    const store = createCosStore(
      config,
      env,
      client({
        async getBucketVersioning(params) {
          assert.deepEqual(params, { Bucket: config.bucket, Region: config.region });
          return { VersioningConfiguration: { Status: status } };
        },
      }),
    );
    assert.equal(await store.versioning(), status);
  }
  const rejected = createCosStore(
    config,
    env,
    client({
      async getBucketVersioning() {
        throw sdkFailure();
      },
    }),
  );
  await assert.rejects(rejected.versioning(), safeFailure);
});

test('COS adapter passes exact digest, no-overwrite and cache headers without cloud ACL changes', async () => {
  const body = Buffer.from('only-public-synthetic-bytes');
  const md5 = createHash('md5').update(body).digest('base64');
  const sha256 = createHash('sha256').update(body).digest('hex');
  for (const immutable of [true, false]) {
    let calls = 0;
    const store = createCosStore(
      config,
      env,
      client({
        async putObject(params) {
          calls++;
          assert.deepEqual(params, {
            Bucket: config.bucket,
            Region: config.region,
            Key: key,
            Body: body,
            ContentLength: body.length,
            ContentMD5: md5,
            CacheControl: immutable
              ? 'public, max-age=31536000, immutable'
              : 'no-cache, max-age=0, must-revalidate',
            ContentType: 'application/json; charset=utf-8',
            Headers: {
              'x-cos-meta-sha256': sha256,
              ...(immutable ? { 'x-cos-forbid-overwrite': 'true' } : {}),
            },
          });
          return {};
        },
      }),
    );
    await store.put({ key, body, bytes: body.length, md5, sha256, immutable });
    assert.equal(calls, 1);
  }
});

test('COS adapter sanitizes PUT failures without echoing SDK codes, headers, credentials or URLs', async () => {
  const store = createCosStore(
    config,
    env,
    client({
      async putObject() {
        throw sdkFailure(403, fakeKey);
      },
    }),
  );
  const body = Buffer.from('public fixture');
  await assert.rejects(
    store.put({
      key,
      body,
      bytes: body.length,
      md5: createHash('md5').update(body).digest('base64'),
      sha256: createHash('sha256').update(body).digest('hex'),
      immutable: true,
    }),
    safeFailure,
  );
});
