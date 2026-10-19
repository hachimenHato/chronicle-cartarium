import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createSeed } from '../shared/seed';
import { readConfig } from '../server/config';
import { validateWorkspace } from '../server/validation';
import { DemoStore, ConflictError } from '../server/store';
import { createApp } from '../server/app';

test('production refuses missing database or access password', () => {
  assert.throws(() => readConfig({ NODE_ENV: 'production', APP_PASSWORD: 'x' }), /requires both/);
  assert.throws(
    () => readConfig({ NODE_ENV: 'production', DATABASE_URL: 'mysql://example/db' }),
    /requires both/,
  );
  assert.equal(
    readConfig({ NODE_ENV: 'production', APP_PASSWORD: 'x', DATABASE_URL: 'mysql://example/db' })
      .secureCookies,
    true,
  );
});

test('workspace validation rejects broken and cross-world references and map cycles', () => {
  const seed = createSeed();
  assert.doesNotThrow(() => validateWorkspace(seed));
  const broken = structuredClone(seed);
  broken.relations[0].sourceId = 'missing_entity';
  assert.throws(() => validateWorkspace(broken));
  const cross = structuredClone(seed);
  cross.worlds.push({ ...cross.worlds[0], id: 'other_world' });
  cross.entities[0].worldId = 'other_world';
  cross.relations.push({
    id: 'cross_ref',
    worldId: seed.worlds[0].id,
    sourceId: cross.entities[0].id,
    targetId: seed.entities[1].id,
    label: 'cross',
    description: '',
    kind: 'neutral',
  });
  assert.throws(() => validateWorkspace(cross));
  const cycle = structuredClone(seed);
  cycle.maps[0].parentId = cycle.maps[0].id;
  assert.throws(() => validateWorkspace(cycle));
  const duplicates = structuredClone(seed);
  duplicates.entities.push(structuredClone(duplicates.entities[0]));
  assert.throws(() => validateWorkspace(duplicates));
  const variable = structuredClone(seed);
  variable.plots[0].nodes[0].conditions = [{ variable: 'unknown', operator: 'eq', value: 'true' }];
  assert.throws(() => validateWorkspace(variable));
});

test('demo persistence is durable and concurrent revisions cannot overwrite data', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'demo-workspace.json');
  const store = await new DemoStore(filename).initialize();
  const first = await store.read();
  first.data.worlds[0].description = 'Committed story';
  const results = await Promise.allSettled([store.save(first.data, 0), store.save(first.data, 0)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const rejected = results.find((r) => r.status === 'rejected');
  assert(rejected?.status === 'rejected' && rejected.reason instanceof ConflictError);
  const persisted = await new DemoStore(filename).initialize();
  assert.equal((await persisted.read()).data.worlds[0].description, 'Committed story');
  assert.equal((await persisted.read()).revision, 1);
  assert.equal(JSON.parse(await readFile(filename, 'utf8')).mode, 'demo');
});

test('API protects state and uploads, validates images, and detects stale saves', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-api-'));
  const config = {
    ...readConfig({ APP_PASSWORD: 'test-secret', SESSION_SECRET: 'test-signing-key' }),
    dataDir: directory,
    distDir: path.join(directory, 'no-dist'),
  };
  const store = await new DemoStore(path.join(directory, 'demo-workspace.json')).initialize();
  const app = await createApp(config, store);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (route: string, options: RequestInit = {}) => fetch(`${url}${route}`, options);
  assert.deepEqual(await (await request('/api/status')).json(), {
    authenticated: false,
    mode: 'demo',
    loginRequired: true,
    multiUser: false,
  });
  assert.equal((await request('/api/workspace')).status, 401);
  assert.equal((await request('/uploads/secret.png')).status, 401);
  assert.equal(
    (
      await request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      })
    ).status,
    401,
  );
  const login = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-secret' }),
  });
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  assert.match(login.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(login.headers.get('set-cookie')!, /SameSite=Strict/);
  assert.equal(
    (await request('/api/workspace', { headers: { Cookie: `${cookie}tampered` } })).status,
    401,
  );
  const headers = { 'Content-Type': 'application/json', Cookie: cookie };
  const initial = await (await request('/api/workspace', { headers })).json();
  initial.data.worlds[0].subtitle = 'API saved';
  const saved = await request('/api/workspace', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ data: initial.data, revision: initial.revision }),
  });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).revision, 1);
  const oldPage = structuredClone(initial.data);
  oldPage.worlds[0].name = 'must not replace saved data';
  const oldClientHeaders: Record<string, string>[] = [
    { 'X-Worldloom-Client': '0.0.0' },
    { Origin: new URL(saved.url).origin },
  ];
  for (const extra of oldClientHeaders) {
    const refused = await request('/api/workspace', {
      method: 'PUT',
      headers: { ...headers, ...extra },
      body: JSON.stringify({ data: oldPage, revision: 1 }),
    });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error, 'client_version_changed');
  }
  assert.equal((await (await request('/api/workspace', { headers })).json()).revision, 1);
  assert.equal(
    (
      await request('/api/workspace', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ data: initial.data, revision: initial.revision }),
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await request('/api/workspace', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ data: {}, revision: 1 }),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request('/api/workspace', {
        method: 'PUT',
        headers: { ...headers, Origin: 'https://evil.example' },
        body: '{}',
      })
    ).status,
    403,
  );
  const invalid = new FormData();
  invalid.append(
    'file',
    new Blob(['<svg onload="alert(1)"></svg>'], { type: 'image/png' }),
    'unsafe.png',
  );
  assert.equal(
    (await request('/api/uploads', { method: 'POST', headers: { Cookie: cookie }, body: invalid }))
      .status,
    415,
  );
  const oversized = new FormData();
  oversized.append(
    'file',
    new Blob([new Uint8Array(8 * 1024 * 1024 + 1)], { type: 'image/png' }),
    'oversized.png',
  );
  assert.equal(
    (
      await request('/api/uploads', {
        method: 'POST',
        headers: { Cookie: cookie },
        body: oversized,
      })
    ).status,
    413,
  );
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'portrait.png');
  const upload = await request('/api/uploads', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
  assert.equal(upload.status, 201);
  const uploaded = await upload.json();
  assert.equal((await request(uploaded.url)).status, 401);
  const image = await request(uploaded.url, { headers: { Cookie: cookie } });
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type')!, /image\/png/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal(
    (await request('/api/logout', { method: 'POST', headers: { Cookie: cookie } })).status,
    200,
  );
  assert.equal((await request('/api/workspace', { headers: { Cookie: cookie } })).status, 401);
});
