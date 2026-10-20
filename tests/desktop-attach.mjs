import { _electron, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd();
const build = JSON.parse(await readFile('.runtime/desktop-work/build-result.json', 'utf8'));
const ui = JSON.parse(await readFile('.runtime/desktop-work/electron-verification.json', 'utf8'));
const workspace = path.join(ui.directory, 'workspace');
assert(workspace.startsWith(path.join(root, '.runtime/desktop-work') + path.sep));
const directory = path.join(root, '.runtime/desktop-work', `attach-${Date.now()}`);
await mkdir(path.join(directory, '.desktop'), { recursive: true });
await writeFile(
  path.join(directory, '.desktop/settings.json'),
  JSON.stringify({ format: 1, workspace }),
);
await writeFile(path.join(workspace, '.env'), 'PORT=3314\n');
const env = { ...process.env, PORT: '3314', NODE_ENV: 'production', COOKIE_SECURE: 'false' };
for (const name of [
  'DATABASE_URL',
  'DATA_DIR',
  'HOST',
  'APP_PASSWORD',
  'ENV_FILE',
  'ELECTRON_RUN_AS_NODE',
])
  delete env[name];
const log = createWriteStream('.runtime/desktop-work/attach-backend.log');
const cmd = spawn(path.join(build.template, 'runtime/node.exe'), ['scripts/launch.mjs'], {
  cwd: workspace,
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
cmd.stdout.pipe(log);
cmd.stderr.pipe(log);
const origin = 'http://127.0.0.1:3314';
let app;
let appClosed = false;
async function control(action) {
  const token = await readFile(path.join(workspace, '.worldloom/runner.key'), 'utf8');
  const response = await fetch(origin + '/_worldloom/update/' + action, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(5000),
  });
  assert(response.ok);
  return response.json();
}
try {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(origin + '/api/status')).ok) break;
    } catch {}
    if (cmd.exitCode !== null) throw new Error('Synthetic CMD service exited');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const before = await control('health');
  app = await _electron.launch({
    executablePath: build.executable,
    env: { ...env, CHRONICLE_CARTARIUM_DESKTOP_ROOT: directory },
    timeout: 120000,
  });
  const page = await app.firstWindow();
  await expect(page.getByLabel('登录密码', { exact: true })).toBeVisible({ timeout: 60000 });
  assert.equal(new URL(page.url()).origin, origin);
  const exited = once(app.process(), 'exit');
  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu()
      .items.find((item) => item.label === '工作台')
      .submenu.items.find((item) => item.label === '退出')
      .click();
  });
  await Promise.race([
    exited,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Attached window did not close')), 20000),
    ),
  ]);
  appClosed = true;
  assert.equal(cmd.exitCode, null);
  assert.deepEqual(await control('health'), before);
  await writeFile(
    '.runtime/desktop-work/attach-verification.json',
    JSON.stringify(
      {
        matchingWorkspaceAttached: true,
        loginStillRequired: true,
        desktopClosed: true,
        externalCmdStillRunning: true,
        domainRevisionAndPrivateFingerprintsUnchanged: true,
      },
      null,
      2,
    ),
  );
  console.log('Desktop attach verified; closing the window did not stop the external CMD service.');
} finally {
  if (app && !appClosed) await app.close().catch(() => {});
  if (cmd.exitCode === null) {
    const exited = once(cmd, 'exit');
    await control('shutdown').catch(() => {});
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 15000))]);
  }
  log.end();
}
