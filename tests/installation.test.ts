import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { SqliteStore } from '../server/sqlite-store';
import { InstallationManager, installationSchema } from '../server/installation';
import { readConfig } from '../server/config';
import { createApp } from '../server/app';
import { ConflictError } from '../server/store';
import { createExampleWorkspace } from '../shared/example';
import { createEmptyWorkspace } from '../shared/empty';
import { RESET_CONFIRMATION } from '../shared/application';
import { validateWorkspace } from '../server/validation';

test('complete Japanese fantasy example is linked, diverse, resettable, and deterministic', () => {
  const data = validateWorkspace(createExampleWorkspace());
  assert.deepEqual(data, createExampleWorkspace());
  assert.equal(data.worlds.length, 1);
  assert.equal(data.maps.length, 4);
  assert(data.entities.length >= 85);
  assert.equal(new Set(data.entities.map((e) => e.type)).size, 13);
  assert(data.entities.filter((e) => e.type === 'character').length >= 20);
  assert(data.relations.length >= 30);
  assert(data.plots.length >= 3);
  assert(data.entities.every((e) => e.content.length > 180));
  const names = new Set(data.entities.map((e) => e.name));
  for (const entity of data.entities)
    for (const m of entity.content.matchAll(/\[\[([^\]]+)\]\]/g))
      assert(names.has(m[1]), `Broken reference ${m[1]}`);
  for (const map of data.maps)
    assert(map.editor?.divisions?.some((d) => d.kind === 'country' && d.entityId));
  assert.doesNotThrow(() => validateWorkspace(createEmptyWorkspace()));
});

test('SQLite persists aggregate records, protects concurrent revisions and rejects invalid snapshots', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-sqlite-'));
  const filename = path.join(directory, 'worldloom.sqlite');
  const first = await new SqliteStore(filename).initialize();
  const second = await new SqliteStore(filename).initialize();
  t.after(async () => {
    await first.close();
    await second.close();
    await rm(directory, { recursive: true, force: true });
  });
  assert.equal((await first.read()).data.worlds.length, 0);
  const results = await Promise.allSettled([
    first.save(createExampleWorkspace(), 0),
    second.save(createEmptyWorkspace(), 0),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert(results.some((r) => r.status === 'rejected' && r.reason instanceof ConflictError));
  const persisted = await second.read();
  assert.equal(persisted.revision, 1);
  assert(persisted.data.entities.length >= 85);
  const invalid = structuredClone(persisted.data);
  invalid.entities[0].worldId = 'missing';
  await assert.rejects(first.save(invalid, 1));
  assert.equal((await first.read()).revision, 1);
});

test('installation, account login, protected admin, password rotation and backup-before-reset operate end to end', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-install-'));
  const config = readConfig({ DATA_DIR: directory, COOKIE_SECURE: 'false' });
  const manager = await InstallationManager.open(config);
  const app = await createApp(config, manager);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  t.after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (
    route: string,
    method = 'GET',
    body?: unknown,
    cookie?: string,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  assert.equal((await (await send('/api/status')).json()).setupRequired, true);
  assert.equal((await send('/api/workspace')).status, 403);
  const install = {
    storage: 'sqlite',
    title: '测试工作台',
    theme: 'jade',
    access: 'local',
    username: 'gm',
    password: 'test-password-2026',
    fillExample: true,
  };
  const rejectedHost = await new Promise<number>((resolve, reject) => {
    const body = JSON.stringify(install);
    const req = httpRequest(
      base + '/api/install',
      {
        method: 'POST',
        headers: {
          Host: 'evil.example',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    req.on('error', reject);
    req.end(body);
  });
  assert.equal(rejectedHost, 403);
  const response = await send('/api/install', 'POST', install);
  assert.equal(response.status, 201);
  let cookie = response.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await send('/api/install', 'POST', install)).status, 409);
  assert.equal((await send('/api/admin')).status, 401);
  const before = await (await send('/api/workspace', 'GET', undefined, cookie)).json();
  assert(before.data.entities.length >= 85);
  const saved = JSON.parse(await readFile(path.join(directory, 'installation.json'), 'utf8'));
  assert(saved.passwordHash.startsWith('$2'));
  assert(!JSON.stringify(saved).includes(install.password));
  const reopened = await InstallationManager.open(config);
  assert.equal(reopened.setupRequired, false);
  assert.equal(reopened.credentials?.username, 'gm');
  assert.deepEqual((await reopened.read()).data, before.data);
  await reopened.close();
  assert.equal(
    (await send('/api/login', 'POST', { username: 'other', password: install.password })).status,
    401,
  );
  const login = await send('/api/login', 'POST', { username: 'gm', password: install.password });
  assert.equal(login.status, 200);
  const otherCookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.equal(
    (
      await send(
        '/api/admin/password',
        'POST',
        { currentPassword: 'wrong', password: 'replacement-pass-2026' },
        cookie,
      )
    ).status,
    401,
  );
  const changed = await send(
    '/api/admin/password',
    'POST',
    { currentPassword: install.password, password: 'replacement-pass-2026' },
    cookie,
  );
  assert.equal(changed.status, 200);
  cookie = changed.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await send('/api/workspace', 'GET', undefined, otherCookie)).status, 401);
  const uploads = path.join(directory, 'uploads');
  const image = '01234567-1111-2222-3333-123456789abc.png';
  await writeFile(path.join(uploads, image), 'fixture');
  assert.equal(
    (
      await send(
        '/api/admin/reset',
        'POST',
        { confirmation: '删除', fillExample: false, revision: before.revision },
        cookie,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await send(
        '/api/admin/reset',
        'POST',
        { confirmation: RESET_CONFIRMATION, fillExample: false, revision: 0 },
        cookie,
      )
    ).status,
    409,
  );
  const reset = await send(
    '/api/admin/reset',
    'POST',
    { confirmation: RESET_CONFIRMATION, fillExample: false, revision: before.revision },
    cookie,
  );
  assert.equal(reset.status, 200);
  const result = await reset.json();
  assert.deepEqual(result.envelope.data, createEmptyWorkspace());
  const backup = JSON.parse(
    await readFile(path.join(directory, 'backups', result.backup, 'workspace.json'), 'utf8'),
  );
  assert.equal(backup.revision, before.revision);
  const portableBackup = JSON.parse(
    await readFile(
      path.join(directory, 'backups', result.backup, 'chronicle-cartarium-backup.json'),
      'utf8',
    ),
  );
  assert.equal(portableBackup.format, 'chronicle-cartarium');
  assert.equal(portableBackup.version, 1);
  assert.deepEqual(portableBackup.data, before.data);
  assert.equal(
    await readFile(path.join(directory, 'backups', result.backup, 'uploads', image), 'utf8'),
    'fixture',
  );
  await assert.rejects(access(path.join(uploads, image)));
  const fill = await send(
    '/api/admin/reset',
    'POST',
    { confirmation: RESET_CONFIRMATION, fillExample: true, revision: result.envelope.revision },
    cookie,
  );
  assert.equal(fill.status, 200);
  assert((await fill.json()).envelope.data.entities.length >= 85);
  await send('/api/logout', 'POST', undefined, cookie);
  assert.equal((await send('/api/admin', 'GET', undefined, cookie)).status, 401);
});

test('fresh MySQL installation validates isolated new database names before connecting', () => {
  const base = {
    storage: 'mysql',
    title: '织界',
    theme: 'parchment',
    access: 'server',
    username: 'gm',
    password: 'valid-password-2026',
    fillExample: false,
    mysql: {
      host: '127.0.0.1',
      port: 3306,
      username: 'dbuser',
      password: 'private',
      database: 'worldloom_new_unique',
    },
  };
  assert(installationSchema.safeParse(base).success);
  for (const database of [
    'mysql',
    'existing_business',
    'worldloom_x; DROP DATABASE mysql',
    'worldloom_',
  ])
    assert(!installationSchema.safeParse({ ...base, mysql: { ...base.mysql, database } }).success);
});

test('configured setup tokens protect installation and never appear in public status', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-setup-token-'));
  const token = 'isolated-setup-token-for-test-2026';
  const config = readConfig({ DATA_DIR: directory, SETUP_TOKEN: token, COOKIE_SECURE: 'false' });
  const manager = await InstallationManager.open(config);
  const app = await createApp(config, manager);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.setupTokenRequired, true);
  assert(!JSON.stringify(status).includes(token));
  const body = JSON.stringify({
    storage: 'sqlite',
    title: '授权码验证',
    theme: 'parchment',
    access: 'local',
    username: 'gm',
    password: 'setup-test-password-2026',
    fillExample: false,
  });
  for (const supplied of ['', 'wrong-token']) {
    const response = await fetch(base + '/api/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worldloom-Setup-Token': supplied },
      body,
    });
    assert.equal(response.status, 403);
    assert.equal(manager.setupRequired, true);
  }
  const installed = await fetch(base + '/api/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Worldloom-Setup-Token': token },
    body,
  });
  assert.equal(installed.status, 201);
  assert.deepEqual((await manager.read()).data, createEmptyWorkspace());
});
