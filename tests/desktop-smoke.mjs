import { _electron, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

const root = process.cwd();
const build = JSON.parse(await readFile('.runtime/desktop-work/build-result.json', 'utf8'));
assert(
  build.output.startsWith(path.join(root, '.runtime/desktop-work') + path.sep),
  'Only isolated desktop build outputs may be tested',
);
const directory = path.join(root, '.runtime/desktop-work', `ui-${Date.now()}`);
await mkdir(directory);
const password = randomBytes(20).toString('base64url');
let current;
const errors = [];
async function launch() {
  const env = {
    ...process.env,
    CHRONICLE_CARTARIUM_DESKTOP_ROOT: directory,
    CHRONICLE_CARTARIUM_DESKTOP_PORT: '3313',
    DATABASE_URL: 'mysql://synthetic-do-not-connect@should-never-connect.invalid/synthetic',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  current = await _electron.launch({ executablePath: build.executable, env, timeout: 120000 });
  await current.evaluate(({ dialog }) => {
    globalThis.__desktopDialogs = [];
    globalThis.__desktopReply = 0;
    dialog.showMessageBox = async (...args) => {
      const options = args.at(-1);
      globalThis.__desktopDialogs.push({ type: options.type, message: options.message });
      return { response: globalThis.__desktopReply };
    };
    dialog.showMessageBoxSync = (...args) => {
      globalThis.__desktopDialogs.push({ message: args.at(-1).message });
      return globalThis.__desktopReply;
    };
  });
  const page = await current.firstWindow({ timeout: 120000 });
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => errors.push(error.message));
  return page;
}
async function quit() {
  const closed = once(current.process(), 'exit');
  await current.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu().items.find((item) => item.label === '工作台');
    menu.submenu.items.find((item) => item.label === '退出').click();
  });
  let timer;
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Desktop did not quit gracefully')), 40000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function dismissTutorial(page) {
  const end = page.getByRole('button', { name: '结束工具教学' });
  if (await end.isVisible().catch(() => false)) await end.click();
}
try {
  let page = await launch();
  await expect(page.getByRole('heading', { name: '数据保存在哪里？' })).toBeVisible({
    timeout: 120000,
  });
  const preferences = await current.evaluate(({ BrowserWindow, Menu }) => ({
    prefs: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
    menus: Menu.getApplicationMenu().items.map((item) => item.label),
  }));
  assert.equal(preferences.prefs.nodeIntegration, false);
  assert.equal(preferences.prefs.contextIsolation, true);
  assert.equal(preferences.prefs.sandbox, true);
  assert(preferences.menus.includes('工作台'));
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.getByRole('radio', { name: /MySQL 数据库/ }).check();
  await expect(page.getByLabel('数据库主机')).toBeVisible();
  await page.getByRole('radio', { name: /本地数据库/ }).check();
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('工作台名称').fill('桌面版实测工作台');
  await page.getByLabel('界面主题').selectOption('jade');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByLabel('填充范例内容')).not.toBeChecked();
  await page.getByLabel('填充范例内容').check();
  await page.getByLabel('用户名', { exact: true }).fill('desktop_gm');
  await page.getByLabel('登录密码', { exact: true }).fill(password);
  await page.getByLabel('再次输入密码').fill(password);
  await page.getByRole('button', { name: '完成安装并进入' }).click();
  await expect(page.getByRole('heading', { name: '创作仪表盘' })).toBeVisible({ timeout: 90000 });
  await dismissTutorial(page);
  await page.screenshot({ path: path.join(root, '.runtime/desktop-work/dashboard.png') });
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('.atlas-inspector')).toBeVisible();
  await expect(page.locator('.atlas-canvas').first()).toBeVisible({ timeout: 90000 });
  await page.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(page.getByRole('button', { name: '年均气温', exact: true })).toBeEnabled({
    timeout: 120000,
  });
  await expect(page.getByRole('button', { name: '导出 SVG', exact: true })).toBeEnabled({
    timeout: 120000,
  });
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible({ timeout: 90000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(root, '.runtime/desktop-work/map.png') });
  const origin = new URL(page.url()).origin;
  const before = await page.evaluate(async () => (await fetch('/api/workspace')).json());
  assert.equal(before.data.maps.length, 4);
  assert(before.data.entities.length >= 85);
  const blocked = await current.evaluate(({ BrowserWindow }) => {
    let prevented = false;
    BrowserWindow.getAllWindows()[0].webContents.emit(
      'will-navigate',
      {
        preventDefault() {
          prevented = true;
        },
      },
      'https://example.invalid/',
    );
    return prevented;
  });
  assert.equal(blocked, true);
  // Exercise Electron download plumbing with a local artifact; no browser or native dialog is opened by automation.
  const exported = path.join(directory, 'desktop-export.md');
  await current.evaluate(({ session }, filename) => {
    session.defaultSession.once('will-download', (_event, item) => {
      item.setSavePath(filename);
    });
  }, exported);
  await page.getByRole('button', { name: '导出世界档案', exact: true }).click();
  await page.getByRole('button', { name: '下载 Markdown', exact: true }).click();
  await expect
    .poll(async () => readFile(exported, 'utf8').catch(() => ''), { timeout: 15000 })
    .toContain('月汐诸国');
  await page.evaluate(() => {
    window.__testDraft = (event) => event.preventDefault();
    window.addEventListener('beforeunload', window.__testDraft);
  });
  await current.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      .items.find((item) => item.label === '工作台')
      .submenu.items.find((item) => item.label === '退出')
      .click();
  });
  await expect
    .poll(() =>
      current.evaluate(() =>
        globalThis.__desktopDialogs.some((item) => item.message.includes('未保存')),
      ),
    )
    .toBe(true);
  assert.equal(current.process().exitCode, null);
  assert.equal((await fetch(origin + '/api/status')).status, 200);
  await page.evaluate(() => window.removeEventListener('beforeunload', window.__testDraft));
  await quit();
  await assert.rejects(fetch(origin + '/api/status', { signal: AbortSignal.timeout(1000) }));
  page = await launch();
  await expect(page.getByLabel('登录密码', { exact: true })).toBeVisible({ timeout: 90000 });
  await page.getByLabel('用户名', { exact: true }).fill('desktop_gm');
  await page.getByLabel('登录密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '进入创作工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作仪表盘' })).toBeVisible({ timeout: 60000 });
  await dismissTutorial(page);
  const after = await page.evaluate(async () => (await fetch('/api/workspace')).json());
  assert.deepEqual(after.data, before.data);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(errors, []);
  await quit();
  await writeFile(
    '.runtime/desktop-work/electron-verification.json',
    JSON.stringify(
      {
        directory,
        installationChoices: true,
        sqliteExampleInstalled: true,
        mapDisplayed: true,
        nativeMenus: true,
        rendererSandbox: true,
        navigationRestricted: true,
        exportDownload: true,
        unsavedCloseCancelled: true,
        ownedServiceStopped: true,
        restartLogin: true,
        workspaceAndRevisionUnchanged: true,
        pageErrors: errors.length,
      },
      null,
      2,
    ),
  );
  console.log('Desktop GUI installation/map/export/close/restart verified.');
} catch (error) {
  if (current?.process().exitCode === null) {
    console.log(
      JSON.stringify({
        dialogs: await current.evaluate(() => globalThis.__desktopDialogs).catch(() => []),
        windows: current.windows().map((page) => page.url()),
      }),
    );
    await current
      .evaluate(() => {
        globalThis.__desktopReply = 1;
      })
      .catch(() => {});
    await quit().catch(() => {});
  }
  throw error;
}
