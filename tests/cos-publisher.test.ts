import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { create as createTar } from 'tar';
import {
  CosPublishError,
  createCosStore,
  loadCosConfig,
  planCosMirror,
  publishCosMirror,
  type CosStore,
  type MirrorFile,
} from '../scripts/lib/cos-publisher';
import type { PublicMirrorRelease } from '../scripts/create-update-mirror.mjs';

const require = createRequire(import.meta.url);
const { digest } = require('../shared/desktop-update-security.cjs') as {
  digest: (value: unknown) => string;
};
const repository = 'https://github.com/hachimenHato/chronicle-cartarium';
const version = '0.2.0-beta.19';
const config = loadCosConfig({
  COS_BUCKET: 'fixture-1250000000',
  COS_REGION: 'ap-shanghai',
  COS_PREFIX: 'chronicle-cartarium/updates',
  COS_PUBLIC_BASE_URL: 'https://downloads.example.com/chronicle-cartarium/updates',
});

function hashes(bytes: Buffer) {
  return {
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    md5: createHash('md5').update(bytes).digest('base64'),
  };
}

function publicRelease(target = version): PublicMirrorRelease {
  return {
    tag_name: `v${target}`,
    name: `Isolated ${target}`,
    body: 'Public, synthetic test release only.',
    html_url: `${repository}/releases/tag/v${target}`,
    draft: false,
    prerelease: target.includes('-'),
    published_at: '2026-10-23T00:00:00Z',
    assets: [],
  };
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-cos-publisher-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith('chronicle-cos-publisher-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function addAsset(
  directory: string,
  release: PublicMirrorRelease,
  name: string,
  body: Buffer,
) {
  const relative = `${release.tag_name}/${name}`;
  const filename = path.join(directory, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, body);
  const metadata = hashes(body);
  release.assets.push({
    name,
    size: body.length,
    digest: `sha256:${metadata.sha256}`,
    browser_download_url: `${repository}/releases/download/${release.tag_name}/${name}`,
    state: 'uploaded',
  });
  return { relative, filename, ...metadata };
}

function keyPair() {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyId = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  return { privateKey: pair.privateKey, keyId, keys: { [keyId]: publicKey } };
}

async function signedBackend(
  root: string,
  directory: string,
  release: PublicMirrorRelease,
  pair: ReturnType<typeof keyPair>,
  options: { tamperAfterSigning?: boolean; privatePath?: string } = {},
) {
  const payload = path.join(root, 'payload');
  await mkdir(payload);
  const contents = new Map([
    ['package.json', JSON.stringify({ version })],
    ['dist/index.html', '<html>Only synthetic fixture content</html>'],
    ['dist/app-version.json', JSON.stringify({ applicationVersion: version })],
    ['server/index.ts', 'export {};'],
    ['shared/application.ts', `export const APPLICATION_VERSION = '${version}';`],
    ['scripts/launch.mjs', 'export {};'],
  ]);
  if (options.privatePath) contents.set(options.privatePath, 'FAKE_CREDENTIAL_FIXTURE_ONLY');
  for (const [name, body] of contents) {
    await mkdir(path.dirname(path.join(payload, name)), { recursive: true });
    await writeFile(path.join(payload, name), body);
  }
  const entries = [...contents]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, body]) => ({
      path: name,
      bytes: Buffer.byteLength(body),
      sha256: hashes(Buffer.from(body)).sha256,
    }));
  const manifest = {
    format: 'worldloom-release',
    formatVersion: 1,
    version,
    minimumVersion: '0.2.0-beta.5',
    platform: 'win32',
    architecture: 'x64',
    mysqlSchema: 5,
    sqliteSchema: 1,
    workspaceFormat: 1,
    installationFormat: 1,
    userFormat: 1,
    keyId: pair.keyId,
    entries,
  };
  await writeFile(
    path.join(payload, 'RELEASE-MANIFEST.json'),
    JSON.stringify({
      manifest,
      signature: sign(null, Buffer.from(digest(manifest)), pair.privateKey).toString('base64'),
    }),
  );
  if (options.tamperAfterSigning) await writeFile(path.join(payload, 'dist/index.html'), 'changed');
  const archive = path.join(root, 'fixture.ccupdate');
  await createTar({ cwd: payload, file: archive, gzip: true, portable: true }, [
    ...contents.keys(),
    'RELEASE-MANIFEST.json',
  ]);
  return addAsset(
    directory,
    release,
    `chronicle-cartarium-${version}-win-x64.ccupdate`,
    await readFile(archive),
  );
}

async function signedDesktop(
  directory: string,
  release: PublicMirrorRelease,
  pair: { privateKey: KeyObject; keyId: string },
) {
  // The planner verifies this signed archive's bytes; extraction is separately guarded by the desktop updater.
  const archive = await addAsset(
    directory,
    release,
    `chronicle-cartarium-${version}-windows-desktop-x64.zip`,
    Buffer.from('synthetic signed desktop archive bytes'),
  );
  const manifest = {
    format: 'chronicle-cartarium-desktop-update',
    formatVersion: 1,
    version,
    minimumShellVersion: version,
    platform: 'win32',
    architecture: 'x64',
    keyId: pair.keyId,
    archive: {
      name: path.basename(archive.filename),
      bytes: archive.bytes,
      sha256: archive.sha256,
    },
    treeSha256: 'a'.repeat(64),
    entrypoints: {
      'Chronicle Cartarium.exe': 'b'.repeat(64),
      'resources/app.asar': 'c'.repeat(64),
      'resources/backend/runtime/node.exe': 'd'.repeat(64),
    },
  };
  const metadata = await addAsset(
    directory,
    release,
    `chronicle-cartarium-${version}-windows-desktop-x64.update.json`,
    Buffer.from(
      JSON.stringify({
        manifest,
        signature: sign(null, Buffer.from(digest(manifest)), pair.privateKey).toString('base64'),
      }),
    ),
  );
  return { archive, metadata };
}

async function writeCatalog(directory: string, releases: PublicMirrorRelease[]) {
  await writeFile(path.join(directory, 'releases.json'), JSON.stringify(releases, null, 2) + '\n');
}

class MemoryStore implements CosStore {
  objects = new Map<string, Buffer>();
  events: string[] = [];
  puts: Parameters<CosStore['put']>[0][] = [];
  state: string | undefined;
  catalogReads = 0;
  beforeCatalog?: (read: number) => void;
  beforePut?: (input: Parameters<CosStore['put']>[0]) => void;
  afterPut?: (input: Parameters<CosStore['put']>[0]) => void;
  async versioning() {
    this.events.push('versioning');
    return this.state;
  }
  async head(key: string) {
    this.events.push(`head:${key}`);
    const body = this.objects.get(key);
    return body ? { bytes: body.length } : undefined;
  }
  async catalog(key: string) {
    this.catalogReads += 1;
    this.beforeCatalog?.(this.catalogReads);
    this.events.push(`catalog:${key}`);
    const body = this.objects.get(key);
    return body ? Buffer.from(body) : undefined;
  }
  async put(input: Parameters<CosStore['put']>[0]) {
    this.beforePut?.(input);
    this.puts.push(input);
    this.events.push(`put:${input.key}`);
    if (input.immutable)
      assert(!this.objects.has(input.key), 'immutable objects must never be overwritten');
    const body = input.body || (await readFile(input.file!));
    assert.deepEqual({ bytes: input.bytes, sha256: input.sha256, md5: input.md5 }, hashes(body));
    this.objects.set(input.key, Buffer.from(body));
    this.afterPut?.(input);
  }
  deleteObject() {
    assert.fail('publisher must not delete an existing object or restore an older catalog');
  }
}

async function publishing(t: TestContext, target = version) {
  const root = await fixture(t);
  const directory = path.join(root, 'mirror');
  await mkdir(directory);
  const release = publicRelease(target);
  const files = [
    await addAsset(
      directory,
      release,
      `chronicle-cartarium-${target}-win-x64.ccupdate`,
      Buffer.from('signed-fixture-A'),
    ),
    await addAsset(
      directory,
      release,
      `chronicle-cartarium-${target}-linux-x64.ccupdate`,
      Buffer.from('signed-fixture-B'),
    ),
  ];
  await writeCatalog(directory, [release]);
  const store = new MemoryStore();
  const verifyPublic = async (file: MirrorFile, url: string) => {
    assert.equal(url, `${config.publicBaseUrl}/${file.relative}`);
    store.events.push(`public:${file.relative}`);
    const body = store.objects.get(`${config.prefix}/${file.relative}`);
    assert(body, 'every advertised object must be anonymously readable');
    assert.deepEqual(hashes(body), { bytes: file.bytes, sha256: file.sha256, md5: file.md5 });
  };
  const options = {
    directory,
    config,
    store,
    verifyPublic,
    dependencies: { plan: async () => ({ files, releases: [release] }) },
  };
  return { ...options, options, files, release, catalogKey: `${config.prefix}/releases.json` };
}

test('COS config only accepts an isolated safe prefix and public HTTPS base without credentials or query', () => {
  assert.equal(config.prefix, 'chronicle-cartarium/updates');
  assert.equal(
    loadCosConfig({ COS_BUCKET: config.bucket, COS_REGION: config.region }).publicBaseUrl,
    `https://${config.bucket}.cos.${config.region}.myqcloud.com/chronicle-cartarium/updates`,
  );
  for (const change of [
    { COS_BUCKET: 'bucket-without-appid' },
    { COS_REGION: 'ap-shanghai/other' },
    { COS_PREFIX: '/' },
    { COS_PREFIX: 'updates' },
    { COS_PREFIX: 'updates/../private' },
    { COS_PREFIX: 'updates/%2e%2e' },
    { COS_PUBLIC_BASE_URL: 'http://downloads.example.com/chronicle-cartarium/updates' },
    {
      COS_PUBLIC_BASE_URL: 'https://user:secret@downloads.example.com/chronicle-cartarium/updates',
    },
    { COS_PUBLIC_BASE_URL: config.publicBaseUrl + '?secret=fixture' },
    { COS_PUBLIC_BASE_URL: config.publicBaseUrl + '#fragment' },
    { COS_PUBLIC_BASE_URL: 'https://127.0.0.1/chronicle-cartarium/updates' },
    { COS_PUBLIC_BASE_URL: 'https://downloads.example.com:8443/chronicle-cartarium/updates' },
    { COS_PUBLIC_BASE_URL: 'https://downloads.example.com/different/prefix' },
  ])
    assert.throws(
      () => loadCosConfig({ COS_BUCKET: config.bucket, COS_REGION: config.region, ...change }),
      CosPublishError,
    );
  assert.throws(
    () => createCosStore(config, { TENCENT_COS_SECRET_ID: 'DUMMY_ID_NOT_A_CREDENTIAL' }),
    (error: unknown) => {
      assert(error instanceof CosPublishError);
      assert.equal(error.code, 'CREDENTIALS');
      assert(!String(error).includes('DUMMY_ID_NOT_A_CREDENTIAL'));
      return true;
    },
  );
});

test('COS planner verifies TAR manifest files and desktop signatures with RAM-only test Ed25519 trust', async (t) => {
  const root = await fixture(t),
    directory = path.join(root, 'mirror');
  await mkdir(directory);
  const pair = keyPair(),
    release = publicRelease();
  await signedBackend(root, directory, release, pair);
  await signedDesktop(directory, release, pair);
  await writeCatalog(directory, [release]);
  const plan = await planCosMirror(directory, pair.keys);
  assert.equal(plan.files.length, 3);
  assert.equal(plan.releases[0].tag_name, `v${version}`);
  await assert.rejects(planCosMirror(directory, keyPair().keys));
  await writeFile(path.join(directory, '.env.cos'), 'FAKE_SECRET_MUST_NOT_UPLOAD');
  await assert.rejects(planCosMirror(directory, pair.keys), /EXTRA_FILE/);
});

test('COS planner rejects internal TAR tampering even when the outer GitHub size and SHA match', async (t) => {
  const root = await fixture(t),
    directory = path.join(root, 'mirror');
  await mkdir(directory);
  const pair = keyPair(),
    release = publicRelease();
  await signedBackend(root, directory, release, pair, { tamperAfterSigning: true });
  await writeCatalog(directory, [release]);
  await assert.rejects(planCosMirror(directory, pair.keys), /MANIFEST_HASH/);
});

test('COS planner rejects a changed desktop archive even when the public catalog advertises its new hash', async (t) => {
  const root = await fixture(t),
    directory = path.join(root, 'mirror');
  await mkdir(directory);
  const pair = keyPair(),
    release = publicRelease();
  const { archive } = await signedDesktop(directory, release, pair);
  const replacement = Buffer.from('changed ZIP whose new digest appears in the catalog');
  await writeFile(archive.filename, replacement);
  const asset = release.assets.find((a) => a.name.endsWith('.zip'))!;
  asset.size = replacement.length;
  asset.digest = `sha256:${hashes(replacement).sha256}`;
  await writeCatalog(directory, [release]);
  await assert.rejects(planCosMirror(directory, pair.keys), /DESKTOP_SIGNATURE/);
});

test('invalid private TAR paths produce a handled rejection instead of an uncaught stream exception', async (t) => {
  const root = await fixture(t),
    directory = path.join(root, 'mirror');
  await mkdir(directory);
  const pair = keyPair(),
    release = publicRelease();
  await signedBackend(root, directory, release, pair, { privatePath: '.env.cos' });
  await writeCatalog(directory, [release]);
  const helper = path.join(root, 'verify.mjs');
  await writeFile(
    helper,
    `import {planCosMirror} from ${JSON.stringify(pathToFileURL(path.resolve('scripts/lib/cos-publisher.ts')).href)};\ntry {await planCosMirror(${JSON.stringify(directory)}, ${JSON.stringify(pair.keys)}); process.exitCode=2;} catch {console.log('handled-private-path');}\n`,
  );
  const child = spawnSync(
    process.execPath,
    ['--import', pathToFileURL(path.resolve('node_modules/tsx/dist/loader.mjs')).href, helper],
    {
      encoding: 'utf8',
      windowsHide: true,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), 'handled-private-path');
});

test('COS upload uses only the configured prefix, verifies every package and publishes the catalog last', async (t) => {
  const f = await publishing(t);
  const result = await publishCosMirror(f.options);
  assert.equal(result.packages, 2);
  assert.equal(result.releases, 1);
  assert.deepEqual(
    f.store.puts.map((item) => item.key),
    [...f.files.map((file) => `${config.prefix}/${file.relative}`), f.catalogKey],
  );
  assert(f.store.puts.slice(0, -1).every((item) => item.immutable));
  assert.equal(f.store.puts.at(-1)!.immutable, false);
  assert(
    f.store.events.indexOf(`public:${f.files[1].relative}`) <
      f.store.events.indexOf(`put:${f.catalogKey}`),
  );
  assert.equal(f.store.events.at(-1), 'public:releases.json');
});

test('COS refuses enabled or suspended versioning before any object write or catalog access', async (t) => {
  const f = await publishing(t);
  for (const state of ['Enabled', 'Suspended']) {
    f.store.state = state;
    await assert.rejects(publishCosMirror(f.options), /BUCKET_VERSIONING/);
  }
  assert.equal(f.store.puts.length, 0);
  assert.equal(f.store.catalogReads, 0);
});

test('COS never overwrites existing packages and refuses same-length corrupted remote bytes', async (t) => {
  const f = await publishing(t);
  for (const file of f.files)
    f.store.objects.set(`${config.prefix}/${file.relative}`, await readFile(file.filename));
  await publishCosMirror(f.options);
  assert.deepEqual(
    f.store.puts.map((item) => item.key),
    [f.catalogKey],
  );
  const originalCatalog = Buffer.from(f.store.objects.get(f.catalogKey)!);
  f.store.puts = [];
  const changed = Buffer.from(await readFile(f.files[0].filename));
  changed[0] ^= 1;
  f.store.objects.set(`${config.prefix}/${f.files[0].relative}`, changed);
  await assert.rejects(publishCosMirror(f.options));
  assert.equal(f.store.puts.length, 0);
  assert.deepEqual(f.store.objects.get(f.catalogKey), originalCatalog);
});

test('COS refuses malformed remote catalogs and changed assets for an existing release', async (t) => {
  const f = await publishing(t);
  for (const body of [
    Buffer.from('{bad-json'),
    Buffer.from('[]'),
    Buffer.from('[{"draft":true}]'),
  ]) {
    f.store.objects.set(f.catalogKey, body);
    await assert.rejects(publishCosMirror(f.options), /CATALOG/);
    assert.equal(f.store.puts.length, 0);
    assert.deepEqual(f.store.objects.get(f.catalogKey), body);
  }
  const old = structuredClone(f.release);
  old.assets[0].digest = `sha256:${'0'.repeat(64)}`;
  await writeCatalog(f.directory, [f.release]);
  f.store.objects.set(f.catalogKey, Buffer.from(JSON.stringify([old])));
  await assert.rejects(publishCosMirror(f.options), /EXISTING_VERSION_CHANGED/);
  assert.equal(f.store.puts.length, 0);
});

test('a failed package upload or public verification never updates or restores the old catalog', async (t) => {
  for (const failure of ['upload', 'public']) {
    const f = await publishing(t);
    const older = publicRelease('0.2.0-beta.18');
    older.assets = f.release.assets.map((a) => ({
      ...a,
      name: a.name.replace(version, '0.2.0-beta.18'),
      browser_download_url: a.browser_download_url.replaceAll(version, '0.2.0-beta.18'),
    }));
    const previous = Buffer.from(JSON.stringify([older]));
    f.store.objects.set(f.catalogKey, previous);
    if (failure === 'upload')
      f.store.beforePut = (input) => {
        if (input.key.endsWith('linux-x64.ccupdate')) throw new Error('mock failure');
      };
    const verifyPublic =
      failure === 'public'
        ? async () => {
            throw new Error('public readback failed');
          }
        : f.verifyPublic;
    await assert.rejects(publishCosMirror({ ...f.options, verifyPublic }));
    assert(!f.store.puts.some((item) => item.key === f.catalogKey));
    assert.deepEqual(f.store.objects.get(f.catalogKey), previous);
    assert(
      f.store.objects.has(`${config.prefix}/${f.files[0].relative}`),
      'already uploaded immutable bytes remain available',
    );
  }
});

test('COS detects a changed remote catalog before committing and leaves the concurrent publisher intact', async (t) => {
  const f = await publishing(t);
  const concurrent = Buffer.from(JSON.stringify([publicRelease('0.2.0-beta.20')]));
  f.store.beforeCatalog = (read) => {
    if (read === 2) f.store.objects.set(f.catalogKey, concurrent);
  };
  await assert.rejects(publishCosMirror(f.options), /CONCURRENT_PUBLISH/);
  assert(!f.store.puts.some((item) => item.key === f.catalogKey));
  assert.deepEqual(f.store.objects.get(f.catalogKey), concurrent);
});

test('COS confirms a committed catalog after a lost PUT reply without restoring or overwriting it', async (t) => {
  const f = await publishing(t);
  const older = publicRelease('0.2.0-beta.18');
  f.store.objects.set(f.catalogKey, Buffer.from(JSON.stringify([older])));
  f.store.afterPut = (input) => {
    if (input.key === f.catalogKey) throw new Error('lost response after successful commit');
  };
  await publishCosMirror(f.options);
  assert.equal(f.store.puts.filter((item) => item.key === f.catalogKey).length, 1);
  assert.deepEqual(JSON.parse(f.store.objects.get(f.catalogKey)!.toString()), [f.release, older]);
  assert.equal(f.store.events.at(-1), 'public:releases.json');
});

test('COS leaves a previous catalog intact when the catalog PUT failed before committing', async (t) => {
  const f = await publishing(t);
  const previous = Buffer.from(JSON.stringify([publicRelease('0.2.0-beta.18')]));
  f.store.objects.set(f.catalogKey, previous);
  f.store.beforePut = (input) => {
    if (input.key === f.catalogKey) throw new Error('failed before catalog write');
  };
  await assert.rejects(publishCosMirror(f.options), /CATALOG_COMMIT_UNCONFIRMED/);
  assert.deepEqual(f.store.objects.get(f.catalogKey), previous);
  assert(!f.store.events.includes('public:releases.json'));
});

test('re-publishing identical bytes is idempotent while still verifying the public packages and catalog', async (t) => {
  const f = await publishing(t);
  await publishCosMirror(f.options);
  f.store.puts = [];
  f.store.events = [];
  await publishCosMirror(f.options);
  assert.equal(f.store.puts.length, 0);
  assert.deepEqual(
    f.store.events.filter((event) => event.startsWith('public:')),
    [...f.files.map((file) => `public:${file.relative}`), 'public:releases.json'],
  );
});

test('COS merges previous releases and verifies the resulting public catalog rather than the local one-release file', async (t) => {
  const f = await publishing(t);
  const older = publicRelease('0.2.0-beta.18');
  f.store.objects.set(f.catalogKey, Buffer.from(JSON.stringify([older])));
  const result = await publishCosMirror(f.options);
  assert.equal(result.releases, 2);
  assert.deepEqual(
    JSON.parse(f.store.objects.get(f.catalogKey)!.toString()).map(
      (r: PublicMirrorRelease) => r.tag_name,
    ),
    [f.release.tag_name, older.tag_name],
  );
  assert.equal(f.store.events.at(-1), 'public:releases.json');
});
