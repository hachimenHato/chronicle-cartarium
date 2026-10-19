import { test, expect, type APIRequestContext } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';
import type { MapRegion, SketchGenerationV2 } from '../../shared/cartography';
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII=',
  'base64',
);
async function envelope(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<WorkspaceEnvelope>;
}
async function reset(request: APIRequestContext) {
  const old = await envelope(request);
  const data = createSeed();
  const response = await request.put('/api/workspace', { data: { data, revision: old.revision } });
  expect(response.ok()).toBeTruthy();
  return data;
}

test('custom types and non-character covers persist, dashboard uses concrete counts and midnight details remain readable', async ({
  page,
  request,
}) => {
  await reset(request);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '设定查漏' })).toBeVisible();
  await expect(page.locator('.coverage-list progress')).toHaveCount(0);
  await expect(page.locator('.coverage-check small').first()).toContainText(/草稿|尚未建立/);
  await page.getByRole('button', { name: '世界知识库', exact: true }).click();
  await page.getByRole('button', { name: '设定类型', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '设定类型管理' });
  await dialog.getByRole('button', { name: '添加设定类型' }).click();
  await dialog.getByRole('textbox', { name: /^类型名称\s*$/ }).fill('怪异传闻');
  await dialog.getByRole('textbox', { name: '类型说明 怪异传闻' }).fill('探索可追踪的奇妙现象');
  await dialog.getByRole('button', { name: '应用类型列表' }).click();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  await page
    .locator('.main-content')
    .getByRole('button', { name: '新建设定', exact: true })
    .click();
  await page.getByRole('button', { name: /怪异传闻/ }).click();
  await page.getByLabel('条目名称').fill('回声石碑');
  await page
    .locator('.upload-btn input[type=file]')
    .setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('.portrait-box img')).toBeVisible();
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const stored = (await envelope(request)).data.entities.find((e) => e.name === '回声石碑')!;
  expect(stored.type).toMatch(/^custom_/);
  expect(stored.cover).toMatch(/^\/uploads\//);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'midnight';
  });
  await expect(page.locator('.article-sheet')).toHaveCSS('background-color', 'rgb(38, 49, 64)');
  await expect(page.locator('.article-sheet h1')).toHaveCSS('color', 'rgb(237, 243, 245)');
  await expect(page.locator('.page-topline .btn').first()).toHaveCSS(
    'background-color',
    'rgb(32, 42, 55)',
  );
  await expect(page.locator('.nav-item.active')).toHaveCSS('background-color', 'rgb(52, 75, 71)');
  await page.getByRole('button', { name: '编辑条目', exact: true }).hover();
  await expect(page.getByRole('button', { name: '编辑条目', exact: true })).toHaveCSS(
    'background-color',
    'rgb(52, 75, 71)',
  );
  await expect(page.getByRole('button', { name: '编辑条目', exact: true })).toHaveCSS(
    'color',
    'rgb(237, 243, 245)',
  );
  await page.screenshot({ path: '.runtime/creation-cover-midnight.png' });
  await page.reload();
  await page.getByRole('button', { name: '世界知识库', exact: true }).click();
  await page
    .locator('.entity-card')
    .filter({ hasText: '回声石碑' })
    .getByRole('button', { name: '打开回声石碑' })
    .click();
  await expect(page.locator('.portrait-box img')).toHaveAttribute('src', stored.cover!);
});

test('clue layouts expand, dragging keeps the viewport and visible nodes stable, and positions survive reload', async ({
  page,
  request,
}) => {
  await reset(request);
  await page.goto('/');
  await page.getByRole('button', { name: '人物关系', exact: true }).click();
  const nodes = page.locator('.relation-graph .react-flow__node');
  await expect(nodes.first()).toBeVisible();
  await page.waitForTimeout(400);
  const first = nodes.first();
  const id = await first.getAttribute('data-id');
  const before = await first.boundingBox();
  const view = page.locator('.relation-graph .react-flow__viewport');
  const transform = await view.getAttribute('style');
  await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(
      before!.x + before!.width / 2 + i * 4,
      before!.y + before!.height / 2 + i * 2,
    );
    await expect(view).toHaveAttribute('style', transform!);
    expect(
      await nodes.evaluateAll((elements) =>
        elements.every(
          (e) => getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0',
        ),
      ),
    ).toBeTruthy();
  }
  await page.mouse.up();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const position = (await envelope(request)).data.entities.find((e) => e.id === id)!.graphPosition;
  expect(position).toBeDefined();
  await page.screenshot({ path: '.runtime/creation-relationship-clues.png' });
  await page.reload();
  await page.getByRole('button', { name: '人物关系', exact: true }).click();
  expect((await envelope(request)).data.entities.find((e) => e.id === id)!.graphPosition).toEqual(
    position,
  );
  await page.getByRole('button', { name: '剧情编织', exact: true }).click();
  await page.getByRole('button', { name: '整理线索布局', exact: true }).click();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const plot = (await envelope(request)).data.plots[0];
  expect(plot.layoutVersion).toBe(1);
  for (let i = 0; i < plot.nodes.length; i++)
    for (let j = i + 1; j < plot.nodes.length; j++)
      expect(
        Math.abs(plot.nodes[i].x - plot.nodes[j].x) >= 260 ||
          Math.abs(plot.nodes[i].y - plot.nodes[j].y) >= 192,
      ).toBeTruthy();
  await page.screenshot({ path: '.runtime/creation-plot-clues.png' });
});

test('all five settlement limits, editable names and location controls persist through regeneration and reload', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const old = await envelope(request),
    data = createSeed();
  const map = data.maps[0];
  map.kind = 'region';
  map.scaleKm = 400;
  const grass: MapRegion = {
    id: 'grass',
    name: '平原',
    biome: 'grass',
    geometry: 'polygon',
    points: [
      { x: 60, y: 50 },
      { x: 940, y: 50 },
      { x: 940, y: 590 },
      { x: 60, y: 590 },
    ],
    width: 80,
    seed: 37,
    density: 0.6,
    roughness: 0.15,
    visible: true,
    locked: false,
  };
  const recipe: SketchGenerationV2 = {
    version: 2,
    seed: 618,
    climate: 'temperate',
    detail: 'standard',
    settlements: 5,
    rivers: false,
    routes: true,
    linework: 'organic',
    settlementCounts: { village: 1, town: 1, city: 1, castle: 1, camp: 1 },
  };
  map.editor = {
    version: 1,
    mode: 'sculpt',
    baseVisible: false,
    regions: [grass],
    objects: [],
    generation: recipe,
  };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: old.revision } })).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '地名与地点', exact: true }).click();
  await page
    .locator('.map-places-filters')
    .getByRole('button', { name: '聚落', exact: true })
    .click();
  await page.locator('.map-places-count-panel summary').click();
  await expect(page.locator('.map-place-card')).toHaveCount(5, { timeout: 30000 });
  for (const type of ['村落', '小镇', '城市', '城堡', '营地'])
    await expect(page.getByLabel(`${type}生成数量`, { exact: true })).toHaveValue('1');
  const city = page.getByLabel('城市名称 city_0', { exact: true });
  await city.fill('月樱城');
  await city.blur();
  await expect
    .poll(
      async () =>
        (await envelope(request)).data.maps[0].editor!.generation!.version === 2 &&
        ((await envelope(request)).data.maps[0].editor!.generation as SketchGenerationV2)
          .settlementNames?.city_0,
    )
    .toBe('月樱城');
  await expect(page.locator('.atlas-canvas text').filter({ hasText: '月樱城' })).toBeVisible({
    timeout: 30000,
  });
  await page.getByLabel('村落生成数量').fill('2');
  await page.getByLabel('村落生成数量').blur();
  await expect(page.locator('.map-place-card')).toHaveCount(6, { timeout: 30000 });
  await expect(city).toHaveValue('月樱城');
  await page.screenshot({ path: '.runtime/creation-settlements.png' });
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '地名与地点', exact: true }).click();
  await page
    .locator('.map-places-filters')
    .getByRole('button', { name: '聚落', exact: true })
    .click();
  await page.locator('.map-places-count-panel summary').click();
  await expect(city).toHaveValue('月樱城', { timeout: 30000 });
  await expect(page.getByLabel('村落生成数量')).toHaveValue('2');
  await page
    .locator('.map-place-card')
    .filter({ has: city })
    .getByRole('button', { name: '定位' })
    .click();
  await expect(page.locator('.atlas-zoom span')).toHaveText('160%');
});

test('replayable spotlight tutorial walks through tools and remains usable on a phone', async ({
  page,
  request,
}) => {
  await reset(request);
  await page.goto('/');
  await page.getByRole('button', { name: '工具教学', exact: true }).click();
  const tour = page.getByRole('dialog', { name: '工具教学' });
  await expect(tour).toBeVisible();
  for (let i = 0; i < 5; i++)
    await tour.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(tour.getByRole('heading', { name: '查找与筛选' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(tour.getByRole('button', { name: '下一步', exact: true })).toBeInViewport();
  await page.screenshot({ path: '.runtime/creation-tour-mobile.png' });
  await tour.getByRole('button', { name: '结束工具教学' }).click();
  await expect(tour).toHaveCount(0);
});
