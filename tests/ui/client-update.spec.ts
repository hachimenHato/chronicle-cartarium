import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

test('new builds prompt without reloading and refresh stays blocked for drafts and pending saves', async ({
  page,
  request,
}) => {
  const current = (await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope;
  expect(current.mode).toBe('demo');
  const data = createSeed();
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await expect(page.locator('meta[name="worldloom-build"]')).toHaveAttribute('content', /.+/);
  await expect(page.locator('.client-update-banner')).toHaveCount(0);
  await page.route('**/app-version.json', (route) =>
    route.fulfill({ json: { buildId: 'new-release-for-test' } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  const banner = page.locator('.client-update-banner');
  await expect(banner).toBeVisible();
  const refresh = banner.getByRole('button', { name: '刷新使用新版', exact: true });
  await expect(refresh).toBeEnabled();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^世界知识库/ })
    .click();
  await page.locator('.entity-card').first().getByRole('button', { name: /^打开/ }).click();
  await page.getByRole('button', { name: '编辑条目', exact: true }).click();
  await page.getByPlaceholder('用于搜索结果和悬浮预览').fill('版本刷新时保留的草稿');
  await expect(refresh).toBeDisabled();
  let release: (() => void) | undefined;
  const saved = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'PUT') await saved;
    await route.continue();
  });
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.locator('.save-status')).toHaveText('正在保存…');
  await expect(refresh).toBeDisabled();
  release!();
  await expect(page.locator('.save-status')).toHaveText('所有更改已保存');
  await expect(refresh).toBeEnabled();
  const read = (await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope;
  expect(read.data.entities.some((e) => e.summary === '版本刷新时保留的草稿')).toBe(true);
  await page.unroute('**/app-version.json');
  await refresh.click();
  await expect(page.getByRole('heading', { name: '创作仪表盘', level: 1 })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '切换世界' })).toHaveValue(data.worlds[0].id);
  await expect(banner).toHaveCount(0);
});
