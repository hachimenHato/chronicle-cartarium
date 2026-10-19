import path from 'node:path';
import { readFile, writeFile, lstat } from 'node:fs/promises';
import { sign, createPublicKey, createHash } from 'node:crypto';
import { create } from 'tar';
import { releaseFiles, releaseManifestSchema } from '../server/release-package';
import { digest, fileDigest } from '../server/full-backup';
import { releasePublicKeys } from '../shared/release-trust';
import { UPDATE_PACKAGE_EXTENSION } from '../shared/branding';
const root = path.resolve(process.argv[2] || '');
if (!root.startsWith(path.resolve('.runtime/release') + path.sep))
  throw new Error('Only managed release directories can be signed.');
const privateKey = await readFile(
  path.resolve(process.env.RELEASE_SIGNING_KEY || '.runtime/release-signing-private.pem'),
  'utf8',
);
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
const keyId = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
if (releasePublicKeys[keyId] !== publicKey)
  throw new Error('Signing key does not match the published trust key.');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const entries = [];
for (const file of (await releaseFiles(root)).filter((name) => name !== 'RELEASE-MANIFEST.json'))
  entries.push({
    path: file,
    bytes: (await lstat(path.join(root, file))).size,
    sha256: await fileDigest(path.join(root, file)),
  });
const manifest = releaseManifestSchema.parse({
  format: 'worldloom-release',
  formatVersion: 1,
  version: pkg.version,
  minimumVersion: '0.2.0-beta.5',
  platform: process.platform,
  architecture: process.arch,
  mysqlSchema: 5,
  sqliteSchema: 1,
  workspaceFormat: 1,
  installationFormat: 1,
  userFormat: 1,
  keyId,
  entries,
});
const signature = sign(null, Buffer.from(digest(manifest)), privateKey).toString('base64');
await writeFile(
  path.join(root, 'RELEASE-MANIFEST.json'),
  JSON.stringify({ manifest, signature }, null, 2),
);
await create(
  { cwd: root, file: root + UPDATE_PACKAGE_EXTENSION, gzip: true, portable: true, strict: true },
  [...entries.map((entry) => entry.path), 'RELEASE-MANIFEST.json'],
);
console.log('受签名更新包已生成：' + path.basename(root) + UPDATE_PACKAGE_EXTENSION);
