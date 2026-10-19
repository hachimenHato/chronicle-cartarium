import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('new product name appears throughout the workbench and JSON exports; legacy JSON restores and sidebar preferences survive', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await expect(page).toHaveTitle(/编年图志 Chronicle Cartarium/);
  await expect(page.locator('.brand strong')).toContainText('编年图志');
  await expect(page.locator('.brand strong')).toContainText('CHRONICLE CARTARIUM');
  await expect(page.locator('.brand-mark')).toContainText('CC');
  await page.screenshot({ path: '.runtime/rename-brand-home.png' });
  await expect(page.locator('meta[name="chronicle-cartarium-build"]')).toHaveAttribute(
    'content',
    /.+/,
  );
  await page.evaluate(() => {
    localStorage.removeItem('chronicle-cartarium.sidebarCollapsed');
    localStorage.setItem('worldloom.sidebarCollapsed', 'true');
  });
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await page.getByRole('button', { name: '展开左侧导航', exact: true }).click();
  await page.reload();
  await expect(page.locator('.app-shell')).not.toHaveClass(/sidebar-collapsed/);
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出创作 JSON', exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/^编年图志-创作档案-/);
  const filename = '.runtime/rename-ui-creative.json';
  await file.saveAs(filename);
  const creative = JSON.parse(await readFile(filename, 'utf8'));
  expect(creative.format).toBe('chronicle-cartarium');
  creative.format = 'worldloom';
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '从 JSON 备份恢复', exact: true }).click();
  await (
    await choosing
  ).setFiles({
    name: 'legacy.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(creative)),
  });
  await expect(page.getByRole('button', { name: '确认替换并恢复', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '确认替换并恢复', exact: true }).click();
  await expect
    .poll(async () => (await (await page.request.get('/api/workspace')).json()).data)
    .toEqual(creative.data);
  await page.screenshot({ path: '.runtime/rename-brand-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: '.runtime/rename-brand-mobile.png' });
});
