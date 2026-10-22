const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron');
const path = require('node:path');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { bootstrapInstance, BackendSession, isProgram } = require('./service.cjs');
const { ShellUpdater, delegateUpdatedShell, reportShellStartup } = require('./shell-update.cjs');
const brand = require('../shared/brand.json');

const base = process.env.CHRONICLE_CARTARIUM_DESKTOP_ROOT
  ? path.resolve(process.env.CHRONICLE_CARTARIUM_DESKTOP_ROOT)
  : app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.resolve(__dirname, '../.runtime/desktop-instance');
const template =
  process.env.CHRONICLE_CARTARIUM_DESKTOP_TEMPLATE || path.join(process.resourcesPath, 'backend');
const ownerId = createHash('sha256').update(base).digest('hex');
const preferences = path.join(base, '.desktop/settings.json');
let window;
let backend;
let quitReady = false;
let busy = false;
let loading = true;
let allowingUnload = false;

async function status(text) {
  if (loading && window && !window.isDestroyed())
    await window.webContents
      .executeJavaScript(`document.getElementById('status').textContent=${JSON.stringify(text)}`)
      .catch(() => {});
}
async function showLoading() {
  loading = true;
  await window.loadFile(path.join(__dirname, 'loading.html'));
  await window.webContents.executeJavaScript(
    `document.getElementById('brand-name').textContent=${JSON.stringify(brand.nameZh)};document.getElementById('brand-english').textContent=${JSON.stringify(brand.nameEn.toUpperCase())}`,
  );
}
async function openWorkspace(directory, create = false) {
  if (busy) return;
  busy = true;
  try {
    if (!create && !(await isProgram(directory)))
      throw new Error('请选择包含 scripts/launch.mjs 的完整工作台目录，不能只选 data 目录。');
    allowingUnload = true;
    try {
      await showLoading();
    } finally {
      allowingUnload = false;
    }
    if (backend) await backend.stop();
    if (create) {
      await status('首次启动，正在准备运行组件。无需联网…');
      await bootstrapInstance(template, directory);
    }
    backend = new BackendSession({
      directory,
      node: path.join(template, 'runtime/node.exe'),
      ownerId,
      notify: status,
      portHint: process.env.CHRONICLE_CARTARIUM_DESKTOP_PORT,
    });
    const origin = await backend.start();
    await mkdir(path.dirname(preferences), { recursive: true });
    await writeFile(
      preferences,
      JSON.stringify({ format: 1, workspace: path.resolve(directory) }),
      { mode: 0o600 },
    );
    loading = false;
    await window.loadURL(origin);
    window.setTitle(`${brand.nameZh} · ${brand.nameEn}`);
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: 'error',
      title: '工作台未能打开',
      message: error.message,
      detail: '原有数据没有被替换。可从“工作台”菜单选择原目录，或退出后重新解压程序。',
    });
  } finally {
    busy = false;
  }
}
async function chooseWorkspace() {
  if (busy) return;
  if (!(await confirmUnload())) return;
  const result = await dialog.showOpenDialog(window, {
    title: '打开已有工作台（选择程序根目录）',
    properties: ['openDirectory'],
  });
  if (!result.canceled) await openWorkspace(result.filePaths[0]);
}
async function confirmUnload() {
  if (loading || !window || window.isDestroyed()) return true;
  // Reuse the web app's real unsaved-work guard without granting renderer Node/IPC access.
  const dirty = await window.webContents
    .executeJavaScript(
      `(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})()`,
    )
    .catch(() => true);
  if (!dirty) return true;
  const result = await dialog.showMessageBox(window, {
    type: 'warning',
    title: '有未保存的内容',
    message: '仍有未保存的编辑。建议取消后保存，再关闭或切换工作台。',
    buttons: ['返回保存', '放弃未保存内容'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  return result.response === 1;
}
async function quit() {
  if (quitReady || busy) return;
  if (!(await confirmUnload())) return;
  busy = true;
  try {
    if (backend?.owned) {
      await status('正在安全关闭工作台…');
      await backend.stop();
    }
    quitReady = true;
    app.quit();
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: 'warning',
      message: error.message,
      detail: '窗口保持打开，没有强行结束服务。',
    });
  } finally {
    busy = false;
  }
}
async function initialize() {
  if (await delegateUpdatedShell(app, base)) return;
  require('node:fs').mkdirSync(path.join(base, '.desktop'), { recursive: true });
  app.setPath('userData', path.join(base, '.desktop'));
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  await app.whenReady();
  app.setAppUserModelId('ChronicleCartarium.Desktop');
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 760,
    minHeight: 600,
    backgroundColor: '#f3f1e8',
    title: `${brand.nameZh} · ${brand.nameEn}`,
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      spellcheck: false,
      safeDialogs: true,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    try {
      if (new URL(url).origin !== backend?.origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on('will-redirect', (event, url) => {
    try {
      if (new URL(url).origin !== backend?.origin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on('will-prevent-unload', async (event) => {
    // Programmatic close has already checked the same draft guard; native reload asks explicitly.
    if (allowingUnload) {
      event.preventDefault();
      return;
    }
    const answer = dialog.showMessageBoxSync(window, {
      type: 'warning',
      message: '页面有未保存的内容，仍要离开吗？',
      buttons: ['留在页面', '离开'],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer === 1) event.preventDefault();
  });
  window.on('close', (event) => {
    if (!quitReady) {
      event.preventDefault();
      void quit();
    }
  });
  app.on('before-quit', (event) => {
    if (!quitReady) {
      event.preventDefault();
      void quit();
    } else allowingUnload = true;
  });
  session.defaultSession.on('will-download', (_event, item) => {
    const name = path.basename(item.getFilename()).replace(/[<>:"/\\|?*]/g, '_');
    item.setSaveDialogOptions({
      title: '保存导出文件',
      defaultPath: path.join(app.getPath('downloads'), name),
      properties: ['showOverwriteConfirmation'],
    });
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: '工作台',
        submenu: [
          {
            label: '打开已有工作台…',
            accelerator: 'CmdOrCtrl+O',
            click: () => void chooseWorkspace(),
          },
          {
            label: '打开数据文件夹',
            click: async () => {
              try {
                const directory = await backend?.dataDirectory();
                if (directory) await shell.openPath(directory);
              } catch {
                await dialog.showMessageBox(window, { message: '工作台尚未准备好。' });
              }
            },
          },
          { type: 'separator' },
          { label: '退出', accelerator: 'Alt+F4', click: () => void quit() },
        ],
      },
      {
        label: '编辑',
        submenu: [
          { role: 'undo', label: '撤销' },
          { role: 'redo', label: '重做' },
          { type: 'separator' },
          { role: 'cut', label: '剪切' },
          { role: 'copy', label: '复制' },
          { role: 'paste', label: '粘贴' },
          { role: 'selectAll', label: '全选' },
        ],
      },
      {
        label: '视图',
        submenu: [
          { role: 'reload', label: '刷新', accelerator: 'F5' },
          { role: 'resetZoom', label: '恢复界面大小' },
          { role: 'zoomIn', label: '放大界面' },
          { role: 'zoomOut', label: '缩小界面' },
          { role: 'togglefullscreen', label: '全屏', accelerator: 'F11' },
        ],
      },
      {
        label: '帮助',
        submenu: [
          {
            label: '检查桌面程序更新…',
            click: () => void shellUpdater.check(),
          },
          {
            label: '使用说明',
            click: () =>
              shell.openExternal('https://github.com/hachimenHato/chronicle-cartarium#readme'),
          },
          {
            label: '关于编年图志',
            click: () =>
              dialog.showMessageBox(window, {
                title: '关于编年图志',
                message: `${brand.nameZh} · ${brand.nameEn}`,
                detail: `桌面版 ${app.getVersion()}\n本地窗口与内置服务，原创代码 0BSD。\n数据保存在工作台目录；CMD/服务器版继续独立提供。`,
              }),
          },
        ],
      },
    ]),
  );
  const shellUpdater = new ShellUpdater({
    app,
    BrowserWindow,
    dialog,
    window,
    base,
    template,
    getBackend: () => backend,
    canBegin: () => !busy && !quitReady && !loading,
    setBusy: (value) => {
      busy = value;
    },
    handoff: () => {
      quitReady = true;
      allowingUnload = true;
      app.quit();
    },
  });
  let selected = path.join(base, 'workspace');
  try {
    const settings = JSON.parse(await readFile(preferences, 'utf8'));
    if (settings.format !== 1 || !path.isAbsolute(settings.workspace)) throw new Error('invalid');
    selected = settings.workspace;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('桌面目录设置无效，未切换到空白工作台。');
  }
  await openWorkspace(selected, selected === path.join(base, 'workspace'));
  if (!loading && backend)
    await writeFile(
      path.join(base, '.desktop/shell-session.json'),
      JSON.stringify({
        format: 1,
        version: app.getVersion(),
        pid: process.pid,
        executable: app.getPath('exe'),
        workspace: backend.directory,
      }),
      { mode: 0o600 },
    );
  await reportShellStartup(app, base, backend, !loading);
}
initialize().catch(async (error) => {
  await app.whenReady();
  await dialog.showMessageBox({
    type: 'error',
    title: '编年图志无法启动',
    message: error.message,
    detail: '请将桌面版解压到自己有写入权限的目录。原数据保持不变。',
  });
  quitReady = true;
  app.quit();
});
