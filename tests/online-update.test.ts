import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { create as createTar } from 'tar';
import { ProgramUpdateService } from '../server/program-update';
import {
  OnlineUpdateService,
  selectOnlineRelease,
  parseOnlineSettings,
  UPDATE_REPOSITORY,
  UPDATE_CATALOG,
} from '../server/online-update';
import { readConfig } from '../server/config';
import { APPLICATION_VERSION } from '../shared/application';
import { verifyRelease, releaseFiles, releaseManifestSchema } from '../server/release-package';
import { digest, fileDigest } from '../server/full-backup';
import { MaintenanceError } from '../server/maintenance';

const nextVersion = '999.0.0-beta.19';
const name = `chronicle-cartarium-${nextVersion}-win-x64.ccupdate`;
function catalog(version = nextVersion, bytes = 3, sha256 = 'a'.repeat(64)) {
  const assetName = name.replace(nextVersion, version);
  return [
    {
      draft: false,
      prerelease: version.includes('-'),
      tag_name: `v${version}`,
      name: '测试新版',
      body: '改进说明',
      published_at: '2026-10-22T01:00:00Z',
      html_url: `${UPDATE_REPOSITORY}/releases/tag/v${version}`,
      assets: [
        {
          name: assetName,
          state: 'uploaded',
          size: bytes,
          digest: `sha256:${sha256}`,
          browser_download_url: `${UPDATE_REPOSITORY}/releases/download/v${version}/${assetName}`,
        },
      ],
    },
  ];
}
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-online-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    ...readConfig({ DATA_DIR: path.join(root, 'data') }),
    installRoot: root,
    deployment: 'managed' as const,
  };
  return { root, config, program: new ProgramUpdateService(config) };
}
async function settled(service: OnlineUpdateService) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await service.status();
    if (state.task && !['downloading', 'verifying'].includes(state.task.phase)) return state;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail('background task did not settle');
}

test('catalog selection uses semantic versions, stable/preview channels and exact fixed-repository platform assets', () => {
  const rows = [...catalog('0.2.0-beta.9'), ...catalog('0.2.0-beta.20'), ...catalog('0.2.0')];
  assert.equal(selectOnlineRelease(rows, 'preview', 'win32', 'x64')?.version, '0.2.0');
  assert.equal(selectOnlineRelease(rows, 'stable', 'win32', 'x64')?.version, '0.2.0');
  assert.equal(
    selectOnlineRelease(rows.slice(0, 2), 'preview', 'win32', 'x64')?.version,
    '0.2.0-beta.20',
  );
  assert.equal(selectOnlineRelease(rows.slice(0, 2), 'stable', 'win32', 'x64'), undefined);
  assert.equal(selectOnlineRelease(rows, 'preview', 'linux', 'x64')?.asset, undefined);
  const wrong = catalog();
  wrong[0].assets[0].browser_download_url = 'https://evil.example/app.ccupdate';
  assert.equal(selectOnlineRelease(wrong, 'preview', 'win32', 'x64')?.asset, undefined);
  const duplicate = catalog();
  duplicate[0].assets.push(duplicate[0].assets[0]);
  assert.equal(selectOnlineRelease(duplicate, 'preview', 'win32', 'x64')?.asset, undefined);
  assert.throws(
    () => selectOnlineRelease([...catalog(), ...catalog()], 'preview', 'win32', 'x64'),
    /重复/,
  );
  const oversize = catalog(nextVersion, 129 * 1024 ** 2);
  assert.equal(selectOnlineRelease(oversize, 'preview', 'win32', 'x64')?.asset, undefined);
  const foreign = catalog();
  foreign[0].html_url = 'https://evil.example/releases/tag/v0.2.0';
  assert.equal(selectOnlineRelease(foreign, 'preview', 'win32', 'x64'), undefined);
});

test('mirror configuration forbids credentials, private literals, HTTP, query and path escapes', () => {
  for (const base of [
    'http://cdn.example',
    'https://user:pass@cdn.example',
    'https://127.0.0.1',
    'https://[::1]',
    'https://cdn.example/?token=secret',
    'https://cdn.example/#key',
    'https://cdn.example:444',
    'https://cdn.example/%2e%2e/private',
  ])
    assert.throws(() =>
      parseOnlineSettings({ source: 'mirror', channel: 'preview', mirrorBaseUrl: base }),
    );
  assert.throws(() => parseOnlineSettings({ source: 'mirror', channel: 'stable' }));
  assert.equal(
    parseOnlineSettings({
      source: 'mirror',
      channel: 'preview',
      mirrorBaseUrl: 'https://cdn.example/chronicle///',
    }).mirrorBaseUrl,
    'https://cdn.example/chronicle',
  );
});

test('checks are cached, failures back off, settings persist and mirror checks fall back to GitHub', async (t) => {
  const { program, config } = await fixture(t);
  let now = Date.now();
  const calls: string[] = [];
  const service = new OnlineUpdateService(program, {
    now: () => now,
    platform: 'win32',
    architecture: 'x64',
    readJson: async (url) => {
      calls.push(url);
      if (url !== UPDATE_CATALOG) throw new Error('mirror offline');
      return catalog();
    },
  });
  assert.equal((await service.status()).settings.channel, 'preview');
  assert.equal(calls.length, 0);
  await service.saveSettings({
    channel: 'preview',
    source: 'mirror',
    mirrorBaseUrl: 'https://cdn.example/chronicle',
  });
  assert.equal((await service.check()).release?.version, nextVersion);
  assert.equal(calls.length, 2);
  assert.match((await service.status()).notice!, /GitHub/);
  await service.check();
  await service.status();
  assert.equal(calls.length, 2);
  now += 16 * 60_000;
  await service.check();
  assert.equal(calls.length, 4);
  const reopened = new OnlineUpdateService(new ProgramUpdateService(config));
  assert.equal((await reopened.status()).settings.mirrorBaseUrl, 'https://cdn.example/chronicle');
  const broken = new OnlineUpdateService(program, {
    now: () => now,
    readJson: async () => {
      calls.push('failure');
      throw new Error('private URL must not leak');
    },
  });
  assert.match((await broken.check()).checkError!, /一分钟/);
  const count = calls.length;
  await broken.check();
  assert.equal(calls.length, count);
  assert(!JSON.stringify(await broken.status()).includes('private URL'));
});

test('cancel reserves the program gate, prevents offline apply/import races and leaves original files intact', async (t) => {
  const { root, program } = await fixture(t);
  const sentinel = path.join(root, 'data', 'keep.txt');
  await mkdir(path.dirname(sentinel));
  await writeFile(sentinel, 'original');
  let started!: () => void;
  const downloading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const service = new OnlineUpdateService(program, {
    platform: 'win32',
    architecture: 'x64',
    readJson: async () => catalog(),
    download: async (_url, _file, _expected, _progress, signal) => {
      started();
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }),
      );
    },
  });
  await service.check();
  const state = await service.startDownload(nextVersion);
  await downloading;
  await assert.rejects(program.prepare('missing'), MaintenanceError);
  await assert.rejects(program.apply('package-any'), MaintenanceError);
  await assert.rejects(
    service.saveSettings({ source: 'github', channel: 'stable' }),
    MaintenanceError,
  );
  assert.equal((await service.cancel(state.task!.id)).task?.phase, 'cancelled');
  assert.equal(await readFile(sentinel, 'utf8'), 'original');
  await assert.rejects(readFile(path.join(program.root, 'pending-update.json')), {
    code: 'ENOENT',
  });
  // Gate is released, so the next import reaches file validation rather than staying busy forever.
  await assert.rejects(
    program.prepare('missing'),
    (error: unknown) => !(error instanceof MaintenanceError),
  );
});

test('a real signed downloaded archive is only staged, then separately applied; mirror transfer failure falls back', async (t) => {
  const { root, config } = await fixture(t);
  const release = path.join(root, 'fixture');
  for (const dir of ['dist', 'server', 'scripts', 'shared'])
    await mkdir(path.join(release, dir), { recursive: true });
  for (const [file, content] of Object.entries({
    'dist/index.html': 'fixture',
    'dist/app-version.json': JSON.stringify({ applicationVersion: nextVersion }),
    'server/index.ts': 'fixture',
    'scripts/launch.mjs': 'fixture',
    'shared/application.ts': `export const APPLICATION_VERSION = '${nextVersion}';`,
    'package.json': JSON.stringify({ version: nextVersion }),
  }))
    await writeFile(path.join(release, file), content);
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const id = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  const entries = [];
  for (const file of await releaseFiles(release))
    entries.push({
      path: file,
      bytes: (await readFile(path.join(release, file))).length,
      sha256: await fileDigest(path.join(release, file)),
    });
  const manifest = releaseManifestSchema.parse({
    format: 'worldloom-release',
    formatVersion: 1,
    version: nextVersion,
    minimumVersion: APPLICATION_VERSION,
    platform: process.platform,
    architecture: process.arch,
    mysqlSchema: 5,
    sqliteSchema: 1,
    workspaceFormat: 1,
    installationFormat: 1,
    userFormat: 1,
    keyId: id,
    entries,
  });
  await writeFile(
    path.join(release, 'RELEASE-MANIFEST.json'),
    JSON.stringify({
      manifest,
      signature: sign(null, Buffer.from(digest(manifest)), pair.privateKey).toString('base64'),
    }),
  );
  const archive = path.join(root, 'fixture.tar.gz');
  await createTar({ cwd: release, file: archive, gzip: true }, await readdir(release));
  const buffer = await readFile(archive);
  let entered!: () => void;
  let releaseVerification!: () => void;
  const verifying = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    releaseVerification = resolve;
  });
  const program = new ProgramUpdateService(config, async (dir) => {
    const verified = await verifyRelease(dir, APPLICATION_VERSION, { [id]: publicKey });
    entered();
    await barrier;
    return verified;
  });
  const calls: string[] = [];
  const service = new OnlineUpdateService(program, {
    platform: 'win32',
    architecture: 'x64',
    readJson: async () =>
      catalog(nextVersion, buffer.length, createHash('sha256').update(buffer).digest('hex')),
    download: async (url, file, _expected, progress) => {
      calls.push(url);
      if (!url.startsWith(UPDATE_REPOSITORY)) throw new Error('offline mirror');
      await writeFile(file, buffer, { flag: 'wx' });
      progress(buffer.length);
    },
  });
  await service.saveSettings({
    source: 'mirror',
    channel: 'preview',
    mirrorBaseUrl: 'https://cdn.example',
  });
  await service.check();
  await service.startDownload(nextVersion);
  await verifying;
  const duringVerification = await service.status();
  assert.equal(duringVerification.task?.phase, 'verifying');
  await assert.rejects(service.cancel(duringVerification.task!.id), /无法取消/);
  releaseVerification();
  const state = await settled(service);
  assert.equal(state.task?.phase, 'prepared');
  assert.equal(state.task?.source, 'github');
  assert.equal(calls.length, 2);
  assert.equal((await program.status()).packageId, state.task!.packageId);
  await assert.rejects(readFile(path.join(program.root, 'pending-update.json')), {
    code: 'ENOENT',
  });
  assert.deepEqual(await readdir(path.join(program.root, 'online-incoming')), []);
  await program.apply(state.task!.packageId!);
  assert.equal(
    JSON.parse(await readFile(path.join(program.root, 'pending-update.json'), 'utf8')).version,
    nextVersion,
  );
  const mismatch = new ProgramUpdateService(
    { ...config, installRoot: path.join(root, 'mismatch') },
    (dir) => verifyRelease(dir, APPLICATION_VERSION, { [id]: publicKey }),
  );
  await assert.rejects(
    mismatch.prepareOnline(async () => archive, '0.2.0-beta.20', new AbortController().signal),
    /版本不一致/,
  );
  assert.equal((await mismatch.status()).phase, 'idle');
  assert.deepEqual(await readdir(path.join(mismatch.root, 'staged')), []);
});

test('corrupt archive or signature never queues an update; manual and Docker do not download', async (t) => {
  const { program, config } = await fixture(t);
  const service = new OnlineUpdateService(program, {
    platform: 'win32',
    architecture: 'x64',
    readJson: async () => catalog(),
    download: async (_url, file) => {
      await writeFile(file, 'bad', { flag: 'wx' });
    },
  });
  await service.check();
  await service.startDownload(nextVersion);
  assert.equal((await settled(service)).task?.phase, 'error');
  assert.equal((await program.status()).phase, 'idle');
  await assert.rejects(readFile(path.join(program.root, 'pending-update.json')), {
    code: 'ENOENT',
  });
  for (const deployment of ['manual', 'docker'] as const) {
    const unsupported = new OnlineUpdateService(
      new ProgramUpdateService({ ...config, deployment }),
      { platform: 'win32', architecture: 'x64', readJson: async () => catalog() },
    );
    await unsupported.check();
    assert.equal((await unsupported.status()).supported, false);
    await assert.rejects(unsupported.startDownload(nextVersion));
  }
});
