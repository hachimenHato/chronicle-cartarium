const { access, cp, mkdir, readFile, rename, writeFile, open } = require('node:fs/promises');
const { createWriteStream } = require('node:fs');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { parseEnv } = require('node:util');

const exists = (filename) =>
  access(filename).then(
    () => true,
    () => false,
  );
const validPort = (value) =>
  Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) < 65536;
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function readJson(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
async function writeJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temporary, filename);
}
async function isProgram(directory) {
  if (!(await exists(path.join(directory, 'scripts/launch.mjs')))) return false;
  const pkg = await readJson(path.join(directory, 'package.json'));
  return ['chronicle-cartarium', 'worldloom'].includes(pkg?.name);
}
async function bootstrapInstance(template, destination) {
  if (await exists(destination)) {
    if (!(await isProgram(destination)))
      throw new Error('所选目录不是完整工作台，已有文件保持不变。');
    return false;
  }
  if (!(await isProgram(template))) throw new Error('应用的运行组件不完整，请重新解压桌面版。');
  for (const name of ['data', '.env', '.worldloom', 'mysql.txt'])
    if (await exists(path.join(template, name)))
      throw new Error('运行模板包含私有数据，已拒绝初始化。');
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.preparing-${randomUUID()}`;
  // Copy to a fresh sibling and publish atomically. Existing installations are never overwritten.
  await cp(template, temporary, { recursive: true, force: false, errorOnExist: true });
  await rename(temporary, destination);
  return true;
}
async function availablePort(preferred) {
  const probe = (port) =>
    new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        const allocated = server.address().port;
        server.close((error) => (error ? reject(error) : resolve(allocated)));
      });
    });
  try {
    return await probe(preferred);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    return probe(0);
  }
}
function cleanEnvironment(parent, directory, configured, port) {
  const env = { ...parent };
  for (const key of Object.keys(env))
    if (
      /^(?:DATABASE_URL|APP_PASSWORD|SESSION_SECRET|ENV_FILE|SETUP_TOKEN|HOST|PORT|DATA_DIR|NODE_ENV|NODE_OPTIONS|NODE_PATH|TSX_TSCONFIG_PATH|INSTALLATION_WIZARD|WORLDLOOM_.*|CHRONICLE_CARTARIUM_.*|ELECTRON_.*)$/.test(
        key,
      )
    )
      delete env[key];
  return {
    ...env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: path.resolve(directory, configured.DATA_DIR || 'data'),
  };
}
class BackendSession {
  constructor({
    directory,
    node,
    ownerId,
    notify = () => {},
    parentEnvironment = process.env,
    portHint,
  }) {
    this.directory = path.resolve(directory);
    this.node = node;
    this.ownerId = ownerId;
    this.notify = notify;
    this.parentEnvironment = parentEnvironment;
    this.portHint = validPort(portHint) ? Number(portHint) : undefined;
    this.owned = false;
    this.child = undefined;
    this.origin = undefined;
    this.port = undefined;
  }
  async control(action, timeout = 5000) {
    if (!this.origin) throw new Error('工作台尚未连接。');
    const token = await readFile(path.join(this.directory, '.worldloom/runner.key'), 'utf8');
    const result = await fetch(`${this.origin}/_worldloom/update/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(timeout),
    });
    if (!result.ok) throw new Error('未能确认工作台身份，未执行控制操作。');
    return result.json();
  }
  async start() {
    if (!(await isProgram(this.directory))) throw new Error('所选目录不是完整工作台。');
    let configured = {};
    try {
      configured = parseEnv(await readFile(path.join(this.directory, '.env'), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const sessionFile = path.join(this.directory, '.worldloom/desktop-session.json');
    const previous = await readJson(sessionFile);
    const candidates = [
      ...new Set(
        [previous?.port, this.portHint || configured.PORT || 3001].filter(validPort).map(Number),
      ),
    ];
    for (const port of candidates) {
      this.port = port;
      this.origin = `http://127.0.0.1:${port}`;
      try {
        const status = await fetch(this.origin + '/api/status', {
          signal: AbortSignal.timeout(1200),
        });
        const body = await status.json();
        if (
          !status.ok ||
          (!['mysql', 'sqlite', 'unconfigured'].includes(body.mode) &&
            typeof body.setupRequired !== 'boolean')
        )
          continue;
        const health = await this.control('health', 1500);
        if (!Number.isInteger(health.revision) || !/^[a-f0-9]{64}$/.test(health.digest)) continue;
        // A persisted PID is not proof of ownership (PIDs can be reused). Never stop an attached service.
        this.owned = false;
        this.notify('已连接正在运行的工作台');
        return this.origin;
      } catch {
        /* An occupied port is not evidence of a matching workspace. */
      }
    }
    const preferred =
      this.portHint || (validPort(configured.PORT) ? Number(configured.PORT) : 3001);
    this.port = await availablePort(preferred);
    this.origin = `http://127.0.0.1:${this.port}`;
    const managed = path.join(this.directory, '.worldloom');
    await mkdir(managed, { recursive: true, mode: 0o700 });
    // Prove the instance is writable before launching; never silently pick an empty fallback data path.
    const probeFile = path.join(managed, `desktop-probe-${randomUUID()}`);
    const probe = await open(probeFile, 'wx', 0o600);
    await probe.close();
    await require('node:fs/promises').unlink(probeFile);
    const log = createWriteStream(path.join(managed, 'desktop.log'), { flags: 'a', mode: 0o600 });
    this.log = log;
    this.notify('正在启动本机工作台…');
    this.child = spawn(this.node, ['scripts/launch.mjs'], {
      cwd: this.directory,
      env: cleanEnvironment(this.parentEnvironment, this.directory, configured, this.port),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child.stdout.pipe(log, { end: false });
    this.child.stderr.pipe(log, { end: false });
    let failure;
    this.child.once('error', (error) => {
      failure = error;
    });
    this.child.once('exit', () => {
      log.end();
    });
    for (let attempt = 0; attempt < 240; attempt++) {
      if (failure || this.child.exitCode !== null)
        throw new Error('工作台未能启动。请检查目录中的 .worldloom/desktop.log，原数据保持不变。');
      try {
        const result = await fetch(this.origin + '/api/status', {
          signal: AbortSignal.timeout(1000),
        });
        if (result.ok) {
          const health = await this.control('health', 1500);
          if (Number.isInteger(health.revision)) {
            this.owned = true;
            await writeJson(sessionFile, {
              format: 1,
              port: this.port,
              desktopPid: process.pid,
              launcherPid: this.child.pid,
              ownerId: this.ownerId,
            });
            return this.origin;
          }
        }
      } catch {}
      await delay(250);
    }
    throw new Error('工作台启动超时，后台日志和原数据已保留；请勿重新初始化。');
  }
  async dataDirectory() {
    const pointer = await readJson(path.join(this.directory, '.worldloom/current.json'));
    if (!pointer || !path.isAbsolute(pointer.dataDir)) throw new Error('未找到固定数据路径。');
    return pointer.dataDir;
  }
  async stop() {
    if (!this.owned) return;
    if (this.child && this.child.exitCode !== null) {
      this.owned = false;
      return;
    }
    for (const name of ['pending-update.json', 'running-update.json'])
      if (await exists(path.join(this.directory, '.worldloom', name)))
        throw new Error('工作台正在更新或恢复，请等待完成后再退出。');
    const state = await readJson(path.join(this.directory, '.worldloom/update-state.json'));
    if (
      ['preparing', 'backup', 'switching', 'checking', 'restoring', 'updating'].includes(
        state?.phase,
      )
    )
      throw new Error('工作台正在更新或恢复，请等待完成后再退出。');
    await this.control('shutdown', 10000);
    if (this.child) {
      for (let attempt = 0; attempt < 120 && this.child.exitCode === null; attempt++)
        await delay(250);
      if (this.child.exitCode === null) throw new Error('工作台尚未正常退出，未强行结束进程。');
    } else {
      for (let attempt = 0; attempt < 120; attempt++) {
        try {
          await this.control('health', 300);
        } catch {
          this.owned = false;
          return;
        }
        await delay(250);
      }
      throw new Error('工作台尚未正常退出，未强行结束进程。');
    }
    this.owned = false;
  }
}
module.exports = { bootstrapInstance, isProgram, BackendSession, cleanEnvironment, availablePort };
