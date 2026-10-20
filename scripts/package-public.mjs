// Builds platform-labelled NEW-INSTALL distributions. No private update key is read here.
import { cp, mkdir, readFile, writeFile, readdir, rename, chmod, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { create, x, t } from 'tar';

const root = process.cwd();
const source = path.resolve(process.argv[2] || '');
const output = path.resolve(process.argv[3] || '');
if (
  !source.startsWith(path.join(root, '.runtime/publishing') + path.sep) ||
  !output.startsWith(path.join(root, '.runtime/publishing') + path.sep)
)
  throw new Error('Use isolated publishing paths');
const version = JSON.parse(await readFile(path.join(source, 'package.json'), 'utf8')).version;
await lstat(path.join(source, 'dist/index.html'));
await mkdir(output);
const nodeVersion = process.env.PUBLIC_NODE_VERSION || 'v22.23.3';
if (!/^v22\.\d+\.\d+$/.test(nodeVersion)) throw new Error('Pin a Node 22 maintenance version');
const base = `https://nodejs.org/dist/${nodeVersion}/`;
async function download(url, filename) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Runtime download failed: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(filename, bytes);
  return bytes;
}
const checksumResponse = await fetch(base + 'SHASUMS256.txt', {
  signal: AbortSignal.timeout(30000),
});
if (!checksumResponse.ok) throw new Error('Missing upstream runtime checksums');
const sums = await checksumResponse.text();
const cache = path.join(root, '.runtime/publishing/runtime-downloads');
await mkdir(cache, { recursive: true });
const assets = [];
const targets = (
  process.env.PUBLIC_TARGETS || 'win-x64,linux-x64,linux-arm64,darwin-x64,darwin-arm64'
).split(',');
for (const target of targets) {
  if (!/^(win|linux|darwin)-(x64|arm64)$/.test(target)) throw new Error('Unsupported target');
  const windows = target.startsWith('win-');
  const runtimeName = `node-${nodeVersion}-${target}`;
  const archive = runtimeName + (windows ? '.zip' : '.tar.gz');
  const expected = sums
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === archive)?.[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error('Missing official runtime hash');
  console.log(`Preparing ${target}: official ${nodeVersion} runtime`);
  const archivePath = path.join(cache, archive);
  let bytes;
  try {
    bytes = await readFile(archivePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    bytes = await download(base + archive, archivePath);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== expected)
    throw new Error('Runtime checksum mismatch');
  const name = `chronicle-cartarium-${version}-${target}`;
  const directory = path.join(output, name);
  await cp(source, directory, {
    recursive: true,
    filter: (filename) =>
      !['node_modules', '.git', '.runtime', '.worldloom', 'data'].includes(path.basename(filename)),
  });
  const extraction = path.join(output, 'extract-' + target);
  await mkdir(extraction);
  if (windows) {
    if (process.platform !== 'win32')
      throw new Error('Windows ZIP extraction requires Windows build host');
    const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${archivePath.replaceAll("'", "''")}', '${extraction.replaceAll("'", "''")}')`;
    const child = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { stdio: 'inherit', windowsHide: true },
    );
    if (child.status !== 0) throw new Error('Runtime ZIP extraction failed');
  } else {
    // npm/npx/Corepack command symlinks are unnecessary: launch.mjs invokes npm-cli.js directly.
    // Skipping links also permits cross-packaging on Windows without symlink privileges.
    await x({
      cwd: extraction,
      file: archivePath,
      strict: true,
      filter: (_, entry) => !['SymbolicLink', 'Link'].includes(entry.type),
    });
  }
  const runtime = path.join(directory, 'runtime');
  await rename(path.join(extraction, runtimeName), runtime);
  if (!windows) {
    await rename(path.join(runtime, 'bin/node'), path.join(runtime, 'node'));
    await rename(path.join(runtime, 'lib/node_modules'), path.join(runtime, 'node_modules'));
    await chmod(path.join(runtime, 'node'), 0o755);
  }
  for (const launcher of ['start.sh', 'start.command'])
    await chmod(path.join(directory, launcher), 0o755);
  await writeFile(
    path.join(directory, 'RELEASE.txt'),
    `Chronicle Cartarium ${version}\nTarget: ${target}\nRuntime: ${nodeVersion}; upstream SHA256 verified.\nNew installation archive; not an application update package.\nFirst launch downloads locked npm dependencies.\nWindows: start.cmd; Linux/macOS: sh start.sh. Open http://localhost:3001/\nNo credentials, user data or private signing keys included.\nCross-platform packaging does not imply native acceptance; see GitHub Release notes.\nmacOS update/recovery has not received native end-to-end acceptance in this release.\n`,
  );
  const inventory = [];
  async function walk(dir) {
    for (const filename of await readdir(dir)) {
      const absolute = path.join(dir, filename);
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink()) continue; // Official Node npm/npx symlinks, not followed.
      if (stat.isDirectory()) await walk(absolute);
      else
        inventory.push({
          path: path.relative(directory, absolute).replaceAll('\\', '/'),
          bytes: stat.size,
          sha256: createHash('sha256')
            .update(await readFile(absolute))
            .digest('hex'),
        });
    }
  }
  await walk(directory);
  await writeFile(
    path.join(directory, 'DISTRIBUTION-FILES.json'),
    JSON.stringify(
      {
        version,
        target,
        nodeVersion,
        runtimeArchive: archive,
        runtimeSha256: expected,
        files: inventory,
      },
      null,
      2,
    ),
  );
  const filename = name + (windows ? '.zip' : '.tar.gz');
  const resultPath = path.join(output, filename);
  if (windows) {
    const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${directory.replaceAll("'", "''")}', '${resultPath.replaceAll("'", "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $true)`;
    const child = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { stdio: 'inherit', windowsHide: true },
    );
    if (child.status !== 0) throw new Error('Distribution ZIP creation failed');
  } else {
    await create(
      {
        cwd: output,
        file: resultPath,
        gzip: true,
        portable: true,
        onWriteEntry: (entry) => {
          if (/\/(runtime\/node|start\.(sh|command))$/.test(entry.path) && entry.stat)
            entry.stat.mode = (entry.stat.mode & ~0o777) | 0o755;
        },
      },
      [name],
    );
    let executable = false;
    await t({
      file: resultPath,
      onReadEntry: (entry) => {
        if (entry.path === `${name}/runtime/node`) executable = (entry.mode & 0o111) !== 0;
      },
    });
    if (!executable) throw new Error('Unix runtime lost executable permissions');
  }
  const hash = createHash('sha256')
    .update(await readFile(resultPath))
    .digest('hex');
  assets.push({ filename, sha256: hash, bytes: (await lstat(resultPath)).size });
  await writeFile(
    path.join(output, 'SHA256SUMS.txt'),
    assets.map((item) => `${item.sha256}  ${item.filename}`).join('\n') + '\n',
  );
  await writeFile(path.join(output, 'ASSETS.json'), JSON.stringify(assets, null, 2));
  console.log(`Verified archive created: ${filename}`);
}
