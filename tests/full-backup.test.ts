import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { create as createTar } from 'tar';
import { MaintenanceGate, MaintenanceError } from '../server/maintenance';
import { readConfig } from '../server/config';
import { InstallationManager } from '../server/installation';
import { UserDirectoryStore } from '../server/users';
import { ownerAccount } from '../shared/access';
import { FullBackupService, verifyFullBackup, digest } from '../server/full-backup';
import { recoverBackup, extractBackup } from '../server/backup-recovery';
import { SqliteStore } from '../server/sqlite-store';
import { acquireInstanceLock } from '../server/instance-lock';

async function fixture(t: { after: (callback: () => Promise<void>) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worldloom-full-backup-'));
  const dataDir = path.join(root, 'data');
  const manager = await InstallationManager.open(readConfig({ DATA_DIR: dataDir }));
  await manager.install({
    storage: 'sqlite',
    username: 'gm',
    password: 'test-full-backup-password',
    title: '完整备份验证',
    theme: 'midnight',
    access: 'local',
    fillExample: true,
  });
  const users = await UserDirectoryStore.open(
    path.join(dataDir, 'users.json'),
    () => manager.credentials,
    manager.maintenance,
  );
  await mkdir(path.join(dataDir, 'uploads'), { recursive: true });
  await writeFile(path.join(dataDir, 'uploads', 'fixture.png'), Buffer.from('private-image-test'));
  await writeFile(
    path.join(dataDir, 'uploads', '.owners.json'),
    JSON.stringify({ '/uploads/fixture.png': 'owner' }),
  );
  const ids = new Set((await manager.read()).data.entities.map((entity) => entity.id));
  await users.setEnabled(ownerAccount(), true, 0);
  await users.write(
    ownerAccount(),
    {
      username: 'player',
      role: 'user',
      disabled: false,
      grants: {},
      records: {},
      canExport: false,
      canViewPrivate: false,
      password: 'test-player-password',
      revision: 1,
    },
    ids,
  );
  const before = await manager.read();
  const next = structuredClone(before.data);
  next.entities[0].cover = '/uploads/fixture.png';
  await manager.save(next, before.revision);
  t.after(async () => {
    await manager.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, dataDir, manager, users, service: new FullBackupService(manager, users) };
}

test('maintenance drains every accepted writer, rejects new writes and releases after failure', async () => {
  const gate = new MaintenanceGate();
  let finish!: () => void;
  let maintenanceStarted = false;
  const write = gate.write(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const backup = gate.exclusive(async () => {
    maintenanceStarted = true;
    throw new Error('fixture failure');
  });
  await assert.rejects(
    gate.write(async () => undefined),
    MaintenanceError,
  );
  assert.equal(maintenanceStarted, false);
  finish();
  await write;
  await assert.rejects(backup, /fixture failure/);
  assert.equal(gate.busy, false);
  assert.equal(await gate.write(async () => 7), 7);
});

test('full SQLite backup includes WAL changes, images, private users and settings; fresh recovery retains login and grants', async (t) => {
  const f = await fixture(t);
  const before = await f.manager.read();
  const backup = await f.service.create(before.revision);
  assert.equal(backup.verified, true);
  assert.equal((await f.manager.read()).revision, before.revision);
  assert(!JSON.stringify(await f.service.status()).includes('passwordHash'));
  const directory = path.join(f.dataDir, 'backups', backup.id);
  const manifest = await verifyFullBackup(directory, (root, info) =>
    f.manager.verifyDatabaseBackup(root, info),
  );
  assert(manifest.entries.some((entry) => entry.path === 'data/uploads/.owners.json'));
  const target = path.join(f.root, 'recovered');
  const result = await recoverBackup(directory, target);
  assert.equal(result.verified, true);
  const restored = await InstallationManager.open(readConfig({ DATA_DIR: target }));
  try {
    assert.deepEqual(await restored.read(), before);
    assert.equal(await restored.verifyOwnerPassword('test-full-backup-password'), true);
    const restoredUsers = await UserDirectoryStore.open(
      path.join(target, 'users.json'),
      () => restored.credentials,
    );
    assert.deepEqual(await restoredUsers.read(), await f.users.read());
    assert.equal(
      typeof (await restoredUsers.authenticate('player', 'test-player-password')),
      'string',
    );
    assert.deepEqual(
      await readFile(path.join(target, 'uploads/fixture.png')),
      await readFile(path.join(f.dataDir, 'uploads/fixture.png')),
    );
  } finally {
    await restored.close();
  }
  await assert.rejects(recoverBackup(directory, target), /EEXIST/);
});

test('portable full backup can be extracted and recovered; missing or modified files fail before creating destination', async (t) => {
  const f = await fixture(t);
  const item = await f.service.create((await f.manager.read()).revision);
  const archive = await f.service.archive(item.id);
  const extracted = path.join(f.root, 'unpacked');
  await extractBackup(archive, extracted);
  const manifest = await verifyFullBackup(extracted, (root, info) =>
    f.manager.verifyDatabaseBackup(root, info),
  );
  assert.equal(manifest.id, item.id);
  await writeFile(path.join(extracted, 'data/uploads/fixture.png'), 'corrupted');
  const target = path.join(f.root, 'must-not-exist');
  await assert.rejects(recoverBackup(extracted, target), /校验失败/);
  await assert.rejects(access(target));
});

test('failed backup never changes the workspace or labels a pending backup verified; writer gate reopens', async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.dataDir, 'uploads/fixture.png'));
  const before = await f.manager.read();
  await assert.rejects(f.service.create(before.revision), /缺少工作区引用/);
  assert.equal((await f.service.status()).backups.length, 0);
  assert.equal(f.manager.maintenance.busy, false);
  assert.deepEqual(await f.manager.read(), before);
  assert.equal(
    digest((await f.manager.save(before.data, before.revision)).data),
    digest(before.data),
  );
});

test('future SQLite schema is refused without lowering metadata or creating tables; missing install configuration is not reinitialized', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worldloom-schema-refusal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'worldloom.sqlite');
  const db = new DatabaseSync(filename);
  db.exec(
    "PRAGMA user_version=99; CREATE TABLE sentinel(value TEXT); INSERT INTO sentinel VALUES('untouched');",
  );
  db.close();
  await assert.rejects(new SqliteStore(filename).initialize(), /newer/);
  const check = new DatabaseSync(filename, { readOnly: true });
  assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 99);
  assert.equal(check.prepare('SELECT value FROM sentinel').get()!.value, 'untouched');
  assert.equal(
    check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()!.n,
    1,
  );
  check.close();
  await assert.rejects(InstallationManager.open(readConfig({ DATA_DIR: root })), /配置缺失/);
});

test('archive extraction refuses links and duplicate paths before touching the new target', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worldloom-archive-refusal-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'manifest.json'), '{}');
  const archive = path.join(root, 'duplicate.wlbackup');
  await createTar({ file: archive, gzip: true, cwd: root }, ['manifest.json', 'manifest.json']);
  const target = path.join(root, 'not-created');
  await assert.rejects(extractBackup(archive, target), /非法路径/);
  await assert.rejects(access(target));
});

test('unknown private user format is refused before opening the creative database', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worldloom-private-format-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'users.json'), JSON.stringify({ version: 99 }));
  let opened = false;
  await assert.rejects(
    InstallationManager.open(readConfig({ DATA_DIR: root }), async () => {
      opened = true;
      throw new Error('Database must never open');
    }),
  );
  assert.equal(opened, false);
  await assert.rejects(access(path.join(root, 'worldloom.sqlite')));
  assert.equal(JSON.parse(await readFile(path.join(root, 'users.json'), 'utf8')).version, 99);
});

test('competing starters cannot acquire the same data directory; an abandoned recovery marker fails closed', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worldloom-instance-lock-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const attempts = await Promise.allSettled([acquireInstanceLock(root), acquireInstanceLock(root)]);
  const winners = attempts.filter((attempt) => attempt.status === 'fulfilled');
  assert.equal(winners.length, 1);
  await assert.rejects(acquireInstanceLock(root), /已有运行进程/);
  await (winners[0] as PromiseFulfilledResult<() => Promise<void>>).value();
  await assert.rejects(access(path.join(root, 'server.lock')));
  await writeFile(path.join(root, 'server.lock.recovery'), 'abandoned');
  await assert.rejects(acquireInstanceLock(root), /EEXIST/);
  await assert.rejects(access(path.join(root, 'server.lock')));
  assert.equal(await readFile(path.join(root, 'server.lock.recovery'), 'utf8'), 'abandoned');
});
