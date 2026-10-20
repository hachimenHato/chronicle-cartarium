import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
const { bootstrapInstance, BackendSession, cleanEnvironment, availablePort } = createRequire(
  import.meta.url,
)('../desktop/service.cjs');

async function program(directory: string) {
  await mkdir(path.join(directory, 'scripts'), { recursive: true });
  await writeFile(path.join(directory, 'scripts/launch.mjs'), '// synthetic fixture');
  await writeFile(
    path.join(directory, 'package.json'),
    JSON.stringify({ name: 'chronicle-cartarium' }),
  );
}
test('desktop bootstrap is atomic, never replaces an existing workspace and rejects private templates', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-desktop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = path.join(root, 'template');
  const instance = path.join(root, 'workspace');
  await program(template);
  assert.equal(await bootstrapInstance(template, instance), true);
  await mkdir(path.join(instance, 'data'));
  await writeFile(path.join(instance, 'data/keep.txt'), 'existing creative content');
  await writeFile(path.join(template, 'scripts/launch.mjs'), '// newer template');
  assert.equal(await bootstrapInstance(template, instance), false);
  assert.equal(
    await readFile(path.join(instance, 'data/keep.txt'), 'utf8'),
    'existing creative content',
  );
  assert.equal(
    await readFile(path.join(instance, 'scripts/launch.mjs'), 'utf8'),
    '// synthetic fixture',
  );
  const incomplete = path.join(root, 'incomplete');
  await mkdir(incomplete);
  await writeFile(path.join(incomplete, 'user-content.md'), 'keep this');
  await assert.rejects(bootstrapInstance(template, incomplete), /已有文件保持不变/);
  assert.equal(await readFile(path.join(incomplete, 'user-content.md'), 'utf8'), 'keep this');
  await writeFile(path.join(template, '.env'), 'PRIVATE_TEST_ONLY=synthetic');
  await assert.rejects(bootstrapInstance(template, path.join(root, 'new')), /私有数据/);
});
test('desktop environment cannot inherit a global database or old updater identity', () => {
  const env = cleanEnvironment(
    {
      DATABASE_URL: 'synthetic-global-dsn',
      APP_PASSWORD: 'synthetic',
      DATA_DIR: '/wrong',
      WORLDLOOM_UPDATER_TOKEN: 'synthetic',
      CHRONICLE_CARTARIUM_INSTALL_ROOT: '/wrong',
      ELECTRON_RUN_AS_NODE: '1',
      PATH: 'keep',
    },
    '/project',
    { DATA_DIR: 'private-data' },
    12345,
  );
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.APP_PASSWORD, undefined);
  assert.equal(env.WORLDLOOM_UPDATER_TOKEN, undefined);
  assert.equal(env.CHRONICLE_CARTARIUM_INSTALL_ROOT, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.DATA_DIR, path.resolve('/project', 'private-data'));
  assert.equal(env.PORT, '12345');
  assert.equal(env.HOST, '127.0.0.1');
  assert.equal(env.PATH, 'keep');
});
test('desktop authenticates the selected instance and never shuts down an attached CMD service', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-desktop-attach-'));
  await program(root);
  await mkdir(path.join(root, '.worldloom'));
  const token = 'synthetic-desktop-test-token';
  await writeFile(path.join(root, '.worldloom/runner.key'), token);
  let health = 0;
  let shutdown = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/status')
      return res.end(JSON.stringify({ mode: 'sqlite', setupRequired: false }));
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).token, token);
    if (req.url?.endsWith('/health')) {
      health++;
      return res.end(JSON.stringify({ revision: 12, digest: 'a'.repeat(64) }));
    }
    shutdown++;
    res.end('{}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });
  const port = (server.address() as AddressInfo).port;
  await writeFile(path.join(root, '.env'), `PORT=${port}\n`);
  const dataDir = path.join(root, 'existing-data');
  await writeFile(
    path.join(root, '.worldloom/current.json'),
    JSON.stringify({ program: '.', dataDir }),
  );
  const client = new BackendSession({
    directory: root,
    node: 'must-not-launch',
    ownerId: 'different-owner',
  });
  assert.equal(await client.start(), `http://127.0.0.1:${port}`);
  assert.equal(client.owned, false);
  assert.equal(await client.dataDirectory(), dataDir);
  await client.stop();
  assert.equal(health, 1);
  assert.equal(shutdown, 0);
  assert.equal(client.child, undefined);
  assert.notEqual(await availablePort(port), port);
});

test('desktop refuses to interrupt queued or running managed updates', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cc-desktop-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, '.worldloom'));
  const client = new BackendSession({ directory: root, node: 'must-not-launch', ownerId: 'test' });
  client.owned = true;
  for (const name of ['pending-update.json', 'running-update.json']) {
    await writeFile(path.join(root, '.worldloom', name), JSON.stringify({ phase: 'preparing' }));
    await assert.rejects(client.stop(), /正在更新或恢复/);
    assert.equal(client.owned, true);
    await rm(path.join(root, '.worldloom', name));
  }
});
