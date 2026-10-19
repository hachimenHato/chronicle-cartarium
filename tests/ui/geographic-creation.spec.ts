import { test, expect, type APIRequestContext } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

// All operations stay in Playwright's new DemoStore on 3311.
async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}
test.beforeEach(async ({ request }) => {
  const current = await workspace(request);
  const response = await request.put('/api/workspace', {
    data: { data: createSeed(), revision: current.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});

test('creation explicitly selects map source and preserves seed, type and physical dimensions', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '绘制新的疆域' });
  await expect(dialog.getByRole('radio', { name: '完全随机', exact: true })).toBeChecked();
  await expect(dialog.getByRole('radio', { name: '按照色块生成', exact: true })).not.toBeChecked();
  await dialog.getByLabel('地图尺度').selectOption('town');
  await dialog.getByLabel('地图名称').fill('种子城镇');
  await dialog.getByLabel('创建种子码', { exact: true }).fill('812358');
  await dialog.getByLabel('画布宽度').fill('1400');
  await dialog.getByLabel('画布高度').fill('900');
  await dialog.getByLabel('横向地理范围（km）').fill('7.5');
  await dialog.getByRole('button', { name: '创建地图', exact: true }).click();
  await expect
    .poll(
      async () => (await workspace(request)).data.maps.find((map) => map.name === '种子城镇')?.seed,
    )
    .toBe(812358);
  const map = (await workspace(request)).data.maps.find((item) => item.name === '种子城镇')!;
  expect(map).toMatchObject({ kind: 'town', width: 1400, height: 900, scaleKm: 7.5 });
  expect(map.editor?.generation).toMatchObject({
    version: 2,
    seed: 812358,
    geography: { source: 'random' },
    elevation: { seed: 812358 },
  });
});

test('image colors become editable terrain regions and empty sketch creation remains available', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '绘制新的疆域' });
  await dialog.getByRole('radio', { name: '按照色块生成', exact: true }).check();
  await expect(dialog.getByRole('radio', { name: '完全随机', exact: true })).not.toBeChecked();
  await expect(dialog.locator('.map-color-entry')).toHaveCount(14);
  await expect(dialog.locator('.map-color-palette')).toContainText('#B8D6DC');
  await expect(dialog.locator('.map-color-palette')).toContainText('RGB 184, 214, 220');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 80;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b8d6dc';
    context.fillRect(0, 0, 120, 80);
    context.fillStyle = '#d3dcb0';
    context.fillRect(20, 15, 80, 50);
    context.fillStyle = '#a7c19a';
    context.fillRect(45, 25, 25, 25);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await dialog.getByLabel('导入色块图片', { exact: true }).setInputFiles({
    name: '海陆森林.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await expect(dialog.getByRole('img', { name: '解析后的地形色块' })).toBeVisible();
  await expect(dialog.locator('.map-color-result')).toContainText('3 个可编辑色块');
  await dialog.locator('.map-color-palette').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/geographic-creation-palette.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileDialog = await dialog.boundingBox();
  expect(mobileDialog!.x).toBeGreaterThanOrEqual(0);
  expect(mobileDialog!.x + mobileDialog!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '.runtime/geographic-creation-mobile.png' });
  await page.setViewportSize({ width: 1560, height: 1100 });
  await dialog.getByLabel('地图名称').fill('导入色块试绘');
  await dialog.getByLabel('创建种子码', { exact: true }).fill('8421');
  await dialog.getByRole('button', { name: '创建地图', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await workspace(request)).data.maps.find((map) => map.name === '导入色块试绘')?.editor
          ?.regions.length,
    )
    .toBe(3);
  const imported = (await workspace(request)).data.maps.find((map) => map.name === '导入色块试绘')!;
  expect(imported.editor?.generation).toMatchObject({
    seed: 8421,
    geography: { source: 'sketch' },
    elevation: { preset: 'sketch' },
  });
  expect(imported.editor?.regions.map((region) => region.biome)).toEqual([
    'water',
    'grass',
    'forest',
  ]);
  expect(imported.editor?.objects).toHaveLength(0);
  await expect(page.getByRole('button', { name: '色块草稿', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await workspace(request)).data.maps.find((map) => map.id === imported.id)?.editor
          ?.generated?.geography?.cells.length ?? 0,
      { timeout: 60000 },
    )
    .toBeGreaterThan(50);
  const generated = (await workspace(request)).data.maps.find((map) => map.id === imported.id)!;
  expect(generated.editor?.regions).toEqual(imported.editor?.regions);
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/geographic-import-generated.png' });
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  await dialog.getByRole('radio', { name: '按照色块生成', exact: true }).check();
  await dialog.getByLabel('地图名称').fill('空白色块试绘');
  await dialog.getByRole('button', { name: '创建地图', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await workspace(request)).data.maps.find((map) => map.name === '空白色块试绘')?.editor
          ?.regions.length,
      { timeout: 30000 },
    )
    .toBe(0);
  await expect(page.getByRole('button', { name: '色块草稿', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
