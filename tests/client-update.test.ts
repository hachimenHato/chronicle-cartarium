import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fetchClientBuild } from '../src/lib/useClientUpdate';
import { createApp } from '../server/app';
import { readConfig } from '../server/config';
import { DemoStore } from '../server/store';

test('build discovery ignores offline, missing, HTML and malformed responses', async () => {
  const valid: typeof fetch = async (url, init) => {
    assert.equal(url, '/app-version.json');
    assert.equal(init?.cache, 'no-store');
    return Response.json({ buildId: 'release-new' });
  };
  assert.equal(await fetchClientBuild(valid), 'release-new');
  for (const response of [
    new Response('', { status: 404 }),
    new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } }),
    Response.json({}),
    Response.json({ buildId: '<invalid>' }),
    new Response('{broken', { headers: { 'content-type': 'application/json' } }),
  ])
    assert.equal(await fetchClientBuild(async () => response), undefined);
  assert.equal(
    await fetchClientBuild(async () => {
      throw new Error('offline');
    }),
    undefined,
  );
});

test('HTML and build manifests bypass caching and a missing manifest never becomes SPA HTML', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'worldloom-version-'));
  const distDir = path.join(directory, '.worldloom', 'releases', 'fixture', 'dist');
  await mkdir(distDir, { recursive: true });
  await writeFile(
    path.join(distDir, 'index.html'),
    '<!doctype html><title>Version fixture</title>',
  );
  await writeFile(
    path.join(distDir, 'app-version.json'),
    JSON.stringify({ buildId: 'release-test' }),
  );
  await writeFile(path.join(directory, '.env'), 'private-version-fixture');
  const store = await new DemoStore(path.join(directory, 'workspace.json')).initialize();
  const app = await createApp(
    { ...readConfig({}), dataDir: directory, distDir, production: true },
    store,
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  for (const url of ['/', '/index.html', '/atlas', '/app-version.json']) {
    const response = await fetch(base + url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    if (url.endsWith('.json')) assert.deepEqual(await response.json(), { buildId: 'release-test' });
  }
  assert(!(await (await fetch(base + '/.env')).text()).includes('private-version-fixture'));
  await rm(path.join(distDir, 'app-version.json'));
  const missing = await fetch(base + '/app-version.json');
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'not_found');
});
