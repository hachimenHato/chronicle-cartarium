import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createCosStore,
  loadCosConfig,
  CosPublishError,
  type CosSdkClient,
} from '../scripts/lib/cos-publisher';
import { formatCosDiagnostic } from '../scripts/lib/cos-diagnostics';

const fakeId = 'FAKE_ACCELERATION_TEST_ID';
const fakeKey = 'FAKE_ACCELERATION_TEST_SECRET';
const credentials = { TENCENT_COS_SECRET_ID: fakeId, TENCENT_COS_SECRET_KEY: fakeKey };
const config = loadCosConfig({
  COS_BUCKET: 'acceleration-fixture-1250000000',
  COS_REGION: 'ap-shanghai',
  COS_PREFIX: 'chronicle-cartarium/updates',
  COS_PUBLIC_BASE_URL: 'https://not-contacted.example/chronicle-cartarium/updates',
});
const body = Buffer.from('public bytes from a synthetic release only');
const input = {
  key: `${config.prefix}/v0.2.0-beta.19/synthetic.ccupdate`,
  body,
  bytes: body.length,
  md5: createHash('md5').update(body).digest('base64'),
  sha256: createHash('sha256').update(body).digest('hex'),
  immutable: true,
};

function clients() {
  const calls: { route: 'normal' | 'upload'; method: string; params: Record<string, unknown> }[] =
    [];
  function client(route: 'normal' | 'upload'): CosSdkClient {
    return {
      async getBucketVersioning(params) {
        calls.push({ route, method: 'getBucketVersioning', params });
        return { VersioningConfiguration: {} };
      },
      async headObject(params) {
        calls.push({ route, method: 'headObject', params });
        return { headers: { 'content-length': '2' } };
      },
      async getObject(params) {
        calls.push({ route, method: 'getObject', params });
        return { Body: Buffer.from('[]') };
      },
      async putObject(params) {
        calls.push({ route, method: 'putObject', params });
        return {};
      },
    };
  }
  return { normal: client('normal'), upload: client('upload'), calls };
}

test('COS upload acceleration stays off by default and for empty or false configuration', async () => {
  for (const flag of [undefined, '', 'false']) {
    const f = clients();
    const env = flag === undefined ? credentials : { ...credentials, COS_UPLOAD_ACCELERATE: flag };
    const store = createCosStore(config, env, f.normal, f.upload);
    await store.put(input);
    assert.deepEqual(
      f.calls.map(({ route, method }) => ({ route, method })),
      [{ route: 'normal', method: 'putObject' }],
    );
    assert.equal(config.publicBaseUrl, 'https://not-contacted.example/chronicle-cartarium/updates');
  }
});

test('COS acceleration opt-in routes only PUT through the separate upload client', async () => {
  const f = clients();
  const store = createCosStore(
    config,
    { ...credentials, COS_UPLOAD_ACCELERATE: 'true' },
    f.normal,
    f.upload,
  );
  assert.equal(await store.versioning(), undefined);
  assert.deepEqual(await store.head(input.key), { bytes: 2 });
  assert.deepEqual(await store.catalog(`${config.prefix}/releases.json`), Buffer.from('[]'));
  await store.put(input);
  await store.put({ ...input, key: `${config.prefix}/releases.json`, immutable: false });
  assert.deepEqual(
    f.calls.map(({ route, method }) => ({ route, method })),
    [
      { route: 'normal', method: 'getBucketVersioning' },
      { route: 'normal', method: 'headObject' },
      { route: 'normal', method: 'headObject' },
      { route: 'normal', method: 'getObject' },
      { route: 'upload', method: 'putObject' },
      { route: 'upload', method: 'putObject' },
    ],
  );
});

test('COS acceleration preserves immutable object protection, checksums, metadata and progress callbacks', async () => {
  const f = clients();
  const store = createCosStore(
    config,
    { ...credentials, COS_UPLOAD_ACCELERATE: 'true' },
    f.normal,
    f.upload,
  );
  const onProgress = () => {};
  await store.put({ ...input, onProgress });
  const params = f.calls[0].params;
  assert.equal(params.Bucket, config.bucket);
  assert.equal(params.Region, config.region);
  assert.equal(params.Key, input.key);
  assert.equal(params.Body, body);
  assert.equal(params.ContentLength, input.bytes);
  assert.equal(params.ContentMD5, input.md5);
  assert.equal(params.ContentType, 'application/octet-stream');
  assert.equal(params.CacheControl, 'public, max-age=31536000, immutable');
  assert.deepEqual(params.Headers, {
    'x-cos-meta-sha256': input.sha256,
    'x-cos-forbid-overwrite': 'true',
  });
  assert.equal(params.onProgress, onProgress);
  assert(!Object.hasOwn(params, 'ACL'));
  assert(
    !Object.hasOwn(params, 'UseAccelerate'),
    'SDK acceleration belongs to the independent client',
  );
});

test('COS acceleration rejects noncanonical flags before using either client and emits only the fixed diagnostic', () => {
  for (const flag of ['TRUE', 'True', '1', 'yes', ' false', 'true ', fakeKey, '\ntrue', false, 1]) {
    const f = clients();
    assert.throws(
      () =>
        createCosStore(
          config,
          { ...credentials, COS_UPLOAD_ACCELERATE: flag } as NodeJS.ProcessEnv,
          f.normal,
          f.upload,
        ),
      (error) => {
        assert(error instanceof CosPublishError);
        assert.equal(error.code, 'COS_ACCELERATE');
        assert.equal(formatCosDiagnostic(error), 'COS_ACCELERATE');
        assert(!`${error.message} ${error.stack}`.includes(fakeKey));
        return true;
      },
    );
    assert.equal(f.calls.length, 0);
  }
});

test('COS acceleration never silently retries on the ordinary endpoint or leaks provider details after upload failure', async () => {
  const f = clients();
  f.upload.putObject = async () => {
    throw {
      statusCode: 403,
      code: 'InvalidRequest',
      message: fakeKey,
      headers: { authorization: fakeId },
      url: `https://not-contacted.example/?secret=${fakeKey}`,
    };
  };
  const store = createCosStore(
    config,
    { ...credentials, COS_UPLOAD_ACCELERATE: 'true' },
    f.normal,
    f.upload,
  );
  await assert.rejects(store.put(input), (error) => {
    assert(error instanceof CosPublishError);
    assert.equal(formatCosDiagnostic(error), 'COS_WRITE / HTTP_403 / InvalidRequest');
    assert(!`${error.message} ${error.stack}`.includes(fakeKey));
    assert(!`${error.message} ${error.stack}`.includes(fakeId));
    return true;
  });
  assert.equal(f.calls.length, 0, 'failed accelerated PUT must not fall back or repeat a write');
});
