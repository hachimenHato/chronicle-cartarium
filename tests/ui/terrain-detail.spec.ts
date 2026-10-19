import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import { biomeCatalog, type MapObject } from '../../shared/cartography';
import type { WorkspaceEnvelope } from '../../shared/model';
import { addGeographicFixture } from '../fixtures/geographic';
import { validateWorkspace } from '../../server/validation';
import { generationSignature } from '../../src/lib/generated-map';

// The saved fixture is synthetic and complete. Never use the real app or .env here.
async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}
function artwork(
  id: string,
  name: string,
  kind: MapObject['kind'],
  points: MapObject['points'],
  style: Partial<MapObject> = {},
): MapObject {
  return {
    id,
    name,
    kind,
    points,
    text: '',
    color: 'none',
    stroke: 'none',
    strokeWidth: 0,
    size: 16,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    ...style,
  };
}
function savedTerrainFixture() {
  const data = addGeographicFixture(createSeed()),
    map = data.maps[0],
    editor = map.editor!,
    generated = editor.generated!,
    g = generated.geography!;
  map.name = '地貌图例与省区 · 保存范例';
  map.pins = [];
  map.strokes = [];
  editor.objects = [];
  editor.regions = [];
  editor.military = [];
  const template = g.cells[0],
    landBiomes = biomeCatalog.filter((b) => b.id !== 'water');
  g.cells = Array.from({ length: 16 }, (_, id) => {
    const col = id % 4,
      row = Math.floor(id / 4),
      x = col * 200,
      y = row * 160;
    return {
      ...template,
      id,
      center: { x: x + 100, y: y + 80 },
      polygon: [
        { x, y },
        { x: x + 200, y },
        { x: x + 200, y: y + 160 },
        { x, y: y + 160 },
      ],
      neighbors: [
        col > 0 ? id - 1 : -1,
        col < 3 ? id + 1 : 16,
        row > 0 ? id - 4 : -1,
        row < 3 ? id + 4 : -1,
      ].filter((n) => n >= 0),
      land: true,
      plate: id % 3,
      biome: landBiomes[id % landBiomes.length].id,
      country: 'geo_country_0',
      temperature: -20 + id * 4,
      precipitation: 125 + id * 250,
    };
  });
  g.cells.push({
    ...template,
    id: 16,
    center: { x: 900, y: 320 },
    polygon: [
      { x: 800, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 640 },
      { x: 800, y: 640 },
    ],
    neighbors: [3, 7, 11, 15],
    land: false,
    plate: 2,
    biome: 'water',
    country: undefined,
    elevation: -100,
    temperature: 45,
    precipitation: 6500,
    shelf: true,
  });
  g.divisions = [{ ...g.divisions[0], center: { x: 400, y: 320 } }];
  g.areas = [
    {
      id: 'detail_continent',
      kind: 'continent',
      name: '晴川大陆',
      center: { x: 400, y: 320 },
      cells: g.cells.filter((c) => c.land).map((c) => c.id),
    },
    {
      id: 'detail_west',
      kind: 'province',
      name: '绿岚省',
      center: { x: 200, y: 320 },
      cells: g.cells.filter((c) => c.land && c.id % 4 < 2).map((c) => c.id),
    },
    {
      id: 'detail_east',
      kind: 'district',
      name: '银帆地区',
      center: { x: 600, y: 320 },
      cells: g.cells.filter((c) => c.land && c.id % 4 >= 2).map((c) => c.id),
    },
    { id: 'detail_ocean', kind: 'ocean', name: '银帆海', center: { x: 900, y: 320 }, cells: [16] },
  ];
  g.borders = [];
  for (const c of g.cells.filter((c) => c.land)) {
    const col = c.id % 4,
      row = Math.floor(c.id / 4),
      x = col * 200,
      y = row * 160;
    if (col < 3)
      g.borders.push({
        id: `detail_edge_${c.id}_${c.id + 1}`,
        kind: 'cell',
        cells: [c.id, c.id + 1],
        points: [
          { x: x + 200, y },
          { x: x + 200, y: y + 80 },
          { x: x + 200, y: y + 160 },
        ],
      });
    if (row < 3)
      g.borders.push({
        id: `detail_edge_${c.id}_${c.id + 4}`,
        kind: 'cell',
        cells: [c.id, c.id + 4],
        points: [
          { x, y: y + 160 },
          { x: x + 100, y: y + 160 },
          { x: x + 200, y: y + 160 },
        ],
      });
  }
  for (const port of g.ports) port.cell = Math.floor(port.center.y / 160) * 4 + 3;
  generated.stats = { landCells: 16, rivers: 1, roads: 1, settlements: generated.sites!.length };
  generated.objects = [
    artwork(
      'detail_sea',
      '海面',
      'polygon',
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 640 },
        { x: 0, y: 640 },
      ],
      { color: '#dce1ce' },
    ),
    artwork(
      'detail_land',
      '陆地 · 共享地表',
      'polygon',
      [
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 640 },
        { x: 0, y: 640 },
      ],
      { color: '#d5cea9', stroke: '#a08b68', strokeWidth: 1.2 },
    ),
    artwork(
      'detail_river',
      '晴川河 · 清晰墨线',
      'path',
      [
        { x: 130, y: 50 },
        { x: 210, y: 140 },
        { x: 180, y: 230 },
        { x: 340, y: 340 },
        { x: 540, y: 360 },
        { x: 640, y: 480 },
        { x: 800, y: 510 },
      ],
      { stroke: '#527e87', strokeWidth: 2 },
    ),
    artwork(
      'detail_road',
      '银帆商路 · 清晰墨线',
      'path',
      [
        { x: 80, y: 420 },
        { x: 220, y: 480 },
        { x: 390, y: 440 },
        { x: 490, y: 280 },
        { x: 650, y: 190 },
        { x: 760, y: 140 },
      ],
      { stroke: '#887456', strokeWidth: 1.2 },
    ),
    artwork('detail_note', '地表文字保持清晰', 'text', [{ x: 395, y: 300 }], {
      text: '晴川驿道',
      color: '#473d2c',
      stroke: '#f3e8cc',
      strokeWidth: 1.4,
      size: 17,
    }),
  ];
  const normalized = validateWorkspace(data),
    normalizedMap = normalized.maps[0];
  normalizedMap.editor!.generated!.signature = generationSignature(
    normalizedMap.editor!.regions,
    normalizedMap.width,
    normalizedMap.height,
    normalizedMap.editor!.generation,
    normalizedMap.scaleKm,
    normalizedMap.kind,
  );
  return normalized;
}
async function openAtlas(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('.atlas-canvas')).toBeVisible();
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
}
async function jobs(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __terrainDetailJobs: number }).__terrainDetailJobs,
  );
}
test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => {
    const tracked = window as unknown as { __terrainDetailJobs: number };
    tracked.__terrainDetailJobs = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      const value = message as { generation?: unknown; signature?: unknown };
      if (value?.generation && typeof value.signature === 'string') tracked.__terrainDetailJobs++;
      return Reflect.apply(original, this, [message, ...args]);
    };
  });
  const current = await workspace(request);
  const saved = await request.put('/api/workspace', {
    data: { data: savedTerrainFixture(), revision: current.revision },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
});

test('saved terrain shows thirteen non-color engravings and province lines stay beneath intact river, road and text ink', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openAtlas(page);
  const baseline = (await workspace(request)).revision;
  const details = page.locator('[data-map-details="true"]');
  const before = await details.evaluate((el) => el.outerHTML);
  await page.locator('[data-layer-button="terrain"]').click();
  const texture = page.locator(
    '[data-geographic-phase="underlay"] [data-terrain-texture="engraved"]',
  );
  await expect(texture).toBeVisible();
  await expect(texture.locator('[data-terrain-texture-biome]')).toHaveCount(13);
  const biomes = await texture.locator('[data-terrain-texture-biome]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      biome: node.getAttribute('data-terrain-texture-biome'),
      valid: [...node.querySelectorAll('path')].some(
        (path) => (path.getAttribute('d')?.length ?? 0) > 30,
      ),
    })),
  );
  expect(biomes.every((biome) => biome.valid)).toBe(true);
  expect(biomes.map((biome) => biome.biome).sort()).toEqual(
    biomeCatalog
      .filter((b) => b.id !== 'water')
      .map((b) => b.id)
      .sort(),
  );
  expect(await texture.locator('path').count()).toBeLessThanOrEqual(41);
  await expect(texture).toHaveAttribute('clip-path', /^url\(#.+-land\)$/);
  const relief = page.locator(
    '[data-geographic-phase="underlay"] [data-terrain-relief="continuous"]',
  );
  await expect(relief).toBeVisible();
  await expect(relief).toHaveAttribute(
    'clip-path',
    (await texture.getAttribute('clip-path')) ?? '',
  );
  expect(await relief.locator('path').count()).toBeGreaterThan(5);
  expect(await relief.locator('path').count()).toBeLessThanOrEqual(37);
  expect(await relief.locator('filter, image').count()).toBe(0);
  await expect(page.locator('[data-thematic-blend="terrain"]')).toBeVisible();
  await expect(details.locator('[data-map-artwork="detail_river"]')).toHaveAttribute(
    'stroke',
    '#527e87',
  );
  await expect(details.locator('[data-map-artwork="detail_road"]')).toHaveAttribute(
    'stroke',
    '#887456',
  );
  await expect(details.getByText('晴川驿道', { exact: true })).toBeVisible();
  await page.locator('.atlas-stage-shell').screenshot({ path: '.runtime/detail-terrain-ui.png' });
  await page.locator('[data-layer-button="regions"]').click();
  const province = page.locator('[data-province-boundaries="true"]');
  // A perfectly vertical SVG path has a zero-width layout box despite a visible stroke.
  await expect(province).toBeAttached();
  await expect(province.locator('..')).toBeVisible();
  expect(await province.evaluate((el) => getComputedStyle(el).stroke)).not.toBe('none');
  expect((await province.boundingBox())!.height).toBeGreaterThan(100);
  await expect(province).toHaveAttribute('d', /M400,0/);
  expect((await province.getAttribute('d'))!.length).toBeGreaterThan(80);
  await expect(page.locator('[data-cell-boundaries="true"]')).toHaveAttribute('d', /M200,0/);
  expect(
    await province.evaluate((element) => {
      const details = document.querySelector('[data-map-details="true"]');
      return (
        !!details && !!(element.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING)
      );
    }),
  ).toBe(true);
  expect(await details.evaluate((el) => el.outerHTML)).toEqual(before);
  await page.locator('.atlas-stage-shell').screenshot({ path: '.runtime/detail-regions-ui.png' });
  for (const layer of ['countries', 'cultures', 'religions', 'atlas']) {
    await page.locator(`[data-layer-button="${layer}"]`).click();
    await expect(texture).toBeVisible();
    await expect(relief).toBeVisible();
    expect(await details.evaluate((el) => el.outerHTML)).toEqual(before);
    if (layer === 'countries' || layer === 'atlas')
      await page
        .locator('.atlas-stage-shell')
        .screenshot({ path: `.runtime/rich-${layer}-ui.png` });
  }
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.locator('[data-layer-button="regions"]').click();
  await expect(page.locator('[data-province-boundaries="true"]')).toHaveAttribute('d', /M400,0/);
  expect(await jobs(page)).toBe(0);
  expect((await workspace(request)).revision).toBe(baseline);
  expect(errors).toEqual([]);
});

test('climate guide uses saved land-only ranges, means and fixed scales, and remains within a narrow midnight screen', async ({
  page,
  request,
}) => {
  await openAtlas(page);
  const baseline = (await workspace(request)).revision;
  const cases = [
    {
      layer: 'temperature',
      title: '气温图层说明',
      range: '-20.0～40.0',
      mean: '10.0',
      stops: ['−25℃', '−10℃', '0℃', '10℃', '20℃', '30℃', '40+℃'],
    },
    {
      layer: 'precipitation',
      title: '降水图层说明',
      range: '125～3875',
      mean: '2000',
      stops: ['0 mm', '250 mm', '500 mm', '1000 mm', '2000 mm', '4000 mm', '6500+ mm'],
    },
  ];
  for (const item of cases) {
    await page.locator(`[data-layer-button="${item.layer}"]`).click();
    const guide = page.getByRole('region', { name: item.title, exact: true });
    await expect(guide).toBeVisible();
    await expect(guide).toContainText('读取已保存地图');
    await expect(guide.locator('.climate-guide-values b')).toHaveText([item.range, item.mean]);
    await expect(guide.locator('.climate-guide-stops small')).toHaveText(item.stops);
    await expect(guide.locator('[aria-label="固定数值色阶"]')).toBeVisible();
    if (!(await guide.locator('details').evaluate((el) => el.hasAttribute('open'))))
      await guide.getByText('计算依据与使用说明', { exact: true }).click();
    await expect(guide.locator('details p').last()).toBeVisible();
    await expect(guide).toContainText('色阶在各张地图之间固定可比');
    await expect(guide).toContainText('需明确重新生成才会重算');
    if (item.layer === 'precipitation') {
      await expect(guide).toContainText('迎风坡通常多雨');
      await expect(guide).toContainText('不会为了增加颜色而自动拉伸本图数值');
    }
  }
  await page.locator('[data-climate-guide="precipitation"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/detail-rain-ui.png' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'midnight';
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const guide = page.getByRole('region', { name: '降水图层说明', exact: true });
  await guide.scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().right))
    .toBeLessThanOrEqual(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  const bounds = await guide.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  const stops = guide.locator('.climate-guide-stops');
  expect(await stops.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: '.runtime/detail-rain-mobile-ui.png' });
  expect(await jobs(page)).toBe(0);
  expect((await workspace(request)).revision).toBe(baseline);
});
