import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { list } from 'tar';

test('owner creates a complete verified backup with one button, sees deployment guidance and explicitly downloads private records', async ({
  page,
  request,
}) => {
  test.setTimeout(60000);
  expect(new URL((await request.get('/api/status')).url()).port).toBe('3311');
  const install = await page.request.post('/__backups/api/install', {
    data: {
      storage: 'sqlite',
      title: '备份体验验证',
      theme: 'midnight',
      access: 'local',
      username: 'gm',
      password: 'ui-backup-password-2026',
      fillExample: true,
    },
  });
  expect(install.status()).toBe(201);
  await page.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    expect(url.port).toBe('3311');
    url.pathname = '/__backups' + url.pathname;
    return route.continue({ url: url.toString() });
  });
  await page.goto('/');
  const tutorial = page.getByRole('button', { name: '结束工具教学', exact: true });
  await expect(tutorial).toBeVisible();
  await tutorial.click();
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  const panel = page.locator('[data-full-backup-panel]');
  await expect(
    panel.getByRole('button', { name: '创建并验证完整备份', exact: true }),
  ).toBeEnabled();
  const before = await (await page.request.get('/__backups/api/workspace')).json();
  expect(before.mode).toBe('demo');
  await panel.getByRole('button', { name: '创建并验证完整备份', exact: true }).click();
  await expect(
    panel.getByText('完整备份与恢复验证成功，原内容保留。', { exact: true }),
  ).toBeVisible();
  await expect(panel.locator('.backup-row')).toHaveCount(1);
  expect((await (await page.request.get('/__backups/api/workspace')).json()).revision).toBe(
    before.revision,
  );
  await expect(panel.locator('[data-program-update-panel]')).toContainText('start.cmd');
  await page.screenshot({ path: '.runtime/update-backup-panel-midnight.png' });
  await panel.getByRole('button', { name: '下载', exact: true }).click();
  await panel.getByLabel('主管理员当前密码').fill('wrong-password');
  await panel.getByRole('button', { name: '确认下载私有备份', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('当前密码');
  await panel.getByLabel('主管理员当前密码').fill('ui-backup-password-2026');
  const downloading = page.waitForEvent('download');
  await panel.getByRole('button', { name: '确认下载私有备份', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.ccbackup$/);
  const filename = '.runtime/ui-private-backup.wlbackup';
  await download.saveAs(filename);
  const entries: string[] = [];
  await list({
    file: filename,
    onReadEntry: (entry) => {
      entries.push(entry.path);
    },
  });
  expect(entries).toContain('data/installation.json');
  expect(entries).toContain('data/users.json');
  expect(entries).toContain('database.json');
  expect(entries).toContain('manifest.json');
  expect((await readFile(filename)).length).toBeGreaterThan(1000);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    panel.getByRole('button', { name: '创建并验证完整备份', exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: '.runtime/update-backup-panel-mobile.png' });
});
