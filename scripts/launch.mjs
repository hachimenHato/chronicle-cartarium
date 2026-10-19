import { access, readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import brand from '../shared/brand.json' with { type: 'json' };
let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const managedMarker = `${path.sep}.worldloom${path.sep}releases${path.sep}`;
if (root.includes(managedMarker)) root = root.slice(0, root.indexOf(managedMarker));
process.chdir(root);
process.env.PATH = path.dirname(process.execPath) + path.delimiter + (process.env.PATH || '');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(
    `${brand.nameZh}需要 Node.js 22.18 或更新版本。请安装 Node.js 后重新打开启动文件。`,
  );
  process.exit(1);
}
const exists = async (filename) =>
  access(path.join(root, filename)).then(
    () => true,
    () => false,
  );
async function command(executable, args, options = {}) {
  const child = spawn(executable, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
    ...options,
  });
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('启动准备未完成，请查看上面的提示。')),
    );
  });
}
async function npm(args) {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  ].filter(Boolean);
  for (const candidate of candidates)
    if (
      await access(candidate).then(
        () => true,
        () => false,
      )
    )
      return command(process.execPath, [candidate, ...args]);
  // Arguments are fixed strings, never user input; .cmd requires the Windows shell.
  return command('npm', args, { shell: process.platform === 'win32' });
}
try {
  if (!(await exists('node_modules/tsx'))) {
    console.log('首次启动：正在准备运行组件…');
    await npm(['ci']);
  }
  if (!(await exists('dist/index.html'))) {
    console.log('首次启动：正在构建工作台…');
    await npm(['run', 'build']);
  }
  await import('dotenv/config');
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'production',
    DATA_DIR: path.resolve(root, process.env.DATA_DIR || 'data'),
  };
  const managed = path.join(root, '.worldloom');
  await mkdir(managed, { recursive: true, mode: 0o700 });
  const tokenFile = path.join(managed, 'runner.key');
  try {
    await writeFile(tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  const token = await readFile(tokenFile, 'utf8');
  const currentFile = path.join(managed, 'current.json');
  let firstPointer = false;
  let current = await readFile(currentFile, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    firstPointer = true;
    return { program: '.', dataDir: env.DATA_DIR };
  });
  const programPath = (value) => {
    if (value !== '.' && !/^\.worldloom\/releases\/[A-Za-z0-9_.-]+$/.test(value))
      throw new Error('当前版本指针无效，数据未被改变。');
    return path.resolve(root, value);
  };
  if (!path.isAbsolute(current.dataDir)) throw new Error('当前数据路径必须是固定绝对路径。');
  programPath(current.program);
  async function saveJson(filename, value) {
    const temporary = filename + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    await rename(temporary, filename);
  }
  if (firstPointer) await saveJson(currentFile, current);
  async function updateState(phase, message, version) {
    await saveJson(path.join(managed, 'update-state.json'), {
      mode: 'managed',
      phase,
      message,
      ...(version ? { version } : {}),
    });
  }
  let child;
  let updating = false;
  let stopping = false;
  const port = env.PORT || '3001';
  async function internal(action) {
    const response = await fetch(`http://127.0.0.1:${port}/_worldloom/update/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(action === 'backup' ? 600000 : 10000),
    });
    if (!response.ok) throw new Error('受保护的更新步骤未完成。');
    return response.json();
  }
  async function stopChild() {
    if (!child || child.exitCode !== null) return;
    const exited = new Promise((resolve) => child.once('exit', resolve));
    await internal('shutdown');
    await Promise.race([
      exited,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('服务未正常退出，更新已停止。')), 15000),
      ),
    ]);
    if (child.exitCode !== 0) throw new Error('服务未正常退出，更新已停止。');
  }
  async function worker(action, job, dataDir = current.dataDir) {
    const cwd = programPath(job.originalProgram || current.program);
    await command(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/update-worker.ts',
        action,
        root,
        job.packageId,
        job.originalDataDir || dataDir,
        job.backupId || '',
      ],
      { cwd, env: { ...env, DATA_DIR: dataDir, WORLDLOOM_UPDATER_TOKEN: token }, stdio: 'inherit' },
    );
  }
  function startChild(hold = false) {
    const cwd = programPath(current.program);
    child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
      cwd,
      env: {
        ...env,
        DATA_DIR: current.dataDir,
        ENV_FILE: path.join(root, '.env'),
        CHRONICLE_CARTARIUM_INSTALL_ROOT: root,
        WORLDLOOM_INSTALL_ROOT: root,
        CHRONICLE_CARTARIUM_UPDATER_TOKEN: token,
        WORLDLOOM_UPDATER_TOKEN: token,
        WORLDLOOM_UPDATE_HOLD: hold ? 'true' : 'false',
        CHRONICLE_CARTARIUM_UPDATE_HOLD: hold ? 'true' : 'false',
      },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.once('error', () => {
      if (!updating) {
        process.exitCode = 1;
        stopping = true;
      }
    });
    child.once('exit', (code) => {
      if (!updating && !stopping) {
        process.exitCode = code || 0;
        stopping = true;
        clearInterval(watcher);
      }
    });
  }
  async function ready() {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child?.exitCode !== null) throw new Error('新版未能启动。');
      try {
        return await internal('health');
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    throw new Error('新版启动检查超时。');
  }
  const runningFile = path.join(managed, 'running-update.json');
  const interrupted = await readFile(runningFile, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return undefined;
  });
  if (interrupted && interrupted.phase !== 'complete') {
    // A prior process might still be alive after a launcher crash. Only its secret token can stop it.
    try {
      await internal('shutdown');
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } catch {
      /* Instance lock below still refuses any surviving unrelated writer. */
    }
    if (interrupted.backupId) {
      await worker('recover', interrupted);
      const recovered = JSON.parse(
        await readFile(path.join(managed, 'recovered-target.json'), 'utf8'),
      );
      current = { program: interrupted.originalProgram, dataDir: recovered.dataDir };
    } else current = { program: interrupted.originalProgram, dataDir: interrupted.originalDataDir };
    await saveJson(currentFile, current);
    await updateState('rolled-back', '上次更新中断，已恢复到原版本与经过验证的数据。');
    await rename(runningFile, path.join(managed, 'interrupted-' + randomUUID() + '.json'));
  }
  let watcher;
  async function runUpdate() {
    if (updating || stopping) return;
    const pending = path.join(managed, 'pending-update.json');
    const job = await readFile(pending, 'utf8').then(JSON.parse, () => undefined);
    if (!job) return;
    if (!/^package-[A-Za-z0-9]+$/.test(job.packageId)) throw new Error('更新任务无效。');
    updating = true;
    job.originalProgram = current.program;
    job.originalDataDir = current.dataDir;
    job.phase = 'preparing';
    await rename(pending, runningFile);
    await saveJson(runningFile, job);
    const original = { ...current };
    let completed = false;
    let committed = false;
    try {
      await worker('prepare', job);
      const backup = await internal('backup');
      job.backupId = backup.id;
      job.phase = 'switching';
      await saveJson(runningFile, job);
      await updateState('switching', '完整备份与恢复验证通过，正在切换程序…', job.version);
      await stopChild();
      const name = job.version + '-' + job.id;
      await mkdir(path.join(managed, 'releases'), { recursive: true });
      await rename(
        path.join(managed, 'staged', job.packageId, 'program'),
        path.join(managed, 'releases', name),
      );
      current = { program: '.worldloom/releases/' + name, dataDir: original.dataDir };
      await saveJson(currentFile, current);
      await updateState('checking', '正在核对创作、图片、账号和权限；暂不开放保存…', job.version);
      startChild(true);
      await ready();
      await worker('check', job, current.dataDir);
      // Persist completion BEFORE reopening writes; restart must never discard new-version edits.
      job.phase = 'complete';
      await saveJson(runningFile, job);
      committed = true;
      await updateState(
        'complete',
        '更新成功，全部资料验证通过。请使用原账号重新登录并保存后刷新。',
        job.version,
      );
      await internal('release');
      completed = true;
    } catch {
      if (committed) {
        // A lost release response may follow accepted new writes. Never restore an older snapshot.
        const released = await internal('release').then(
          () => true,
          () => false,
        );
        await updateState(
          'complete',
          released
            ? '更新完成，资料验证通过。请使用原账号重新登录并保存后刷新。'
            : '更新与资料验证已完成；开放保存的确认未收到，请正常重启启动程序。现有资料保留。',
          job.version,
        );
        completed = true;
      } else if (job.backupId) {
        if (child && child.exitCode === null) await stopChild();
        await worker('recover', job);
        const recovered = JSON.parse(
          await readFile(path.join(managed, 'recovered-target.json'), 'utf8'),
        );
        current = { program: original.program, dataDir: recovered.dataDir };
        await saveJson(currentFile, current);
        startChild();
        await ready();
        await updateState(
          'rolled-back',
          '新版检查未通过，已恢复旧版本与完整资料；失败现场和原目录保留。',
        );
        completed = true;
      } else {
        await internal('release').catch(() => undefined);
        await updateState(
          'error',
          '更新准备或备份失败，原程序和数据保留。请检查网络、空间和权限后重试。',
        );
        completed = true;
      }
    } finally {
      if (completed)
        await rename(runningFile, path.join(managed, 'history-' + job.id + '.json')).catch(
          () => undefined,
        );
      updating = false;
    }
  }
  console.log(
    `${brand.nameZh}正在启动。请用浏览器打开 http://localhost:${port}/，首次使用会显示安装指引。`,
  );
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', () =>
      reject(new Error('当前端口已在使用，请使用已运行的工作台，或先正常停止原服务。')),
    );
    probe.listen(Number(port), '127.0.0.1', resolve);
  });
  await new Promise((resolve) => probe.close(resolve));
  startChild();
  watcher = setInterval(() => {
    if (stopping) return;
    void runUpdate().catch(async () => {
      stopping = true;
      clearInterval(watcher);
      await updateState(
        'error',
        '更新恢复未完成，已保留备份和原目录。请使用恢复工具处理，勿重新初始化。',
      );
    });
  }, 1000);
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      stopping = true;
      clearInterval(watcher);
      child?.kill(signal);
    });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
