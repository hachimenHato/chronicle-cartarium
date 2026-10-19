import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { biomeCatalog, legacyBiomeIds, type MapRegion } from '../../shared/cartography';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

// This suite uses only Playwright's fresh DemoStore at the fixed port 3311.
async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}
const region = (
  id: string,
  biome: MapRegion['biome'],
  points: [number, number][],
  width: number,
): MapRegion => ({
  id: `showcase_${id}`,
  name: id,
  biome,
  geometry: 'brush',
  points: points.map(([x, y]) => ({ x, y })),
  width,
  seed: 105,
  roughness: 0.35,
  density: 0.75,
  visible: true,
  locked: false,
});
const fiveSources = [
  region(
    'land_north',
    'grass',
    [
      [245, 300],
      [740, 315],
    ],
    320,
  ),
  region(
    'land_south',
    'grass',
    [
      [340, 385],
      [700, 410],
    ],
    280,
  ),
  region(
    'ridge',
    'mountain',
    [
      [410, 225],
      [635, 265],
    ],
    95,
  ),
  region(
    'woods',
    'forest',
    [
      [300, 340],
      [425, 390],
    ],
    125,
  ),
  region(
    'lake',
    'water',
    [
      [675, 390],
      [725, 400],
    ],
    70,
  ),
];
const richSources = [
  region(
    'mainland_west',
    'grass',
    [
      [280, 265],
      [435, 450],
    ],
    340,
  ),
  region(
    'mainland_east',
    'grass',
    [
      [430, 330],
      [740, 340],
    ],
    380,
  ),
  region(
    'north_tundra',
    'tundra',
    [
      [390, 185],
      [490, 170],
    ],
    100,
  ),
  region(
    'west_taiga',
    'taiga',
    [
      [240, 245],
      [335, 285],
    ],
    115,
  ),
  region(
    'west_forest',
    'forest',
    [
      [265, 345],
      [350, 390],
    ],
    120,
  ),
  region(
    'highlands',
    'hill',
    [
      [400, 300],
      [475, 340],
    ],
    135,
  ),
  region(
    'eastern_plateau',
    'plateau',
    [
      [665, 235],
      [750, 270],
    ],
    115,
  ),
  region(
    'central_range',
    'mountain',
    [
      [480, 245],
      [555, 260],
      [595, 335],
    ],
    78,
  ),
  region(
    'snow_peaks',
    'snow',
    [
      [490, 220],
      [540, 240],
    ],
    35,
  ),
  region(
    'southern_rainforest',
    'rainforest',
    [
      [370, 455],
      [450, 490],
    ],
    115,
  ),
  region(
    'southern_savanna',
    'savanna',
    [
      [520, 465],
      [625, 480],
    ],
    110,
  ),
  region(
    'dry_east',
    'desert',
    [
      [740, 390],
      [800, 420],
    ],
    110,
  ),
  region(
    'eastern_badlands',
    'badlands',
    [
      [725, 310],
      [780, 325],
    ],
    65,
  ),
  region(
    'wetlands',
    'swamp',
    [
      [565, 390],
      [610, 415],
    ],
    75,
  ),
  region(
    'inland_lake',
    'water',
    [
      [645, 375],
      [660, 410],
    ],
    62,
  ),
];
async function install(request: APIRequestContext, regions: MapRegion[], version: 1 | 2) {
  const current = await workspace(request),
    data = createSeed();
  data.maps[0] = {
    ...data.maps[0],
    width: 1000,
    height: 700,
    seed: 0,
    pins: [],
    strokes: [],
    editor: {
      version: 1,
      mode: 'sculpt',
      baseVisible: false,
      regions,
      objects: [],
      generation:
        version === 1
          ? {
              version: 1,
              seed: 2741,
              climate: 'temperate',
              rivers: true,
              routes: true,
              settlements: 7,
            }
          : {
              version: 2,
              detail: 'ultra',
              seed: 2741,
              climate: 'temperate',
              rivers: true,
              routes: true,
              settlements: 8,
            },
    },
  };
  const response = await request.put('/api/workspace', {
    data: { data, revision: current.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return data;
}
async function openMap(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  const composite = page.locator('.atlas-canvas [data-terrain-composite="true"]');
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  return composite;
}
async function geometry(page: Page) {
  return page
    .locator('.atlas-canvas [data-terrain-composite="true"]')
    .evaluate((element) =>
      [...element.querySelectorAll('path, g[transform], text')].map((node) => [
        node.tagName,
        node.getAttribute('d'),
        node.getAttribute('transform'),
        node.getAttribute('fill'),
        node.tagName === 'text' ? node.textContent : null,
      ]),
    );
}

test('saved v1 map upgrades explicitly and undo restores the original map', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const initial = await install(request, fiveSources, 1);
  const composite = await openMap(page);
  const original = await geometry(page);
  expect((await workspace(request)).data).toEqual(initial);
  for (const biome of biomeCatalog.filter(
    (b) => !legacyBiomeIds.includes(b.id as (typeof legacyBiomeIds)[number]),
  )) {
    await expect(
      page.locator('.studio-biomes').getByRole('button', { name: biome.label, exact: true }),
    ).toBeDisabled();
  }
  const banner = page.getByLabel('当前地图生成方式');
  await expect(banner).toContainText('当前地图还在使用旧版生成 v1');
  await page.setViewportSize({ width: 390, height: 844 });
  await banner.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.runtime/legacy-upgrade-mobile.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1560, height: 1100 });
  await banner.getByRole('button', { name: '启用新版河流与道路', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toMatchObject({ version: 2, detail: 'high', linework: 'organic' });
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  expect(await geometry(page)).not.toEqual(original);
  await expect(banner).toHaveCount(0);
  for (const biome of biomeCatalog)
    await expect(
      page.locator('.studio-biomes').getByRole('button', { name: biome.label, exact: true }),
    ).toBeEnabled();
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expect.poll(async () => (await workspace(request)).data).toEqual(initial);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  expect(await geometry(page)).toEqual(original);
  await expect(banner).toContainText('当前地图还在使用旧版生成 v1');
});

test('both regeneration entry points upgrade the visible recipe and undo restores authored input', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const initial = await install(request, fiveSources, 1);
  const composite = await openMap(page);
  const originalGeometry = await geometry(page);
  await page.getByRole('button', { name: '重新生成（新版）', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toMatchObject({
      version: 2,
      linework: 'organic',
      detail: 'high',
    });
  const regenerated = (await workspace(request)).data.maps[0];
  expect(regenerated.editor?.generation?.seed).not.toEqual(
    initial.maps[0].editor?.generation?.seed,
  );
  expect(regenerated.seed).toEqual(initial.maps[0].seed);
  expect(regenerated.editor?.regions).toEqual(initial.maps[0].editor?.regions);
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expect.poll(async () => (await workspace(request)).data).toEqual(initial);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  expect(await geometry(page)).toEqual(originalGeometry);

  await page.getByRole('button', { name: '地图档案', exact: true }).click();
  const seedInput = page.locator('.atlas-seed-input input');
  await expect(seedInput).toBeEnabled(); // The random base layer is disabled in this fixture.
  await expect(seedInput).toHaveValue(String(initial.maps[0].editor?.generation?.seed));
  await seedInput.fill('4026');
  await page.getByRole('button', { name: '按此种子重新生成（新版）', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toMatchObject({
      version: 2,
      linework: 'organic',
      detail: 'high',
      seed: 4026,
    });
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  expect(await geometry(page)).not.toEqual(originalGeometry);
  const saved = (await workspace(request)).data;
  expect(saved.maps[0].seed).toEqual(initial.maps[0].seed);
  expect(saved.maps[0].editor?.regions).toEqual(initial.maps[0].editor?.regions);
  expect(saved.maps[0].editor?.objects).toEqual(initial.maps[0].editor?.objects);
  expect(saved.maps[0].pins).toEqual(initial.maps[0].pins);
  expect(saved.maps[0].strokes).toEqual(initial.maps[0].strokes);
  expect(saved.maps[1]).toEqual(initial.maps[1]);
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expect.poll(async () => (await workspace(request)).data).toEqual(initial);
  await expect(seedInput).toHaveValue(String(initial.maps[0].editor?.generation?.seed));
});

test('fourteen-biome controls render a rich ultra map and retain clean vector export', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = await install(request, richSources, 2);
  const composite = await openMap(page);
  for (const biome of biomeCatalog)
    await expect(
      page.locator('.studio-biomes').getByRole('button', { name: biome.label, exact: true }),
    ).toBeEnabled();
  await expect(composite).toHaveAttribute('data-generation-rivers', /^[1-9]\d*$/);
  await expect(composite).toHaveAttribute('data-generation-roads', /^[1-9]\d*$/);
  await page.mouse.move(20, 20);
  await page.screenshot({ path: '.runtime/sketch-refined-rich-ui.png' });
  await page.locator('.atlas-canvas').screenshot({ path: '.runtime/sketch-refined-rich.png' });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  await (await downloadEvent).saveAs('.runtime/sketch-refined-rich.svg');
  const svg = await readFile('.runtime/sketch-refined-rich.svg', 'utf8');
  expect(svg).not.toContain('NaN');
  expect(svg).not.toContain('data-editor-hit');
  expect(svg).not.toContain('data-editor-overlay');
  expect((await workspace(request)).data).toEqual(initial);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.studio-biomes').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.runtime/sketch-refined-biomes-mobile.png' });
  expect(errors).toEqual([]);
});

test('saved v2 linework softens explicitly, preserves authored content and survives undo and reload', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const initial = await install(request, richSources, 2);
  let composite = await openMap(page);
  const original = await geometry(page);
  await page.mouse.move(20, 20);
  await page.locator('.atlas-canvas').screenshot({ path: '.runtime/linework-before.png' });
  const soften = () => page.getByRole('button', { name: '柔化河流与道路', exact: true }).click();
  await soften();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toMatchObject({ version: 2, linework: 'organic' });
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  const curved = await geometry(page);
  expect(curved).not.toEqual(original);
  const saved = (await workspace(request)).data;
  expect(saved.maps[0].editor?.regions).toEqual(initial.maps[0].editor?.regions);
  expect(saved.maps[0].editor?.objects).toEqual(initial.maps[0].editor?.objects);
  expect(saved.maps[0].pins).toEqual(initial.maps[0].pins);
  expect(saved.maps[1]).toEqual(initial.maps[1]);
  await page.mouse.move(20, 20);
  await page.locator('.atlas-canvas').screenshot({ path: '.runtime/linework-after.png' });
  await page.screenshot({ path: '.runtime/linework-workflow.png' });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  await (await download).saveAs('.runtime/linework-after.svg');
  const svg = await readFile('.runtime/linework-after.svg', 'utf8');
  expect(svg).not.toContain('NaN');
  expect(svg).not.toContain('data-editor-hit');
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expect.poll(async () => (await workspace(request)).data).toEqual(initial);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  expect(await geometry(page)).toEqual(original);
  await soften();
  await expect.poll(async () => (await workspace(request)).data).toEqual(saved);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  composite = page.locator('.atlas-canvas [data-terrain-composite="true"]');
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  expect(await geometry(page)).toEqual(curved);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.studio-generation').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: '.runtime/linework-mobile.png' });
});
