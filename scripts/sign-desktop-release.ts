/** Maintainer-only: attest the complete portable shell without exposing the private key. */
import path from 'node:path';
import { readFile, writeFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash, createPublicKey, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { desktopTree } from '../server/desktop-update';
import { fileDigest } from '../server/full-backup';
import { releasePublicKeys } from '../shared/release-trust';
const { digest, verifyDesktopManifest } = createRequire(import.meta.url)(
  '../shared/desktop-update-security.cjs',
);
const [directoryArgument, archiveArgument] = process.argv.slice(2);
const directory = path.resolve(directoryArgument || ''),
  archive = path.resolve(archiveArgument || '');
if (
  !directory.startsWith(path.resolve('.runtime/desktop-work') + path.sep) ||
  !archive.startsWith(path.resolve('.runtime/publishing') + path.sep)
)
  throw new Error('Only isolated desktop release artifacts can be signed');
const build = JSON.parse(await readFile(path.join(directory, 'DESKTOP-BUILD.json'), 'utf8'));
const version = build.version;
if (path.basename(archive) !== `chronicle-cartarium-${version}-windows-desktop-x64.zip`)
  throw new Error('Desktop archive name differs');
const temporary = await mkdtemp(path.resolve('.runtime/desktop-work', 'sign-verify-'));
try {
  const extracted = path.join(temporary, 'app');
  await promisify(execFile)(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.resolve('scripts/extract-desktop-update.ps1'),
      '-Archive',
      archive,
      '-Destination',
      extracted,
    ],
    { windowsHide: true, timeout: 300000 },
  );
  const original = await desktopTree(directory),
    actual = await desktopTree(extracted);
  if (actual.sha256 !== original.sha256)
    throw new Error('Archive does not match desktop release files');
  const privateKey = await readFile(
    process.env.RELEASE_SIGNING_KEY || '.runtime/release-signing-private.pem',
    'utf8',
  );
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const keyId = createHash('sha256').update(publicKey).digest('hex').slice(0, 16);
  if (releasePublicKeys[keyId] !== publicKey)
    throw new Error('Signing key differs from the original trust key');
  const entrypoints = Object.fromEntries(
    await Promise.all(
      ['Chronicle Cartarium.exe', 'resources/app.asar', 'resources/backend/runtime/node.exe'].map(
        async (file) => [file, await fileDigest(path.join(directory, file))],
      ),
    ),
  );
  const manifest = {
    format: 'chronicle-cartarium-desktop-update',
    formatVersion: 1,
    version,
    minimumShellVersion: '0.2.0-beta.19',
    platform: 'win32',
    architecture: 'x64',
    keyId,
    archive: {
      name: path.basename(archive),
      bytes: (await stat(archive)).size,
      sha256: await fileDigest(archive),
    },
    treeSha256: actual.sha256,
    entrypoints,
  };
  const signed = {
    manifest,
    signature: sign(null, Buffer.from(digest(manifest)), privateKey).toString('base64'),
  };
  verifyDesktopManifest(signed);
  const filename = archive.replace(/\.zip$/, '.update.json');
  await writeFile(filename, JSON.stringify(signed, null, 2) + '\n', { flag: 'wx' });
  console.log(
    JSON.stringify({
      descriptor: path.basename(filename),
      version,
      keyId,
      archiveAndEveryFileVerified: true,
      files: actual.files.length,
    }),
  );
} finally {
  // This tool created this exact new temporary directory; no application data is located here.
  await rm(temporary, { recursive: true, force: true });
}
