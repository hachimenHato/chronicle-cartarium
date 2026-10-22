import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { InstallationManager } from '../server/installation';
import { readConfig } from '../server/config';
import { createApp } from '../server/app';

test('online settings/check/download/cancel and offline apply are owner-only on the server', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chronicle-update-access-'));
  const config = {
    ...readConfig({ DATA_DIR: path.join(directory, 'data'), COOKIE_SECURE: 'false' }),
    installRoot: directory,
    deployment: 'managed' as const,
  };
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
  const send = (route: string, method = 'GET', body?: unknown, cookie?: string) =>
    fetch(base + route, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  const installed = await send('/api/install', 'POST', {
    storage: 'sqlite',
    title: '更新权限验证',
    theme: 'midnight',
    access: 'local',
    username: 'gm',
    password: 'owner-update-test-password',
    fillExample: false,
  });
  assert.equal(installed.status, 201);
  const ownerCookie = installed.headers.get('set-cookie')!.split(';')[0];
  assert.equal((await send('/api/admin/updates/online')).status, 401);
  const before = await manager.read();
  let users = await (
    await send('/api/admin/users/mode', 'PUT', { enabled: true, revision: 0 }, ownerCookie)
  ).json();
  for (const role of ['moderator', 'user']) {
    const response = await send(
      '/api/admin/users',
      'PUT',
      {
        username: role,
        password: 'secondary-update-test-password',
        role,
        disabled: false,
        grants: {},
        records: {},
        canExport: false,
        canViewPrivate: false,
        revision: users.revision,
      },
      ownerCookie,
    );
    assert.equal(response.status, 200);
    users = await response.json();
    const login = await send('/api/login', 'POST', {
      username: role,
      password: 'secondary-update-test-password',
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    for (const [route, method, body] of [
      ['/api/admin/updates/online', 'GET', undefined],
      ['/api/admin/updates/online/check', 'POST', {}],
      ['/api/admin/updates/online/settings', 'PUT', { source: 'github', channel: 'stable' }],
      ['/api/admin/updates/online/download', 'POST', { version: '0.2.0-beta.19' }],
      ['/api/admin/updates/online/cancel', 'POST', { id: '12345678-1234-4234-8234-123456789abc' }],
      ['/api/admin/updates/apply', 'POST', { packageId: 'package-any' }],
    ] as const)
      assert.equal((await send(route, method, body, cookie)).status, 403, `${role}: ${route}`);
  }
  const settings = {
    source: 'mirror',
    channel: 'preview',
    mirrorBaseUrl: 'https://cdn.example/chronicle',
  };
  const saved = await send('/api/admin/updates/online/settings', 'PUT', settings, ownerCookie);
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json()).settings, settings);
  assert.deepEqual(
    JSON.parse(
      await readFile(path.join(directory, '.worldloom', 'online-update-settings.json'), 'utf8'),
    ),
    settings,
  );
  assert.equal(
    (
      await send(
        '/api/admin/updates/online/settings',
        'PUT',
        { ...settings, mirrorBaseUrl: 'http://127.0.0.1' },
        ownerCookie,
      )
    ).status,
    422,
  );
  assert.equal(
    (
      await send(
        '/api/admin/updates/online/download',
        'POST',
        { version: '0.2.0-beta.19' },
        ownerCookie,
      )
    ).status,
    422,
  );
  assert.deepEqual(await manager.read(), before);
});
