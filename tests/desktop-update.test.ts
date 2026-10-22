import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync, createHash, sign, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { DesktopUpdateService, desktopTree, selectDesktopRelease } from '../server/desktop-update';
import { UPDATE_REPOSITORY } from '../server/online-update';
const require = createRequire(import.meta.url);
const {
  digest,
  verifyDesktopManifest,
  releaseDirectory,
} = require('../shared/desktop-update-security.cjs');
const { run: handoff } = require('../desktop/shell-update-helper.cjs');
const { ShellUpdater } = require('../desktop/shell-update.cjs');
const version = '999.0.0-beta.2';
const current = '0.2.0-beta.19';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
test('native desktop updates require owner identity and never treat permission errors as old-backend fallback', async () => {
  for (const role of [undefined, 'viewer', 'moderator', 'owner']) {
    const visits: string[] = [];
    const updater = new ShellUpdater({
      app: { getVersion: () => '0.2.0-beta.19' },
      getBackend: () => ({ origin: 'http://127.0.0.1:3313' }),
      window: {
        webContents: {
          session: {
            fetch: async (url: string) => {
              visits.push(url);
              return url.endsWith('/api/status')
                ? { ok: true, json: async () => ({ actor: role ? { role } : undefined }) }
                : { ok: false, status: 403 };
            },
          },
        },
      },
    });
    await assert.rejects(updater.ownerSettings(), role === 'owner' ? /更新配置/ : /主管理员/);
    assert.equal(visits.length, role === 'owner' ? 2 : 1);
  }
  let permission = 404;
  const updater = new ShellUpdater({
    app: { getVersion: () => current },
    getBackend: () => ({ origin: 'http://127.0.0.1:3313' }),
    window: {
      webContents: {
        session: {
          fetch: async (url: string) =>
            url.endsWith('/api/status')
              ? { ok: true, json: async () => ({ actor: { role: 'owner' } }) }
              : { ok: false, status: permission },
        },
      },
    },
  });
  await assert.rejects(updater.ownerSettings(), /工作台后端升级/);
  permission = 401;
  await assert.rejects(updater.ownerSettings(), /更新配置/);
});
const files = {
  'Chronicle Cartarium.exe': 'fixture-exe',
  'resources/app.asar': 'fixture-asar',
  'resources/backend/runtime/node.exe': 'fixture-node',
  'LICENSE.txt': 'fixture-license',
};
function fixtureSignature() {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyId = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  const entries = Object.entries(files)
    .map(([name, content]) => ({
      path: name,
      bytes: Buffer.byteLength(content),
      sha256: hash(content),
    }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const manifest = {
    format: 'chronicle-cartarium-desktop-update',
    formatVersion: 1,
    version,
    minimumShellVersion: current,
    platform: 'win32',
    architecture: 'x64',
    keyId,
    archive: {
      name: `chronicle-cartarium-${version}-windows-desktop-x64.zip`,
      bytes: 3,
      sha256: hash('zip'),
    },
    treeSha256: digest(entries),
    entrypoints: Object.fromEntries(
      Object.entries(files)
        .filter(([name]) => name !== 'LICENSE.txt')
        .map(([name, content]) => [name, hash(content)]),
    ),
  };
  const signed = {
    manifest,
    signature: sign(null, Buffer.from(digest(manifest)), pair.privateKey).toString('base64'),
  };
  return { signed, trust: { [keyId]: publicKey } };
}
function catalog() {
  return [
    {
      tag_name: `v${version}`,
      html_url: `${UPDATE_REPOSITORY}/releases/tag/v${version}`,
      name: 'fixture',
      body: '',
      draft: false,
      prerelease: true,
      assets: ['.zip', '.update.json'].map((suffix) => ({
        name: `chronicle-cartarium-${version}-windows-desktop-x64${suffix}`,
        size: 3,
        digest: 'sha256:' + hash('zip'),
        state: 'uploaded',
        browser_download_url: `${UPDATE_REPOSITORY}/releases/download/v${version}/chronicle-cartarium-${version}-windows-desktop-x64${suffix}`,
      })),
    },
  ];
}
async function temporary(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'chronicle-desktop-update-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return base;
}

test('desktop metadata binds the entire archive/tree/entrypoints to the original Ed25519 trust', () => {
  const { signed, trust } = fixtureSignature();
  assert.equal(verifyDesktopManifest(signed, current, trust).version, version);
  assert.throws(() => verifyDesktopManifest(signed, current, {}), /签名/);
  for (const field of ['treeSha256', 'version']) {
    const changed = structuredClone(signed);
    (changed.manifest as Record<string, unknown>)[field] =
      field === 'version' ? '999.0.0-beta.3' : 'a'.repeat(64);
    assert.throws(() => verifyDesktopManifest(changed, current, trust));
  }
  assert.throws(() => verifyDesktopManifest(signed, version, trust), /升级/);
  assert.throws(() => verifyDesktopManifest(signed, '0.1.0', trust), /升级/);
  assert.throws(() => releaseDirectory('C:/fixture', '../workspace'));
  assert.throws(() =>
    verifyDesktopManifest({ ...signed, url: 'https://evil.example' }, current, trust),
  );
});

test('desktop discovery requires both canonical ZIP and signed descriptor assets and respects channels', () => {
  assert.equal(selectDesktopRelease(catalog(), current, 'preview')?.version, version);
  assert.equal(selectDesktopRelease(catalog(), current, 'stable'), undefined);
  const missing = catalog();
  missing[0].assets.pop();
  assert.equal(selectDesktopRelease(missing, current, 'preview'), undefined);
  const foreign = catalog();
  foreign[0].assets[0].browser_download_url = 'https://evil.example/file.zip';
  assert.equal(selectDesktopRelease(foreign, current, 'preview'), undefined);
  assert.throws(
    () => selectDesktopRelease([...catalog(), ...catalog()], current, 'preview'),
    /重复/,
  );
});

test('desktop staging verifies every extracted file and never copies into an existing workspace', async (t) => {
  const base = await temporary(t),
    { signed, trust } = fixtureSignature();
  await mkdir(path.join(base, 'workspace/data'), { recursive: true });
  const keep = path.join(base, 'workspace/data/keep.txt');
  await writeFile(keep, 'newest-user-content');
  const service = new DesktopUpdateService(
    current,
    { source: 'github', channel: 'preview' },
    {
      trust,
      readJson: async () => signed,
      download: async (_url, file, _expected, progress) => {
        await writeFile(file, 'zip', { flag: 'wx' });
        progress(3);
      },
      extract: async (_file, destination) => {
        for (const [name, content] of Object.entries(files)) {
          await mkdir(path.dirname(path.join(destination, name)), { recursive: true });
          await writeFile(path.join(destination, name), content);
        }
      },
    },
  );
  const candidate = selectDesktopRelease(catalog(), current, 'preview')!;
  const staged = await service.stage(base, candidate, new AbortController().signal, () => {});
  assert.equal(staged.version, version);
  assert.equal(
    (await desktopTree(path.join(releaseDirectory(base, staged.releaseId), 'app'))).sha256,
    signed.manifest.treeSha256,
  );
  assert.equal(await readFile(keep, 'utf8'), 'newest-user-content');
  assert.equal(
    (await readdir(path.join(base, '.desktop'))).filter((name) => name.startsWith('download-'))
      .length,
    0,
  );
  const corrupt = new DesktopUpdateService(
    current,
    { source: 'github', channel: 'preview' },
    {
      trust,
      readJson: async () => signed,
      download: async (_url, file) => {
        await writeFile(file, 'zip');
      },
      extract: async (_file, destination) => {
        await mkdir(destination);
        await writeFile(path.join(destination, 'intruder.exe'), 'bad');
      },
    },
  );
  await assert.rejects(
    corrupt.stage(base, candidate, new AbortController().signal, () => {}),
    /签名/,
  );
  assert.deepEqual(await readdir(path.join(base, '.desktop/releases')), [staged.releaseId]);
  assert.equal(await readFile(keep, 'utf8'), 'newest-user-content');
});

test('desktop handoff commits only after nonce/workspace verification; failure never restores old world data', async (t) => {
  for (const success of [true, false]) {
    const base = await temporary(t),
      id = randomUUID(),
      releaseId = 'shell-' + randomUUID();
    const updates = path.join(base, '.desktop/updates');
    await mkdir(updates, { recursive: true });
    const workspace = path.join(base, 'workspace');
    await mkdir(workspace);
    await writeFile(path.join(workspace, 'newest.txt'), 'content-saved-after-backup');
    const before = {
      revision: 5,
      digest: hash('before'),
      installation: hash('installation'),
      users: hash('users'),
    };
    const job = {
      format: 1,
      id,
      nonce: 'a'.repeat(64),
      version,
      releaseId,
      parentPid: 12345,
      workspace,
      oldExe: path.join(base, 'Chronicle Cartarium.exe'),
      before,
    };
    await writeFile(path.join(updates, `job-${id}.json`), JSON.stringify(job));
    await writeFile(
      path.join(updates, 'active-job.json'),
      JSON.stringify({ id, helperPid: process.pid, parentPid: job.parentPid }),
    );
    const started: string[] = [];
    const result = await handoff(base, id, {
      prepared: async () =>
        path.join(base, '.desktop/releases', releaseId, 'app/Chronicle Cartarium.exe'),
      alive: (pid: number) => pid === 999 && success,
      wait: async () => {},
      spawn: (exe: string) => {
        started.push(exe);
        const child = Object.assign(new EventEmitter(), {
          pid: 999,
          exitCode: success ? null : 1,
          unref() {},
        });
        return child;
      },
      save: async (file: string, value: unknown) => {
        await writeFile(file, JSON.stringify(value));
        if ((value as { phase?: string }).phase === 'checking')
          await writeFile(
            path.join(updates, `ack-${id}.json`),
            JSON.stringify({
              id,
              nonce: job.nonce,
              pid: 999,
              version,
              workspace,
              success,
              health: { ...before, revision: 6, digest: hash('newer') },
            }),
          );
      },
    });
    assert.equal(result, success);
    assert.equal(
      await readFile(path.join(workspace, 'newest.txt'), 'utf8'),
      'content-saved-after-backup',
    );
    if (success) {
      assert.equal(
        JSON.parse(await readFile(path.join(base, '.desktop/current-shell.json'), 'utf8'))
          .releaseId,
        releaseId,
      );
      assert.equal(started.length, 1);
    } else {
      await assert.rejects(readFile(path.join(base, '.desktop/current-shell.json')), {
        code: 'ENOENT',
      });
      assert.equal(started[1], job.oldExe);
    }
    await assert.rejects(readFile(path.join(updates, 'active-job.json')), { code: 'ENOENT' });
  }
});

test('a lost completion write after committing the shell never rolls back accepted newer content', async (t) => {
  const base = await temporary(t),
    id = randomUUID(),
    releaseId = 'shell-' + randomUUID();
  const updates = path.join(base, '.desktop/updates');
  await mkdir(updates, { recursive: true });
  const before = { revision: 1, digest: hash('domain'), installation: hash('i'), users: hash('u') };
  const job = {
    format: 1,
    id,
    nonce: 'b'.repeat(64),
    parentPid: 12345,
    workspace: path.join(base, 'workspace'),
    version,
    releaseId,
    oldExe: path.join(base, 'Chronicle Cartarium.exe'),
    before,
  };
  await writeFile(path.join(updates, `job-${id}.json`), JSON.stringify(job));
  await writeFile(
    path.join(updates, 'active-job.json'),
    JSON.stringify({ id, helperPid: process.pid }),
  );
  let starts = 0;
  const result = await handoff(base, id, {
    prepared: async () => 'fixture-new.exe',
    alive: (pid: number) => pid === 777,
    wait: async () => {},
    spawn: () => {
      starts++;
      return Object.assign(new EventEmitter(), { pid: 777, exitCode: null, unref() {} });
    },
    save: async (file: string, value: { phase?: string }) => {
      if (value.phase === 'complete') throw new Error('lost completion response');
      await writeFile(file, JSON.stringify(value));
      if (value.phase === 'checking')
        await writeFile(
          path.join(updates, `ack-${id}.json`),
          JSON.stringify({
            id,
            nonce: job.nonce,
            pid: 777,
            version,
            workspace: job.workspace,
            success: true,
            health: before,
          }),
        );
    },
  });
  assert.equal(result, true);
  assert.equal(starts, 1);
  assert.equal(
    JSON.parse(await readFile(path.join(base, '.desktop/current-shell.json'), 'utf8')).releaseId,
    releaseId,
  );
});
