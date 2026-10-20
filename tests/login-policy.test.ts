import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { readConfig } from '../server/config';
import {
  InstallationManager,
  installationSchema,
  savedInstallationSchema,
} from '../server/installation';
import { createApp } from '../server/app';

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chronicle-login-policy-'));
  const config = readConfig({
    DATA_DIR: directory,
    APP_PASSWORD: 'ignored-when-managed-login-is-off',
    COOKIE_SECURE: 'false',
  });
  const manager = await InstallationManager.open(config);
  const app = await createApp(config, manager);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await manager.close();
    await rm(directory, { recursive: true, force: true });
  });
  let cookie = '';
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (route: string, method = 'GET', body?: unknown, session = true) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(session && cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (session && response.headers.getSetCookie().length)
      cookie = response.headers.getSetCookie().at(-1)!.split(';')[0];
    return response;
  };
  return { manager, config, directory, send };
}
const install = {
  storage: 'sqlite',
  title: '登录策略测试',
  theme: 'jade',
  access: 'local',
  fillExample: false,
};
const account = { username: 'gm', password: 'policy-password-2026' };

test('login defaults on, disabled installs need no credentials and incompatible multi-user input is rejected before writing', async (t) => {
  assert.equal(installationSchema.safeParse(install).success, false);
  assert.equal(installationSchema.parse({ ...install, ...account }).loginEnabled, true);
  const { send, manager, config, directory } = await fixture(t);
  const bad = await send('/api/install', 'POST', {
    ...install,
    loginEnabled: false,
    multiUser: true,
  });
  assert.equal(bad.status, 400);
  assert.equal(manager.setupRequired, true);
  assert.equal(
    (await send('/api/install', 'POST', { ...install, loginEnabled: false })).status,
    201,
  );
  assert.equal(
    (await (await send('/api/status', 'GET', undefined, false)).json()).loginRequired,
    false,
  );
  assert.equal((await send('/api/admin', 'GET', undefined, false)).status, 200);
  const saved = JSON.parse(await readFile(path.join(directory, 'installation.json'), 'utf8'));
  assert.equal(saved.username, undefined);
  assert.equal(saved.passwordHash, undefined);
  assert.equal((await (await send('/api/admin/users')).json()).loginEnabled, false);
  assert.equal(
    (await send('/api/admin/users/mode', 'PUT', { enabled: true, revision: 0 })).status,
    403,
  );
  assert.equal(await manager.verifyOwnerPassword(''), true);
  const reopened = await InstallationManager.open(config);
  assert.equal(reopened.loginEnabled, false);
  assert.equal(reopened.credentials, undefined);
  assert.deepEqual(await reopened.read(), await manager.read());
  await reopened.close();
  const backupResponse = await send('/api/admin/full-backups', 'POST', {
    revision: (await manager.read()).revision,
  });
  assert.equal(backupResponse.status, 200);
  const backup = await backupResponse.json();
  const download = await send(`/api/admin/full-backups/${backup.id}/download`, 'POST', {
    password: '',
  });
  assert.equal(download.status, 200);
  assert((await download.arrayBuffer()).byteLength > 0);
});

test('enabling login is atomic, invalid credentials leave it off, sessions expire, and data survives toggles', async (t) => {
  const { send, manager, config } = await fixture(t);
  await send('/api/install', 'POST', { ...install, loginEnabled: false });
  const before = await manager.read();
  for (const invalid of [{ enabled: true }, { enabled: true, username: 'gm', password: 'short' }])
    assert.equal((await send('/api/admin/login', 'PUT', invalid)).status, 400);
  assert.equal(manager.loginEnabled, false);
  assert.equal((await send('/api/admin/login', 'PUT', { enabled: true, ...account })).status, 200);
  assert.equal((await send('/api/workspace', 'GET', undefined, false)).status, 401);
  assert.equal(
    (await send('/api/admin/login', 'PUT', { enabled: false, currentPassword: 'wrong' })).status,
    401,
  );
  assert.equal(manager.loginEnabled, true);
  assert.equal(
    (await send('/api/admin/login', 'PUT', { enabled: false, currentPassword: account.password }))
      .status,
    200,
  );
  assert.equal((await send('/api/admin', 'GET', undefined, false)).status, 200);
  assert.equal(
    (
      await send('/api/admin/login', 'PUT', {
        enabled: true,
        username: 'new_gm',
        password: 'new-policy-password-2026',
      })
    ).status,
    200,
  );
  assert.equal((await send('/api/login', 'POST', account, false)).status, 401);
  assert.equal(
    (
      await send(
        '/api/login',
        'POST',
        { username: 'new_gm', password: 'new-policy-password-2026' },
        false,
      )
    ).status,
    200,
  );
  const reopened = await InstallationManager.open(config);
  assert.equal(reopened.loginEnabled, true);
  assert.equal(reopened.credentials?.username, 'new_gm');
  assert.deepEqual(await reopened.read(), before);
  await reopened.close();
});

test('initial multi-user choice persists, login cannot be disabled until multi-user is off, and concurrent changes preserve this invariant', async (t) => {
  const { send, manager, config, directory } = await fixture(t);
  assert.equal(
    (await send('/api/install', 'POST', { ...install, ...account, multiUser: true })).status,
    201,
  );
  assert.equal((await (await send('/api/status')).json()).multiUser, true);
  assert.equal(
    (await send('/api/admin/login', 'PUT', { enabled: false, currentPassword: account.password }))
      .status,
    400,
  );
  const users = await (await send('/api/admin/users')).json();
  assert.equal(
    (await send('/api/admin/users/mode', 'PUT', { enabled: false, revision: users.revision }))
      .status,
    200,
  );
  const current = await (await send('/api/admin/users')).json();
  const results = await Promise.all([
    send('/api/admin/login', 'PUT', { enabled: false, currentPassword: account.password }),
    send('/api/admin/users/mode', 'PUT', { enabled: true, revision: current.revision }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  const savedUsers = JSON.parse(await readFile(path.join(directory, 'users.json'), 'utf8'));
  assert(!savedUsers.enabled || manager.loginEnabled);
  const reopened = await InstallationManager.open(config);
  assert.equal(reopened.loginEnabled, manager.loginEnabled);
  await reopened.close();
});

test('legacy installation credentials still require login and an enabled configuration cannot omit credentials', () => {
  const legacy = {
    version: 1,
    storage: 'sqlite',
    username: 'gm',
    passwordHash: '$2b$12$' + 'a'.repeat(53),
    sessionSecret: 'x'.repeat(48),
    settings: { title: '旧工作台', theme: 'jade', access: 'local' },
  };
  assert.equal(savedInstallationSchema.parse(legacy).loginEnabled, true);
  assert.equal(
    savedInstallationSchema.safeParse({ ...legacy, username: undefined }).success,
    false,
  );
  assert.equal(
    savedInstallationSchema.safeParse({
      ...legacy,
      loginEnabled: false,
      username: undefined,
      passwordHash: undefined,
    }).success,
    true,
  );
});
