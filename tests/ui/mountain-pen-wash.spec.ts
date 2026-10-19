import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext, type Locator } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const value = (await response.json()) as WorkspaceEnvelope;
  expect(value.mode).toBe('demo');
  return value;
}
const artwork = (nodes: Locator) =>
  nodes.evaluateAll((elements) =>
    elements.map((element) => ({
      part: element.getAttribute('data-relief-part'),
      style: element.getAttribute('data-mountain-style'),
      fill: element.getAttribute('fill'),
      stroke: element.getAttribute('stroke'),
      opacity: element.getAttribute('opacity'),
      width: element.getAttribute('stroke-width'),
      path: element.querySelector('path')?.getAttribute('d'),
    })),
  );

test('pen-and-wash ranges survive preview, freeze, refresh and standalone vector export', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const current = await workspace(request),
    data = createSeed();
  const featured = data.maps[0];
  featured.seed = 0;
  featured.pins = [];
  featured.strokes = [];
  featured.editor = {
    version: 1,
    mode: 'sculpt',
    baseVisible: false,
    regions: [],
    objects: [],
    generation: {
      version: 2,
      detail: 'high',
      linework: 'organic',
      seed: 392,
      climate: 'temperate',
      settlements: 4,
      rivers: true,
      routes: true,
      elevation: {
        version: 1,
        preset: 'highlands',
        seed: 392,
        relief: 1,
        seaLevel: 0,
        strokes: [],
      },
    },
  };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '世界总览', exact: true }).click();
  const overview = page.locator('.map-preview > svg');
  await expect(overview.locator('[data-terrain-composite]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
    { timeout: 45000 },
  );
  const preview = await artwork(overview.locator('[data-relief-part]'));
  expect(preview.filter((o) => o.part === '峰谷轮廓').length).toBeGreaterThan(110);
  expect(preview.filter((o) => o.part === '连绵鞍部').length).toBeGreaterThan(0);
  expect(preview.filter((o) => o.part === '细钢笔排线').length).toBeGreaterThan(30);
  expect(new Set(preview.filter((o) => o.part === '连绵山体').map((o) => o.opacity)).size).toBe(3);
  expect((await workspace(request)).data).toEqual(data);
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  const canvas = page.locator('.atlas-canvas');
  await expect(canvas.locator('[data-terrain-composite]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
    { timeout: 45000 },
  );
  expect(await artwork(canvas.locator('[data-relief-part]'))).toEqual(preview);
  await page.getByRole('button', { name: '山峰样式图鉴 · 128 种', exact: true }).click();
  const gallery = page.getByRole('dialog', { name: '山峰样式图鉴 · 128 种', exact: true });
  await expect(gallery).toBeVisible();
  const catalogIds = new Set<string>(),
    catalogPaths = new Set<string>();
  for (const label of ['高峰', '中峰', '矮山', '极矮山丘']) {
    await gallery.getByRole('button', { name: new RegExp(`^${label}`) }).click();
    const cards = gallery.locator('[data-mountain-card]');
    await expect(cards).toHaveCount(32);
    for (const id of await cards.evaluateAll((elements) =>
      elements.map((e) => e.getAttribute('data-mountain-card')!),
    ))
      catalogIds.add(id);
    for (const path of await cards
      .locator('[data-relief-part="峰谷轮廓"] path')
      .evaluateAll((elements) => elements.map((e) => e.getAttribute('d')!))) {
      expect(path).not.toContain('NaN');
      catalogPaths.add(path);
    }
    if (label === '高峰' || label === '极矮山丘')
      await gallery.screenshot({
        path: `.runtime/mountain-style-gallery-${label === '高峰' ? 'high' : 'very-low'}.png`,
      });
  }
  expect(catalogIds.size).toBe(128);
  expect(catalogPaths.size).toBe(128);
  const originalViewport = page.viewportSize()!;
  await page.setViewportSize({ width: 390, height: 844 });
  await gallery.screenshot({ path: '.runtime/mountain-style-gallery-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.keyboard.press('Escape');
  await expect(gallery).toHaveCount(0);
  await page.setViewportSize(originalViewport);
  expect((await workspace(request)).data).toEqual(data);
  expect(await artwork(canvas.locator('[data-relief-part]'))).toEqual(preview);
  await canvas.screenshot({ path: '.runtime/mountain-pen-wash-live.png', animations: 'disabled' });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  await (await downloading).saveAs('.runtime/mountain-pen-wash-export.svg');
  const svg = await readFile('.runtime/mountain-pen-wash-export.svg', 'utf8');
  expect(svg).not.toContain('NaN');
  expect(svg).not.toContain('data-editor-overlay');
  const standalone = await page.context().newPage();
  await standalone.route('**/pen-wash.svg', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }),
  );
  await standalone.goto('http://127.0.0.1:3311/pen-wash.svg');
  await expect(standalone.locator('parsererror')).toHaveCount(0);
  expect(await artwork(standalone.locator('[data-relief-part]'))).toEqual(preview);
  await standalone.screenshot({
    path: '.runtime/mountain-pen-wash-export.png',
    animations: 'disabled',
  });
  await standalone.close();
  await page.getByRole('button', { name: /精细编辑/ }).click();
  await page.getByRole('button', { name: '将生成图转为可编辑组件', exact: true }).click();
  await page.getByRole('button', { name: '转换并精修', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toBeUndefined();
  const frozen = (await workspace(request)).data;
  expect(frozen.maps[1]).toEqual(data.maps[1]);
  expect(await artwork(canvas.locator('[data-relief-part]'))).toEqual(preview);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  expect(await artwork(page.locator('.atlas-canvas [data-relief-part]'))).toEqual(preview);
  expect((await workspace(request)).data).toEqual(frozen);
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator('.atlas-canvas')
    .screenshot({ path: '.runtime/mountain-pen-wash-mobile.png', animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  expect(errors).toEqual([]);
});
