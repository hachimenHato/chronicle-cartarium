import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, createHash, sign } from 'node:crypto';
import {
  compareVersions,
  verifyRelease,
  releaseManifestSchema,
  releaseFiles,
} from '../server/release-package';
import { digest, fileDigest } from '../server/full-backup';

test('signed releases verify every file and refuse wrong key, platform, version, data-format and altered content', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'worldloom-release-verify-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['dist', 'server', 'scripts']) await mkdir(path.join(root, directory));
  await writeFile(path.join(root, 'dist/index.html'), 'fixture');
  await mkdir(path.join(root, 'shared'));
  await writeFile(
    path.join(root, 'dist/app-version.json'),
    JSON.stringify({ applicationVersion: '0.2.0-beta.6' }),
  );
  await writeFile(
    path.join(root, 'shared/application.ts'),
    "export const APPLICATION_VERSION = '0.2.0-beta.6';",
  );
  await writeFile(path.join(root, 'server/index.ts'), 'fixture');
  await writeFile(path.join(root, 'scripts/launch.mjs'), 'fixture');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '0.2.0-beta.6' }));
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const id = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  const entries = [];
  for (const file of await releaseFiles(root))
    entries.push({
      path: file,
      bytes: (await lstat(path.join(root, file))).size,
      sha256: await fileDigest(path.join(root, file)),
    });
  const manifest = releaseManifestSchema.parse({
    format: 'worldloom-release',
    formatVersion: 1,
    version: '0.2.0-beta.6',
    minimumVersion: '0.2.0-beta.5',
    platform: process.platform,
    architecture: process.arch,
    mysqlSchema: 5,
    sqliteSchema: 1,
    workspaceFormat: 1,
    installationFormat: 1,
    userFormat: 1,
    keyId: id,
    entries,
  });
  const signature = sign(null, Buffer.from(digest(manifest)), pair.privateKey).toString('base64');
  await writeFile(
    path.join(root, 'RELEASE-MANIFEST.json'),
    JSON.stringify({ manifest, signature }),
  );
  assert.equal(
    (await verifyRelease(root, '0.2.0-beta.5', { [id]: publicKey })).version,
    '0.2.0-beta.6',
  );
  await assert.rejects(verifyRelease(root, '0.2.0-beta.5', {}), /签名/);
  await assert.rejects(
    verifyRelease(root, '0.2.0-beta.5', { [id]: publicKey }, 'wrong-os'),
    /系统/,
  );
  await assert.rejects(verifyRelease(root, '0.2.0-beta.4', { [id]: publicKey }), /版本/);
  assert.throws(() => releaseManifestSchema.parse({ ...manifest, mysqlSchema: 6 }));
  await writeFile(path.join(root, 'dist/index.html'), 'changed');
  await assert.rejects(verifyRelease(root, '0.2.0-beta.5', { [id]: publicKey }), /损坏/);
});
test('release ordering treats numeric prerelease versions and stable releases correctly', () => {
  assert(compareVersions('0.2.0-beta.10', '0.2.0-beta.6') > 0);
  assert(compareVersions('1.0.0', '1.0.0-rc.99') > 0);
  assert(compareVersions('0.3.0-alpha.1', '0.2.9') > 0);
  assert.equal(compareVersions('0.2.0-beta.5', '0.2.0-beta.5'), 0);
});
