import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { OnlineUpdateService, parseOnlineSettings } from '../server/online-update';
import { ProgramUpdateService } from '../server/program-update';
import { readConfig } from '../server/config';
import {
  UPDATE_SOURCES,
  updateMirrorBaseUrl,
  updateSourceChoice,
  updateSourceLabel,
} from '../shared/update-sources';

// Exact settingsSchema from the released beta.19 server/online-update.ts. Its fixed
// desktop worker parses the newer backend response with this strict schema.
const beta19SettingsSchema = z
  .object({
    channel: z.enum(['stable', 'preview']),
    source: z.enum(['github', 'mirror']),
    mirrorBaseUrl: z.string().max(1500).optional(),
  })
  .strict();

test('new API/persisted China settings are accepted by the original strict beta.19 worker schema', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-source-compat-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = {
    ...readConfig({ DATA_DIR: path.join(root, 'data') }),
    installRoot: root,
    deployment: 'managed' as const,
  };
  const service = new OnlineUpdateService(new ProgramUpdateService(config));
  const saved = await service.saveSettings({
    source: 'china',
    channel: 'preview',
    mirrorBaseUrl: 'https://untrusted.example/custom',
  });
  const legacy = beta19SettingsSchema.parse(saved.settings);
  assert.deepEqual(legacy, {
    source: 'mirror',
    channel: 'preview',
    mirrorBaseUrl: UPDATE_SOURCES.china.baseUrl,
  });
  assert.equal(updateMirrorBaseUrl(legacy), UPDATE_SOURCES.china.baseUrl);
  const persisted = JSON.parse(
    await readFile(path.join(root, '.worldloom/online-update-settings.json'), 'utf8'),
  );
  assert.deepEqual(beta19SettingsSchema.parse(persisted), legacy);
  const reopened = new OnlineUpdateService(new ProgramUpdateService(config));
  assert.deepEqual((await reopened.status()).settings, legacy);
  assert.equal(updateSourceChoice((await reopened.status()).settings), 'china');
  // Guard against accidentally relaxing the old protocol in this regression.
  assert.throws(() => beta19SettingsSchema.parse({ source: 'china', channel: 'preview' }));
  assert.throws(() => beta19SettingsSchema.parse({ ...legacy, preset: 'china' }));
});

test('preset identity is derived from the exact public URL and never redirects existing/custom sources', () => {
  const github = { source: 'github', channel: 'stable' } as const;
  assert.deepEqual(parseOnlineSettings(github), github);
  assert.equal(updateSourceChoice(github), 'github');
  for (const base of [
    'https://cdn.example/custom',
    UPDATE_SOURCES.china.baseUrl + '-fake',
    UPDATE_SOURCES.china.baseUrl + '/nested',
    UPDATE_SOURCES.china.baseUrl.replace('files.', 'evil.'),
  ]) {
    const custom = parseOnlineSettings({
      source: 'mirror',
      channel: 'stable',
      mirrorBaseUrl: base,
    });
    assert.equal(custom.mirrorBaseUrl, base);
    assert.equal(updateSourceChoice(custom), 'mirror');
    assert.equal(updateSourceLabel(custom), UPDATE_SOURCES.mirror.label);
    assert.deepEqual(beta19SettingsSchema.parse(custom), custom);
  }
  const preset = parseOnlineSettings({
    source: 'mirror',
    channel: 'preview',
    mirrorBaseUrl: UPDATE_SOURCES.china.baseUrl + '///',
  });
  assert.equal(updateSourceChoice(preset), 'china');
  assert.equal(updateSourceLabel(preset.source, preset.mirrorBaseUrl), UPDATE_SOURCES.china.label);
  assert.equal(updateSourceLabel('china'), UPDATE_SOURCES.china.label);
  assert.throws(() => parseOnlineSettings({ ...preset, token: 'not-permitted' }));
});
