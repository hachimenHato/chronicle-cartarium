const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID, randomBytes } = require('node:crypto');
const { cleanEnvironment } = require('./service.cjs');
const { prepared } = require('./shell-update-helper.cjs');
const { compare } = require('../shared/desktop-update-security.cjs');
async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}
async function save(file, value) {
  const temp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  await fs.rename(temp, file);
}
function environment(base) {
  const env = cleanEnvironment(process.env, base, {}, 3001);
  delete env.DATA_DIR;
  delete env.PORT;
  delete env.HOST;
  return env;
}
async function delegateUpdatedShell(app, base) {
  const activeFile = path.join(base, '.desktop/updates/active-job.json');
  const active = await readJson(activeFile);
  const running = (pid) => {
    if (!Number.isSafeInteger(pid) || pid < 1) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  if (active && !running(active.parentPid) && !running(active.helperPid)) {
    // No updater owns this interrupted job. Keep all releases, backups and workspace files.
    await save(path.join(base, '.desktop/shell-update-status.json'), {
      phase: 'error',
      message: '上次桌面切换已中断，原入口与资料保留。请检查工作台状态后再发起更新。',
    });
    await fs.unlink(activeFile);
  }
  const pointer = await readJson(path.join(base, '.desktop/current-shell.json'));
  if (!pointer) return false;
  if (pointer.format !== 1 || typeof pointer.version !== 'string')
    throw new Error('桌面更新指针无效，原资料保留。');
  if (compare(pointer.version, app.getVersion()) <= 0) return false;
  const executable = await prepared(base, pointer.releaseId, pointer.version);
  if (path.resolve(executable).toLowerCase() === path.resolve(app.getPath('exe')).toLowerCase())
    return false;
  const child = spawn(executable, [], {
    cwd: path.dirname(executable),
    env: { ...environment(base), CHRONICLE_CARTARIUM_DESKTOP_ROOT: base },
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  app.exit(0);
  return true;
}
async function reportShellStartup(app, base, backend, success) {
  const id = process.env.CHRONICLE_CARTARIUM_SHELL_JOB,
    nonce = process.env.CHRONICLE_CARTARIUM_SHELL_NONCE;
  if (!id && !nonce) return;
  if (!/^[a-f0-9-]{36}$/.test(id || '') || !/^[a-f0-9]{64}$/.test(nonce || ''))
    throw new Error('桌面启动验证参数无效');
  const directory = path.join(base, '.desktop/updates');
  const job = await readJson(path.join(directory, `job-${id}.json`));
  if (
    !job ||
    job.nonce !== nonce ||
    job.version !== app.getVersion() ||
    path.resolve(await prepared(base, job.releaseId, job.version)).toLowerCase() !==
      path.resolve(app.getPath('exe')).toLowerCase()
  )
    throw new Error('桌面启动身份不匹配');
  const health = success && backend ? await backend.control('health', 10000) : undefined;
  await save(path.join(directory, `ack-${id}.json`), {
    id,
    nonce,
    version: app.getVersion(),
    pid: process.pid,
    success: !!success,
    workspace: backend?.directory,
    health,
  });
}
class ShellUpdater {
  constructor(options) {
    Object.assign(this, options);
    this.active = false;
  }
  async dirty() {
    return this.window.webContents
      .executeJavaScript(
        `(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()`,
      )
      .catch(() => true);
  }
  async ownerSettings() {
    const backend = this.getBackend();
    if (!backend?.origin) throw new Error('请先打开并登录工作台。');
    const response = await this.window.webContents.session.fetch(backend.origin + '/api/status', {
      credentials: 'include',
    });
    if (!response.ok || (await response.json()).actor?.role !== 'owner')
      throw new Error('请先以主管理员身份操作，才能更新桌面程序。');
    const online = await this.window.webContents.session.fetch(
      backend.origin + '/api/admin/updates/online',
      { credentials: 'include' },
    );
    if (online.ok) return (await online.json()).settings;
    if (online.status !== 404) throw new Error('无法确认主管理员的更新配置，请重新登录后重试。');
    return {
      source: 'github',
      channel: this.app.getVersion().includes('-') ? 'preview' : 'stable',
    };
  }
  async execute(action, settings, version, onProgress, onChild) {
    const directory = path.join(this.base, '.desktop/updates');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const request = path.join(directory, 'request-' + randomUUID() + '.json');
    await fs.writeFile(
      request,
      JSON.stringify({
        base: this.base,
        currentVersion: this.app.getVersion(),
        settings,
        ...(version ? { version } : {}),
      }),
      { flag: 'wx', mode: 0o600 },
    );
    let result,
      error,
      pending = '';
    try {
      const child = spawn(
        path.join(this.template, 'runtime/node.exe'),
        ['--import', 'tsx', 'scripts/desktop-update.ts', action, request],
        {
          cwd: this.template,
          env: environment(this.base),
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'ignore'],
        },
      );
      child.stdin.on('error', () => {});
      onChild?.(child);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        pending += chunk;
        if (pending.length > 128 * 1024) {
          error = '桌面更新返回了无效状态。';
          child.stdin.write('cancel\n');
          return;
        }
        let newline;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.kind === 'progress') onProgress?.(message);
            else if (message.kind === 'result') result = message;
            else if (message.kind === 'error') error = message.message;
          } catch {
            error = '桌面更新返回了无效状态。';
          }
        }
      });
      const code = await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', resolve);
      });
      if (code !== 0 || error || !result)
        throw new Error(error || '桌面更新未能完成，原程序和资料保留。');
      return result;
    } finally {
      await fs.unlink(request).catch(() => {});
    }
  }
  async check() {
    if (this.active || !this.canBegin()) return;
    this.active = true;
    this.setBusy(true);
    let progressWindow,
      child,
      cancelled = false,
      phase = 'downloading',
      held = false,
      stopped = false,
      handedOff = false,
      activeId;
    const backend = this.getBackend();
    const note = async (message) => {
      if (progressWindow && !progressWindow.isDestroyed())
        await progressWindow.webContents
          .executeJavaScript(
            `document.getElementById('status').textContent=${JSON.stringify(message)}`,
          )
          .catch(() => {});
    };
    try {
      if (await readJson(path.join(this.base, '.desktop/updates/active-job.json')))
        throw new Error('桌面更新正在切换或验证，请等待完成。');
      const settings = await this.ownerSettings();
      if (await this.dirty()) throw new Error('请先保存所有编辑并等待保存完成，再更新桌面程序。');
      progressWindow = new this.BrowserWindow({
        width: 560,
        height: 300,
        parent: this.window,
        modal: true,
        resizable: false,
        title: '桌面程序更新',
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      });
      progressWindow.setMenu(null);
      progressWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      progressWindow.webContents.on('will-navigate', (event) => event.preventDefault());
      await progressWindow.loadFile(path.join(__dirname, 'loading.html'));
      await progressWindow.webContents.executeJavaScript(
        `document.getElementById('brand-name').textContent='桌面程序更新';document.getElementById('brand-english').textContent='DESKTOP UPDATE'`,
      );
      progressWindow.on('close', (event) => {
        event.preventDefault();
        if (phase === 'downloading') {
          cancelled = true;
          child?.stdin.write('cancel\n');
          void note('正在取消，原程序与资料保留…');
        }
      });
      await note('正在检查官方桌面发行。关闭此小窗可取消。');
      const found = await this.execute('check', settings, undefined, undefined, (process) => {
        child = process;
        if (cancelled) child.stdin.write('cancel\n');
      });
      if (cancelled) return;
      if (!found.candidate) {
        await this.dialog.showMessageBox(progressWindow, {
          message: `当前桌面程序 ${this.app.getVersion()} 已是所选渠道的最新可用版本。`,
        });
        return;
      }
      const choice = await this.dialog.showMessageBox(progressWindow, {
        type: 'info',
        title: '发现桌面程序更新',
        message: `桌面程序 ${this.app.getVersion()} → ${found.candidate.version}`,
        detail: `下载约 ${(found.candidate.bytes / 1024 / 1024).toFixed(1)} MB。将验证官方签名、完整备份，退出窗口后自动安装并重新打开原工作台。\n\n${found.candidate.notes}`,
        buttons: ['下载并安装', '稍后'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (choice.response !== 0 || cancelled) return;
      const downloaded = await this.execute(
        'stage',
        settings,
        found.candidate.version,
        (message) => {
          phase = message.phase;
          const fraction = Math.min(1, Math.max(0, message.received / message.total));
          this.window.setProgressBar(fraction);
          void note(
            phase === 'verifying'
              ? '正在验签、解压并检查所有桌面文件。完成前请稍候…'
              : `正在下载桌面程序 ${Math.round(fraction * 100)}%。关闭此小窗可取消。`,
          );
        },
        (process) => {
          child = process;
          if (cancelled) child.stdin.write('cancel\n');
        },
      );
      if (cancelled) return;
      phase = 'verifying';
      await this.ownerSettings();
      if (await this.dirty()) throw new Error('检测到未保存内容，请保存后重新发起桌面更新。');
      const ready = downloaded.prepared;
      await prepared(this.base, ready.releaseId, ready.version);
      const id = randomUUID(),
        nonce = randomBytes(32).toString('hex');
      const activeFile = path.join(this.base, '.desktop/updates/active-job.json');
      await fs.writeFile(activeFile, JSON.stringify({ id, parentPid: process.pid }), {
        flag: 'wx',
        mode: 0o600,
      });
      activeId = id;
      await note('官方签名与全部文件检查通过，正在完整备份并验证原工作台…');
      held = true;
      const backup = await backend.control('backup', 600000, activeId);
      if (!backup.verified) throw new Error('完整备份验证未完成，未切换桌面程序。');
      const before = await backend.control('health', 10000);
      const helperRoot = path.join(this.base, '.desktop/updates', 'helper-' + id);
      await fs.mkdir(helperRoot, { mode: 0o700 });
      for (const [source, destination] of [
        ['shell-update-helper.cjs', 'helper.cjs'],
        ['../shared/desktop-update-security.cjs', 'desktop-update-security.cjs'],
        ['../shared/release-trust.json', 'release-trust.json'],
      ])
        await fs.copyFile(path.resolve(__dirname, source), path.join(helperRoot, destination));
      const previous = await readJson(path.join(this.base, '.desktop/current-shell.json'));
      const job = {
        format: 1,
        id,
        nonce,
        parentPid: process.pid,
        oldExe: this.app.getPath('exe'),
        workspace: backend.directory,
        before,
        backupId: backup.id,
        previous,
        ...ready,
      };
      await save(path.join(this.base, '.desktop/updates', `job-${id}.json`), job);
      if (backend.owned) {
        await backend.stop();
        held = false;
        stopped = true;
      } else {
        await backend.control('release', 10000, activeId);
        held = false;
      }
      await note('备份已验证，正在退出并切换桌面程序。工作台和数据目录保持不变…');
      const helper = spawn(
        path.join(this.template, 'runtime/node.exe'),
        [path.join(helperRoot, 'helper.cjs'), this.base, id],
        { env: environment(this.base), windowsHide: true, detached: true, stdio: 'ignore' },
      );
      await new Promise((resolve, reject) => {
        helper.once('spawn', resolve);
        helper.once('error', reject);
      });
      await save(activeFile, { id, parentPid: process.pid, helperPid: helper.pid });
      helper.unref();
      handedOff = true;
      this.handoff();
    } catch (error) {
      if (stopped && !handedOff) {
        try {
          await this.window.loadURL(await backend.start());
        } catch {}
      }
      if (!cancelled)
        await this.dialog.showMessageBox(this.window, {
          type: 'warning',
          message: error.message,
          detail: '原程序与资料保留。桌面更新不会恢复旧数据快照覆盖创作。',
        });
    } finally {
      if (held) await backend.control('release', 10000, activeId).catch(() => {});
      if (activeId && !handedOff) {
        const activeFile = path.join(this.base, '.desktop/updates/active-job.json');
        if ((await readJson(activeFile).catch(() => undefined))?.id === activeId)
          await fs.unlink(activeFile).catch(() => {});
      }
      if (progressWindow && !progressWindow.isDestroyed()) progressWindow.destroy();
      this.window.setProgressBar(-1);
      this.active = false;
      this.setBusy(false);
    }
  }
}
module.exports = { ShellUpdater, delegateUpdatedShell, reportShellStartup };
