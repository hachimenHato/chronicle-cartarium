import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';
import { createEditorData, createMapObject } from '../../src/lib/cartography';

async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}
async function openAtlas(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
}
async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('[data-map-viewport]').evaluate(
    (element, p) => {
      const point = new DOMPoint(p.x, p.y).matrixTransform(
        (element as SVGGElement).getScreenCTM()!,
      );
      return { x: point.x, y: point.y };
    },
    { x, y },
  );
}
async function commitNumber(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press('Enter');
}
async function fixturePng(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 450;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ebe0c3';
    ctx.fillRect(0, 0, 450, 300);
    ctx.fillStyle = '#a5b591';
    ctx.beginPath();
    ctx.ellipse(225, 155, 170, 115, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#68553d';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.moveTo(100 + i * 33, 180 - i * 9);
      ctx.lineTo(118 + i * 33, 140 - i * 7);
      ctx.lineTo(140 + i * 33, 180 - i * 9);
      ctx.stroke();
    }
    ctx.fillStyle = '#68553d';
    ctx.font = '20px Georgia';
    ctx.fillText('Northern Marches', 28, 35);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: '北境底图.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
}

test.beforeEach(async ({ request }) => {
  const current = await workspace(request),
    data = createSeed();
  data.maps[0] = {
    ...data.maps[0],
    seed: 0,
    pins: [],
    strokes: [],
    editor: {
      ...createEditorData(),
      mode: 'detail',
      baseVisible: false,
      objects: [
        createMapObject(
          'symbol',
          { x: 400, y: 300 },
          { id: 'ui_castle', symbol: 'castle', name: '安全拖动城堡', size: 64 },
        ),
      ],
    },
  };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
});

test('sea engraving and the legend reflect the displayed map and hide with their layers', async ({
  page,
  request,
}) => {
  const current = await workspace(request),
    data = createSeed();
  data.maps[0].seed = 317;
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
  await openAtlas(page);
  await expect(page.locator('[data-sea-texture="engraved"]')).toHaveCount(1);
  await page.locator('.atlas-map-legend summary').click();
  await expect(page.locator('[data-legend-id="river"]')).toBeVisible();
  await expect(page.locator('[data-legend-id="mountain"]')).toBeVisible();
  await page.screenshot({ path: '.runtime/beta-sea-parchment.png' });
  await page.getByRole('button', { name: '显示地图图层' }).click();
  await page.getByLabel('地形底图', { exact: true }).uncheck();
  await expect(page.locator('[data-legend-id="river"]')).toHaveCount(0);
  await expect(page.locator('[data-sea-texture="engraved"]')).toHaveCount(0);
  await page.screenshot({ path: '.runtime/beta-legend-layers.png' });
});

test('icon navigation persists, pan is safe by default, inspector and fullscreen preserve workspace', async ({
  page,
  request,
}) => {
  let before = await workspace(request);
  const location = before.data.entities.find((entity) => entity.name === '雾港')!;
  before.data.maps[0].pins = [
    {
      id: 'fullscreen_preview_pin',
      label: '全屏词条',
      kind: 'note',
      x: 700,
      y: 400,
      description: '验证全屏关联摘要',
      entityId: location.id,
    },
  ];
  expect(
    (
      await request.put('/api/workspace', {
        data: { data: before.data, revision: before.revision },
      })
    ).ok(),
  ).toBeTruthy();
  before = await workspace(request);
  await openAtlas(page);
  const toolbar = page.getByRole('toolbar', { name: '地图绘制工具' });
  await expect(toolbar.getByRole('button').nth(0)).toHaveAttribute('aria-label', '平移地图');
  await expect(toolbar.getByRole('button').nth(1)).toHaveAttribute('aria-label', '选择 / 移动标记');
  await expect(page.getByRole('button', { name: '平移地图', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const point = await screenPoint(page, 400, 300);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(point.x + 70, point.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-map-viewport]')).not.toHaveAttribute(
    'transform',
    'translate(0 0) scale(1)',
  );
  expect(await workspace(request)).toEqual(before);
  await page.getByRole('button', { name: '收起左侧导航' }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '76px');
  await expect(page.locator('.nav-item span').first()).toBeHidden();
  await expect(page.getByRole('button', { name: '地图工坊', exact: true })).toHaveAttribute(
    'title',
    '地图工坊',
  );
  await page.getByRole('button', { name: '隐藏右侧工具栏' }).click();
  await expect(page.locator('.atlas-inspector')).toBeHidden();
  await page.getByRole('button', { name: '地图全屏', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.classList.contains('atlas-stage-shell')),
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: '退出地图全屏' })).toBeVisible();
  await expect(toolbar).toBeHidden();
  await expect(page.locator('.atlas-zoom')).toBeHidden();
  expect(
    await page.locator('.atlas-topbar').evaluate((el) => document.fullscreenElement?.contains(el)),
  ).toBe(false);
  const bounds = await page.locator('.atlas-stage-shell').boundingBox();
  expect(bounds!.width).toBeGreaterThan(1400);
  await page.getByRole('button', { name: '全屏词条，笔记', exact: true }).locator('circle').hover();
  const summary = page.getByRole('dialog', { name: '雾港词条摘要', exact: true });
  await expect(summary).toBeVisible();
  await expect(summary).toHaveAttribute('data-locked', 'true');
  await summary.getByRole('button', { name: '伊莱娅·灰羽', exact: true }).hover();
  const nested = page.getByRole('dialog', { name: '伊莱娅·灰羽词条摘要', exact: true });
  await expect(nested).toBeVisible();
  await expect(nested).toHaveAttribute('data-locked', 'true');
  await expect(
    page.locator('.atlas-stage-shell:fullscreen [data-entity-tooltip-root]'),
  ).toHaveCount(2);
  await page.screenshot({ path: '.runtime/map-fullscreen-hidden-tools.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-entity-tooltip-root]')).toHaveCount(0);
  await page.getByRole('button', { name: '退出地图全屏' }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await page.getByRole('button', { name: '显示右侧工具栏' }).click();
  await page.screenshot({ path: '.runtime/map-collapsed-sidebar.png' });
  await page.reload();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '76px');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.getByRole('button', { name: '平移地图', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(await workspace(request)).toEqual(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开菜单' }).click();
  await expect(page.getByRole('button', { name: '地图工坊', exact: true })).toBeVisible();
  await expect(page.locator('.nav-item span').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: '.runtime/map-navigation-mobile.png' });
});

test('real worker generation displays only a centered temporary progress overlay and faint saddle lines', async ({
  page,
  request,
}) => {
  test.setTimeout(65000);
  const current = await workspace(request),
    data = current.data;
  data.maps[0].editor!.objects = [];
  data.maps[0].editor!.generation = {
    version: 2,
    detail: 'standard',
    linework: 'organic',
    seed: 392,
    climate: 'temperate',
    settlements: 4,
    rivers: true,
    routes: true,
    elevation: { version: 1, preset: 'highlands', seed: 392, relief: 1, seaLevel: 0, strokes: [] },
  };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
  await page.route('**/terrain.worker-*.js', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 2200));
    await route.fulfill({ response });
  });
  await openAtlas(page);
  const overlay = page.locator('.atlas-generation-overlay');
  await expect(overlay).toBeVisible();
  const stage = await page.locator('.atlas-stage-shell').boundingBox(),
    card = await overlay.locator('div').boundingBox();
  expect(Math.abs(card!.x + card!.width / 2 - (stage!.x + stage!.width / 2))).toBeLessThan(3);
  expect(Math.abs(card!.y + card!.height / 2 - (stage!.y + stage!.height / 2))).toBeLessThan(3);
  await expect(page.locator('.atlas-generator-status')).toHaveCount(0);
  await page.screenshot({ path: '.runtime/map-centered-generation.png' });
  await expect(page.locator('.atlas-canvas [data-terrain-composite]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
    { timeout: 45000 },
  );
  await expect(overlay).toHaveCount(0);
  const saddles = page.locator('.atlas-canvas [data-relief-part="连绵鞍部"]');
  expect(await saddles.count()).toBeGreaterThan(0);
  expect(
    await saddles.evaluateAll((nodes) =>
      nodes.every(
        (n) => n.getAttribute('fill') === 'none' && Number(n.getAttribute('opacity')) <= 0.12,
      ),
    ),
  ).toBe(true);
  expect(
    await page.locator('.atlas-canvas [data-relief-part="山体遮挡底色"]').count(),
  ).toBeGreaterThan(0);
  await page.screenshot({ path: '.runtime/map-faint-saddles.png' });
  const saved = (await workspace(request)).data;
  // Accepted worker output is now a persisted cache; authored content must still
  // be exactly the input fixture and the progress overlay must stay temporary.
  const generated = saved.maps[0].editor?.generated;
  expect(generated?.objects.length).toBeGreaterThan(0);
  const authored = structuredClone(saved);
  delete authored.maps[0].editor?.generated;
  delete authored.maps[0].editor?.military;
  expect(authored).toEqual(data);
});

test('categorized medieval and fantasy symbols can be searched, placed and restored', async ({
  page,
  request,
}) => {
  await openAtlas(page);
  const library = page
    .locator('details.studio-library')
    .filter({ has: page.locator('summary', { hasText: '组件库' }) });
  await library.locator('summary').click();
  await expect(library.locator('.studio-symbols button')).toHaveCount(66);
  await library.getByRole('button', { name: '魔法奇迹', exact: true }).click();
  await expect(library.locator('.studio-symbols button')).toHaveCount(5);
  await page.screenshot({ path: '.runtime/map-fantasy-components.png' });
  await page.getByRole('button', { name: '放置传送门', exact: true }).click();
  let p = await screenPoint(page, 600, 350);
  await page.mouse.click(p.x, p.y);
  await library.getByRole('button', { name: '全部', exact: true }).click();
  await page.getByLabel('搜索地图组件').fill('酒馆');
  await expect(library.locator('.studio-symbols button')).toHaveCount(1);
  await page.getByRole('button', { name: '放置酒馆', exact: true }).click();
  p = await screenPoint(page, 650, 440);
  await page.mouse.click(p.x, p.y);
  await page.getByLabel('搜索地图组件').fill('不存在的建筑');
  await expect(library.getByText('没有找到组件，试试其他关键词或分类。')).toBeVisible();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor!.objects.map((o) => o.symbol))
    .toEqual(['castle', 'portal', 'tavern']);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('.atlas-canvas [data-map-object]')).toHaveCount(3);
  expect(await page.locator('.atlas-canvas').evaluate((el) => el.innerHTML.includes('NaN'))).toBe(
    false,
  );
});

test('raster maps import, overlay, resize, undo, persist and export self-contained media; errors keep content', async ({
  page,
  request,
}) => {
  test.setTimeout(65000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const before = (await workspace(request)).data.maps;
  await openAtlas(page);
  const png = await fixturePng(page);
  await page.getByRole('button', { name: '导入地图图片', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入地图图片' });
  await dialog.getByLabel('地图图片', { exact: true }).setInputFiles(png);
  await dialog.getByLabel('图片地图名称').fill('   ');
  await dialog.getByRole('button', { name: '导入图片', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('请填写图片地图名称。');
  expect((await workspace(request)).data.maps).toEqual(before);
  await dialog.getByLabel('图片地图名称').fill('北境底图');
  await dialog.getByRole('button', { name: '导入图片', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () => (await workspace(request)).data.maps.length)
    .toBe(before.length + 1);
  const created = (await workspace(request)).data.maps.at(-1)!;
  expect(created.width).toBe(450);
  expect(created.height).toBe(300);
  expect(created.editor!.objects[0]).toMatchObject({
    kind: 'image',
    locked: true,
    layer: 'base',
    points: [
      { x: 0, y: 0 },
      { x: 450, y: 300 },
    ],
  });
  expect((await workspace(request)).data.maps.slice(0, before.length)).toEqual(before);
  await expect(page.locator('.atlas-canvas image')).toHaveCount(1);
  await expect(page.locator('.atlas-canvas image')).toHaveAttribute('href', /^\/uploads\/.+\.png$/);
  const list = page
    .locator('details.studio-library')
    .filter({ has: page.locator('summary', { hasText: '图层与对象' }) });
  await list.locator('summary').click();
  await list.getByRole('button', { name: '组件 · 北境底图' }).click();
  await expect(page.getByLabel('图片宽度', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '复制选中组件' }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps.at(-1)!.editor!.objects.length)
    .toBe(2);
  expect((await workspace(request)).data.maps.at(-1)!.editor!.objects[1].points).toEqual([
    { x: 0, y: 0 },
    { x: 450, y: 300 },
  ]);
  await page.getByRole('button', { name: '撤销地图编辑' }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps.at(-1)!.editor!.objects.length)
    .toBe(1);
  await list.getByRole('button', { name: '组件 · 北境底图', exact: true }).click();
  await page.getByRole('button', { name: '锁定选中组件' }).click();
  await commitNumber(page, '图片宽度', '360');
  await expect(page.getByLabel('图片高度', { exact: true })).toHaveValue('240');
  await commitNumber(page, '不透明度', '0.65');
  await expect
    .poll(async () => (await workspace(request)).data.maps.at(-1)!.editor!.objects[0].opacity)
    .toBe(0.65);
  await page.getByRole('button', { name: '导入地图图片', exact: true }).click();
  await dialog.getByLabel('地图图片', { exact: true }).setInputFiles(png);
  await dialog.getByLabel('导入方式').selectOption('overlay');
  await dialog.getByLabel('图片地图名称').fill('参考纹理');
  await dialog.getByRole('button', { name: '导入图片', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.atlas-canvas image')).toHaveCount(2);
  await expect
    .poll(async () => (await workspace(request)).data.maps.at(-1)!.editor!.objects.length)
    .toBe(2);
  await page.getByRole('button', { name: '撤销地图编辑' }).click();
  await expect(page.locator('.atlas-canvas image')).toHaveCount(1);
  await page.getByRole('button', { name: '重做地图编辑' }).click();
  await expect(page.locator('.atlas-canvas image')).toHaveCount(2);
  await expect
    .poll(async () => (await workspace(request)).data.maps.at(-1)!.editor!.objects.length)
    .toBe(2);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByLabel('切换地图', { exact: true }).selectOption(created.id);
  await expect(page.locator('.atlas-canvas image')).toHaveCount(2);
  await page.screenshot({ path: '.runtime/map-imported-images.png' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const file = await download;
  await file.saveAs('.runtime/map-image-self-contained.svg');
  const svg = await readFile('.runtime/map-image-self-contained.svg', 'utf8');
  expect((svg.match(/href="data:image\/png;base64,/g) || []).length).toBe(2);
  expect(svg).not.toContain('href="/uploads/');
  expect(svg).not.toContain('data-editor-overlay');
  const standalone = await page.context().newPage();
  await standalone.route('**/standalone-image.svg', (route) =>
    route.fulfill({ contentType: 'image/svg+xml', body: svg }),
  );
  await standalone.goto('http://127.0.0.1:3311/standalone-image.svg');
  await expect(standalone.locator('parsererror')).toHaveCount(0);
  await expect(standalone.locator('svg image')).toHaveCount(2);
  await expect(standalone.locator('svg image').first()).toHaveAttribute(
    'href',
    /^data:image\/png;base64,/,
  );
  await standalone.screenshot({ path: '.runtime/map-image-self-contained.png' });
  await standalone.close();
  await page.route('**/uploads/*.png', (route) => route.fulfill({ status: 404, body: 'missing' }));
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  await expect(page.locator('.studio-notice')).toContainText(
    '地图图片无法读取，请检查 uploads 目录后重试。',
  );
  await page.getByRole('button', { name: '隐藏右侧工具栏' }).click();
  await expect(page.locator('.atlas-floating-notice')).toContainText('地图图片无法读取');
  await page.getByRole('button', { name: '显示右侧工具栏' }).click();
  await page.unroute('**/uploads/*.png');
  const saved = (await workspace(request)).data;
  await page.getByRole('button', { name: '导入地图图片', exact: true }).click();
  await dialog.getByLabel('地图图片', { exact: true }).setInputFiles({
    name: '不支持.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await dialog.getByRole('button', { name: '导入图片', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('请选择 PNG、JPG 或 WebP');
  expect((await workspace(request)).data).toEqual(saved);
  await dialog.getByLabel('地图图片', { exact: true }).setInputFiles(png);
  await page.route('**/api/uploads', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '测试上传暂不可用' }),
    }),
  );
  await dialog.getByRole('button', { name: '导入图片', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('测试上传暂不可用');
  expect((await workspace(request)).data).toEqual(saved);
  expect(errors).toEqual([]);
});
