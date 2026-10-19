import { readFile } from 'node:fs/promises';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';
import { defaultGeographicSettings, type GeneratedGeography } from '../../shared/geography';
import { generationSignature, snapshotElevation } from '../../src/lib/generated-map';
import { assignGeographicCells } from '../../src/lib/geographic-edits';
import { validateWorkspace } from '../../server/validation';
async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}
async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('.atlas-canvas > g').evaluate(
    (element, p) => {
      const point = new DOMPoint(p.x, p.y).matrixTransform(
        (element as SVGGElement).getScreenCTM()!,
      );
      return { x: point.x, y: point.y };
    },
    { x, y },
  );
}
async function draw(page: Page, points: [number, number][], release = true) {
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const first = await screenPoint(page, ...points[0]);
  await page.mouse.move(first.x, first.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const point = await screenPoint(page, ...p);
    await page.mouse.move(point.x, point.y, { steps: 6 });
  }
  if (release) await page.mouse.up();
}
test.beforeEach(async ({ request }) => {
  const current = await workspace(request),
    data = createSeed();
  const faction = data.entities.find((e) => e.type === 'faction')!;
  data.entities.push(
    { ...faction, id: 'country_second', name: '墨海联邦' },
    { ...faction, id: 'culture_entry', type: 'culture', name: '河谷文化' },
    { ...faction, id: 'religion_entry', type: 'religion', name: '月辉信仰' },
  );
  data.maps[0] = { ...data.maps[0], pins: [], strokes: [], scaleKm: 400 };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
});
test('map creation has scale presets and resizing persists authored geometry with undo', async ({
  page,
  request,
}) => {
  const original = (await workspace(request)).data.maps;
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '绘制新的疆域' });
  await expect(dialog.getByLabel('画布宽度')).toHaveValue('1600');
  await expect(dialog.getByLabel('横向地理范围（km）')).toHaveValue('12000');
  await dialog.getByLabel('地图尺度').selectOption('region');
  await expect(dialog.getByLabel('画布宽度')).toHaveValue('1200');
  await expect(dialog.getByLabel('横向地理范围（km）')).toHaveValue('400');
  await dialog.getByLabel('地图名称').fill('边境试绘');
  await dialog.getByLabel('画布宽度').fill('900');
  await dialog.getByLabel('画布高度').fill('600');
  await dialog.getByLabel('横向地理范围（km）').fill('80');
  await dialog.getByRole('radio', { name: '按照色块生成', exact: true }).check();
  await dialog.getByRole('button', { name: '创建地图', exact: true }).click();
  await expect.poll(async () => (await workspace(request)).data.maps.length).toBe(3);
  await page.getByRole('button', { name: '草原', exact: true }).click();
  await draw(page, [
    [250, 320],
    [520, 330],
  ]);
  await expect
    .poll(async () => (await workspace(request)).data.maps.at(-1)?.editor?.regions.length)
    .toBe(1);
  const painted = (await workspace(request)).data.maps.at(-1)!;
  await page.getByRole('button', { name: '地图档案', exact: true }).click();
  const panel = page.locator('.map-dimensions-panel');
  await panel.getByLabel('画布宽度').fill('1800');
  await panel.getByLabel('画布高度').fill('1200');
  await panel.getByLabel('横向地理范围（km）').fill('160');
  await panel.getByRole('button', { name: '应用地图大小' }).click();
  await expect.poll(async () => (await workspace(request)).data.maps.at(-1)?.width).toBe(1800);
  const resized = (await workspace(request)).data.maps.at(-1)!;
  expect(resized.editor!.regions[0].points[0].x).toBeCloseTo(
    painted.editor!.regions[0].points[0].x * 2,
  );
  expect(resized.editor!.regions[0].width).toBe(painted.editor!.regions[0].width * 2);
  await page.getByRole('button', { name: '撤销地图编辑' }).click();
  await expect.poll(async () => (await workspace(request)).data.maps.at(-1)?.width).toBe(900);
  await page.getByRole('button', { name: '重做地图编辑' }).click();
  await expect.poll(async () => (await workspace(request)).data.maps.at(-1)?.width).toBe(1800);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByLabel('切换地图').selectOption(resized.id);
  await expect(page.locator('.atlas-canvas')).toHaveAttribute('viewBox', '0 0 1800 1200');
  await expect(page.locator('[data-map-scale] text')).toContainText('km');
  expect((await workspace(request)).data.maps.slice(0, 2)).toEqual(original);
});
test('new automatic map uses current generator, physical coverage and canvas size', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('地图名称').fill('远方大陆');
  await dialog.getByRole('button', { name: '创建地图', exact: true }).click();
  await expect.poll(async () => (await workspace(request)).data.maps.length).toBe(3);
  const map = (await workspace(request)).data.maps.at(-1)!;
  expect([map.width, map.height, map.scaleKm]).toEqual([1600, 1000, 12000]);
  expect(map.editor?.generation?.version).toBe(2);
  await expect(page.locator('.atlas-canvas [data-terrain-composite]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
    { timeout: 60000 },
  );
  await expect(page.locator('.atlas-canvas [data-terrain-composite]')).toHaveAttribute(
    'data-terrain-error',
    'false',
  );
  await page.screenshot({ path: '.runtime/map-world-sized.png', animations: 'disabled' });
});
test('疆域分区 uses whole cells and exports connected borders with coast masks and no editor overlay', async ({
  page,
  request,
}) => {
  const current = await workspace(request);
  const data = current.data;
  const originalOtherMap = structuredClone(data.maps[1]);
  const map = data.maps[0];
  const faction = data.entities.find((entry) => entry.type === 'faction')!;
  data.entities.push(
    { ...faction, id: 'culture_second', type: 'culture', name: '海岸文化' },
    { ...faction, id: 'religion_second', type: 'religion', name: '晨曦信仰' },
  );
  let geography: GeneratedGeography = {
    version: 1,
    seed: 82317,
    width: map.width,
    height: map.height,
    areas: [],
    ports: [],
    seaRoutes: [],
    plates: [
      {
        id: 0,
        name: '分区测试板块',
        center: { x: 500, y: 320 },
        velocity: { x: 0, y: 0 },
        kind: 'continental',
        color: '#b7ad8b',
      },
    ],
    divisions: [
      {
        id: 'divide_country_a',
        kind: 'country',
        name: faction.name,
        entityId: faction.id,
        center: { x: 375, y: 320 },
        color: '#7c978a',
      },
      {
        id: 'divide_country_b',
        kind: 'country',
        name: '墨海联邦',
        entityId: 'country_second',
        center: { x: 625, y: 320 },
        color: '#aa856b',
      },
      {
        id: 'divide_culture_a',
        kind: 'culture',
        name: '河谷文化',
        entityId: 'culture_entry',
        center: { x: 375, y: 320 },
        color: '#7c978a',
      },
      {
        id: 'divide_culture_b',
        kind: 'culture',
        name: '海岸文化',
        entityId: 'culture_second',
        center: { x: 625, y: 320 },
        color: '#aa856b',
      },
      {
        id: 'divide_religion_a',
        kind: 'religion',
        name: '月辉信仰',
        entityId: 'religion_entry',
        center: { x: 375, y: 320 },
        color: '#7c978a',
      },
      {
        id: 'divide_religion_b',
        kind: 'religion',
        name: '晨曦信仰',
        entityId: 'religion_second',
        center: { x: 625, y: 320 },
        color: '#aa856b',
      },
    ],
    cells: [0, 1, 2, 3].map((id) => ({
      id,
      center: { x: id * 250 + 125, y: 320 },
      polygon: [
        { x: id * 250, y: 0 },
        { x: id * 250 + 250, y: 0 },
        ...(id < 2 ? [{ x: id * 250 + 240, y: 320 }] : []),
        { x: id * 250 + 250, y: 640 },
        { x: id * 250, y: 640 },
        ...(id > 0 && id < 3 ? [{ x: id * 250 - 10, y: 320 }] : []),
      ],
      neighbors: [id - 1, id + 1].filter((neighbor) => neighbor >= 0 && neighbor <= 3),
      land: id < 3,
      plate: 0,
      elevation: id < 3 ? 150 : -150,
      temperature: 20,
      precipitation: 900,
      biome: id < 3 ? 'grass' : 'water',
      shelf: id === 3,
      ...(id < 3
        ? {
            country: `divide_country_${id < 2 ? 'a' : 'b'}`,
            culture: `divide_culture_${id < 2 ? 'a' : 'b'}`,
            religion: `divide_religion_${id < 2 ? 'a' : 'b'}`,
          }
        : {}),
    })),
    borders: [0, 1, 2].map((id) => ({
      id: `divide_cell_${id}`,
      kind: 'cell',
      cells: [id, id + 1],
      points: [
        { x: (id + 1) * 250, y: 0 },
        ...(id < 2 ? [{ x: (id + 1) * 250 - 10, y: 320 }] : []),
        { x: (id + 1) * 250, y: 640 },
      ],
    })),
  };
  // Rebuild political shared edges without changing ownership.
  geography = assignGeographicCells(geography, 'divide_country_a', new Set([0]));
  map.editor = {
    version: 1,
    mode: 'sculpt',
    baseVisible: false,
    regions: [],
    objects: [],
    generation: {
      version: 2,
      seed: 82317,
      detail: 'standard',
      climate: 'temperate',
      settlements: 0,
      rivers: false,
      routes: false,
      geography: {
        ...defaultGeographicSettings('world'),
        countryCount: 2,
        cultureCount: 2,
        religionCount: 2,
      },
    },
    generated: {
      version: 1,
      signature: '1234567890abcdef-1a2b',
      geography,
      objects: [
        {
          id: 'divide_saved_land',
          name: '陆地 · 共享地表',
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 750, y: 0 },
            { x: 750, y: 640 },
            { x: 0, y: 640 },
          ],
          text: '',
          color: '#ded5bc',
          stroke: '#9a8566',
          strokeWidth: 1,
          size: 1,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: true,
        },
      ],
      elevation: snapshotElevation({
        columns: 4,
        rows: 2,
        width: map.width,
        height: map.height,
        values: Float32Array.from([150, 150, 150, -150, 150, 150, 150, -150]),
        min: -150,
        max: 150,
      }),
    },
  };
  const normalized = validateWorkspace(data);
  const normalizedMap = normalized.maps[0];
  normalizedMap.editor!.generated!.signature = generationSignature(
    [],
    normalizedMap.width,
    normalizedMap.height,
    normalizedMap.editor!.generation,
    normalizedMap.scaleKm,
    normalizedMap.kind,
  );
  const savedFixture = await request.put('/api/workspace', {
    data: { data: normalized, revision: current.revision },
  });
  expect(savedFixture.ok(), await savedFixture.text()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '疆域分区', exact: true }).click();
  const panel = page.locator('.geography-panel');
  await expect(panel.getByRole('button', { name: '选择小区域', exact: true })).toBeVisible();
  await expect(page.locator('[data-division-controls]')).toHaveCount(0);
  await expect(page.getByLabel('分区笔刷直径')).toHaveCount(0);
  for (const [kind, label] of [
    ['country', '国家'],
    ['culture', '文化'],
    ['religion', '信仰'],
  ] as const) {
    await panel
      .getByRole('group', { name: '疆域类型' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await panel.getByLabel('填充分区', { exact: true }).selectOption(`divide_${kind}_b`);
    await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
    const point = await screenPoint(page, 125, 150);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('[data-selected-cell="0"]')).toBeVisible();
    expect(
      (await workspace(request)).data.maps[0].editor!.generated!.geography!.cells[0][kind],
    ).toBe(`divide_${kind}_a`);
    await panel.getByRole('button', { name: '填充选中区域', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await workspace(request)).data.maps[0].editor!.generated!.geography!.cells[0][kind],
      )
      .toBe(`divide_${kind}_b`);
  }
  await page.locator('[data-layer-button="countries"]').click();
  const countryLabel = page
    .locator('[data-geographic-layer="countries"] text')
    .filter({ hasText: '墨海联邦' });
  await countryLabel.hover();
  const tooltip = page.locator('[data-entity-tooltip-root]').first();
  await expect(tooltip).toBeVisible({ timeout: 2500 });
  await expect(tooltip).toHaveAttribute('data-locked', 'true', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-entity-tooltip-root]')).toHaveCount(0);
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const point = await screenPoint(page, 125, 150);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('[data-selected-cell="0"]')).toBeVisible();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const download = await downloadEvent;
  const svg = await readFile((await download.path())!, 'utf8');
  expect(svg).toContain('data-political-borders');
  expect(svg).toContain('data-border-chain');
  expect(svg).toContain('maskUnits="userSpaceOnUse"');
  expect(svg).toContain('clip-rule="evenodd"');
  expect(svg).not.toContain('data-selected-cell');
  expect(svg).not.toContain('data-editor-overlay');
  await download.saveAs('.runtime/map-divisions-export.svg');
  await page.screenshot({ path: '.runtime/map-country-boundaries.png', animations: 'disabled' });
  const saved = (await workspace(request)).data.maps[0];
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  expect((await workspace(request)).data.maps[0]).toEqual(saved);
  expect((await workspace(request)).data.maps[1]).toEqual(originalOtherMap);
});
