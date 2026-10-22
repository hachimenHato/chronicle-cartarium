import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
test('key setup refuses missing or wrong existing private keys and never replaces public trust', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chronicle-keygen-safety-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'shared'));
  await writeFile(
    path.join(root, 'shared/release-trust.ts'),
    "import keys from './release-trust.json' with { type: 'json' }; export const releasePublicKeys = keys;",
  );
  const pair = generateKeyPairSync('ed25519'),
    other = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    id = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  const trust = JSON.stringify({ [id]: publicKey });
  const file = path.join(root, 'shared/release-trust.json'),
    key = path.join(root, 'private.pem');
  await writeFile(file, trust);
  const run = () =>
    promisify(execFile)(process.execPath, [path.resolve('scripts/release-keygen.mjs')], {
      cwd: root,
      env: { ...process.env, RELEASE_SIGNING_KEY: key },
      windowsHide: true,
    });
  await assert.rejects(run(), /禁止自动生成/);
  await assert.rejects(access(key), { code: 'ENOENT' });
  await writeFile(key, other.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await assert.rejects(run(), /不匹配/);
  assert.equal(await readFile(file, 'utf8'), trust);
  await writeFile(key, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await run();
  assert.equal(await readFile(file, 'utf8'), trust);
  await rm(file);
  await assert.rejects(run(), /信任文件缺失/);
});
