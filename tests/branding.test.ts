import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  BRAND_TITLE,
  BRAND_ZH,
  displayApplicationTitle,
  shortApplicationTitle,
  isCreativeBackupFormat,
  validProjectDatabaseName,
} from '../shared/branding';
import { InstallationManager } from '../server/installation';
import { readConfig } from '../server/config';

test('renamed product accepts legacy creative backups and project names without replacing custom titles', () => {
  assert.equal(displayApplicationTitle('织界 Worldloom'), BRAND_TITLE);
  assert.equal(shortApplicationTitle('织界 Worldloom'), BRAND_ZH);
  assert.equal(displayApplicationTitle('我的跑团工作台'), '我的跑团工作台');
  assert(isCreativeBackupFormat('worldloom'));
  assert(isCreativeBackupFormat('chronicle-cartarium'));
  assert(!isCreativeBackupFormat('other-tool'));
  assert(validProjectDatabaseName('chronicle_cartarium_example'));
  assert(validProjectDatabaseName('worldloom_existing_project'));
  assert(!validProjectDatabaseName('mysql'));
  assert(!validProjectDatabaseName('chronicle_cartarium_x; DROP DATABASE mysql'));
  assert(!validProjectDatabaseName('chronicle_cartarium_' + 'x'.repeat(46)));
});

test('legacy default install title displays the new brand without rewriting private configuration or creative data', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-cartarium-brand-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  let manager = await InstallationManager.open(readConfig({ DATA_DIR: root }));
  await manager.install({
    storage: 'sqlite',
    title: '织界 Worldloom',
    theme: 'midnight',
    access: 'local',
    username: 'gm',
    password: 'brand-test-password',
    fillExample: true,
  });
  const privateBefore = await readFile(path.join(root, 'installation.json'));
  const creativeBefore = await manager.read();
  await manager.close();
  manager = await InstallationManager.open(readConfig({ DATA_DIR: root }));
  try {
    assert.equal(manager.settings.title, BRAND_TITLE);
    assert.deepEqual(await readFile(path.join(root, 'installation.json')), privateBefore);
    assert.deepEqual(await manager.read(), creativeBefore);
    assert.equal(await manager.verifyOwnerPassword('brand-test-password'), true);
  } finally {
    await manager.close();
  }
});

test('new and legacy updater environment names preserve the same managed instance configuration', () => {
  const oldConfig = readConfig({
    WORLDLOOM_INSTALL_ROOT: '/instance',
    WORLDLOOM_UPDATER_TOKEN: 'same-private-token',
  });
  const newConfig = readConfig({
    CHRONICLE_CARTARIUM_INSTALL_ROOT: '/instance',
    CHRONICLE_CARTARIUM_UPDATER_TOKEN: 'same-private-token',
  });
  assert.equal(newConfig.installRoot, oldConfig.installRoot);
  assert.equal(newConfig.updaterToken, oldConfig.updaterToken);
  assert.equal(newConfig.deployment, 'managed');
});
