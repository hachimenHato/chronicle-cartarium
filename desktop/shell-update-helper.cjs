// Runs with the bundled Node after the old Electron process exits. Never restores user data.
// Electron interprets .asar as a virtual directory; signatures cover the raw archive bytes.
const fs = process.versions.electron
  ? require('original-fs').promises
  : require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const { digest, verifyDesktopManifest, releaseDirectory } = require(
  require('node:fs').existsSync(path.join(__dirname, 'desktop-update-security.cjs'))
    ? './desktop-update-security.cjs'
    : '../shared/desktop-update-security.cjs',
);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const hash = async (file) =>
  createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
async function save(file, data) {
  const temporary = file + '.' + process.pid + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(data), { flag: 'wx', mode: 0o600 });
  await fs.rename(temporary, file);
}
async function tree(directory) {
  const files = [];
  async function walk(parent) {
    for (const name of (await fs.readdir(parent)).sort()) {
      const file = path.join(parent, name),
        info = await fs.lstat(file);
      if (info.isSymbolicLink()) throw new Error('Desktop contains a link');
      if (info.isDirectory()) await walk(file);
      else if (info.isFile())
        files.push({
          path: path.relative(directory, file).replaceAll('\\', '/'),
          bytes: info.size,
          sha256: await hash(file),
        });
      else throw new Error('Desktop contains a special file');
      if (files.length > 100000) throw new Error('Too many desktop files');
    }
  }
  await walk(directory);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return digest(files);
}
async function prepared(base, releaseId, version, full = false) {
  const directory = releaseDirectory(base, releaseId);
  const signed = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const manifest = verifyDesktopManifest(signed);
  if (manifest.version !== version) throw new Error('Desktop version differs');
  for (const [relative, expected] of Object.entries(manifest.entrypoints)) {
    const file = path.join(directory, 'app', relative);
    if (!(await fs.lstat(file)).isFile() || (await hash(file)) !== expected)
      throw new Error('Desktop entrypoint differs');
  }
  if (full && (await tree(path.join(directory, 'app'))) !== manifest.treeSha256)
    throw new Error('Desktop tree differs');
  return path.join(directory, 'app', 'Chronicle Cartarium.exe');
}
async function run(base, id, dependencies = {}) {
  const isAlive = dependencies.alive || alive;
  const pause = dependencies.wait || wait;
  const start = dependencies.spawn || spawn;
  const persist = dependencies.save || save;
  if (!path.isAbsolute(base) || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid desktop job');
  const updates = path.join(base, '.desktop', 'updates'),
    jobFile = path.join(updates, `job-${id}.json`);
  const job = JSON.parse(await fs.readFile(jobFile, 'utf8'));
  if (
    job.format !== 1 ||
    job.id !== id ||
    !/^[a-f0-9]{64}$/.test(job.nonce) ||
    !Number.isSafeInteger(job.parentPid) ||
    job.parentPid < 1 ||
    typeof job.workspace !== 'string' ||
    !path.isAbsolute(job.workspace) ||
    !Number.isInteger(job.before?.revision)
  )
    throw new Error('Invalid desktop job');
  const executable = await (dependencies.prepared || prepared)(
    base,
    job.releaseId,
    job.version,
    true,
  );
  const oldExe = path.resolve(job.oldExe);
  if (
    oldExe !== path.join(base, 'Chronicle Cartarium.exe') &&
    !oldExe.startsWith(path.join(base, '.desktop', 'releases') + path.sep)
  )
    throw new Error('Invalid original application');
  const statusFile = path.join(base, '.desktop', 'shell-update-status.json');
  const activeFile = path.join(updates, 'active-job.json');
  let active;
  for (let attempt = 0; attempt < 120; attempt++) {
    active = JSON.parse(await fs.readFile(activeFile, 'utf8'));
    if (active.id !== id) throw new Error('Desktop job ownership changed');
    if (active.helperPid === process.pid) break;
    if (!isAlive(job.parentPid)) throw new Error('Desktop handoff was interrupted');
    await pause(250);
  }
  if (active.helperPid !== process.pid) throw new Error('Desktop helper was not confirmed');
  let child,
    committed = false;
  try {
    for (let attempt = 0; isAlive(job.parentPid); attempt++) {
      if (attempt >= 240) throw new Error('Old application did not exit');
      await pause(250);
    }
    await persist(statusFile, {
      phase: 'checking',
      version: job.version,
      message: '新版桌面程序启动验证中，原工作台保持不变。',
    });
    child = start(executable, [], {
      cwd: path.dirname(executable),
      env: {
        ...process.env,
        CHRONICLE_CARTARIUM_DESKTOP_ROOT: base,
        CHRONICLE_CARTARIUM_SHELL_JOB: id,
        CHRONICLE_CARTARIUM_SHELL_NONCE: job.nonce,
      },
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    let failed = false;
    child.on('error', () => {
      failed = true;
    });
    child.unref();
    let acknowledged = false;
    for (let attempt = 0; attempt < 240; attempt++) {
      if (failed || child.exitCode !== null || (child.pid && !isAlive(child.pid))) break;
      try {
        const ack = JSON.parse(await fs.readFile(path.join(updates, `ack-${id}.json`), 'utf8'));
        if (
          ack.id === id &&
          ack.nonce === job.nonce &&
          ack.pid === child.pid &&
          ack.version === job.version &&
          ack.workspace === job.workspace &&
          ack.success === true &&
          ack.health?.revision >= job.before.revision &&
          (ack.health.revision !== job.before.revision ||
            ack.health.digest === job.before.digest) &&
          ack.health.installation === job.before.installation &&
          ack.health.users === job.before.users
        ) {
          acknowledged = true;
          break;
        }
        if (ack.id === id && ack.nonce === job.nonce && ack.success === false) break;
      } catch {}
      await pause(500);
    }
    if (!acknowledged) throw new Error('New application did not confirm workspace');
    // Commit only the shell pointer. World data and backend update pointers are never restored here.
    await persist(path.join(base, '.desktop', 'current-shell.json'), {
      format: 1,
      releaseId: job.releaseId,
      version: job.version,
      previous: job.previous || null,
    });
    committed = true;
    await persist(statusFile, {
      phase: 'complete',
      version: job.version,
      message: '桌面程序更新完成，原账号、工作台与数据路径已核对。',
    });
  } catch {
    if (committed) return true;
    await persist(statusFile, {
      phase: 'error',
      version: job.version,
      message:
        '新版桌面启动未通过，原程序入口和资料保留。关闭未就绪的窗口后，从原EXE重新打开；不要初始化或恢复旧数据覆盖新内容。',
    });
    if (!isAlive(job.parentPid) && (!child?.pid || !isAlive(child.pid))) {
      const original = start(oldExe, [], {
        cwd: path.dirname(oldExe),
        env: { ...process.env, CHRONICLE_CARTARIUM_DESKTOP_ROOT: base },
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      original.on('error', () => {});
      original.unref();
    }
    return false;
  } finally {
    try {
      if (JSON.parse(await fs.readFile(activeFile, 'utf8')).id === id) await fs.unlink(activeFile);
    } catch {}
  }
  return true;
}
if (require.main === module)
  run(process.argv[2], process.argv[3])
    .then((success) => {
      if (!success) process.exitCode = 1;
    })
    .catch(() => {
      process.exitCode = 1;
    });
module.exports = { prepared, run };
