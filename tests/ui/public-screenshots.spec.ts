import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createExampleWorkspace } from '../../shared/example';
import { BRAND_ZH } from '../../shared/branding';

test('capture public interface screenshots using only the built-in fictional example', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const envelope = await (await request.get('/api/workspace')).json();
  expect(
    (
      await request.put('/api/workspace', {
        data: { data: createExampleWorkspace(), revision: envelope.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await mkdir('docs/screenshots', { recursive: true });
  await page.setViewportSize({ width: 1680, height: 1040 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '创作仪表盘', exact: true })).toBeVisible();
  await expect(page.locator('.brand strong')).toContainText(BRAND_ZH);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({ path: 'docs/screenshots/dashboard.png', animations: 'disabled' });
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(page.getByRole('button', { name: '年均气温', exact: true })).toBeEnabled({
    timeout: 90000,
  });
  await expect(page.getByText('正在生成', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '隐藏右侧工具栏', exact: true }).click();
  await page.getByRole('button', { name: '收起左侧导航', exact: true }).click();
  await page.locator('.atlas-stage-shell').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/map-workshop.png', animations: 'disabled' });
});
