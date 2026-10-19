import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createSeed } from '../../shared/seed';
import { defaultGeographicSettings, type GeneratedGeography } from '../../shared/geography';
import { divisionEntityTypes, type DivisionKind, type MapPoint } from '../../shared/cartography';
import type { WorkspaceEnvelope } from '../../shared/model';
import { generationSignature, snapshotElevation } from '../../src/lib/generated-map';
import { validateWorkspace } from '../../server/validation';

// Every request uses the freshly-created DemoStore on 3311, never the daily application.
async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const value = (await response.json()) as WorkspaceEnvelope;
  expect(value.mode).toBe('demo');
  return value;
}
async function clickCell(page: Page, id: number, modifier?: 'Shift' | 'Control') {
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const point = await screenPoint(page, { x: id * 200 + 100, y: 150 });
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(point.x, point.y);
  if (modifier) await page.keyboard.up(modifier);
}
async function screenPoint(page: Page, point: MapPoint) {
  return page.locator('[data-map-viewport]').evaluate((element, value) => {
    const transformed = new DOMPoint(value.x, value.y).matrixTransform(
      (element as SVGGElement).getScreenCTM()!,
    );
    return { x: transformed.x, y: transformed.y };
  }, point);
}
async function geography(request: APIRequestContext) {
  return (await workspace(request)).data.maps[0].editor!.generated!.geography!;
}

test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => {
    const counter = window as unknown as { __geographicJobs: number };
    counter.__geographicJobs = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      const candidate = message as { signature?: unknown; generation?: unknown } | null;
      if (candidate && typeof candidate.signature === 'string' && candidate.generation)
        counter.__geographicJobs++;
      return Reflect.apply(original, this, [message, ...args]);
    };
  });
  const current = await workspace(request);
  const data = createSeed();
  data.worlds[0].entityTemplates = {
    faction: ['领土政策', '王权传统'],
    culture: ['世系传承', '地域风俗'],
    religion: ['教义核心', '仪礼'],
  };
  const map = data.maps[0];
  map.width = 1000;
  map.height = 640;
  map.pins = [];
  map.strokes = [];
  const kinds: DivisionKind[] = ['country', 'culture', 'religion'];
  const divisions: GeneratedGeography['divisions'] = [];
  for (const kind of kinds) {
    for (const index of [0, 1]) {
      const id = `selection_${kind}_${index}`;
      data.entities.push({
        ...data.entities[0],
        id: `${id}_entry`,
        type: divisionEntityTypes[kind],
        name: `${kind}-${index}-关联设定`,
        visibility: 'public',
      });
      divisions.push({
        id,
        kind,
        name: `${kind}-${index}`,
        color: index ? '#af7870' : '#819d7e',
        center: { x: index ? 600 : 200, y: 320 },
        entityId: `${id}_entry`,
      });
    }
  }
  const generated: GeneratedGeography = {
    version: 1,
    seed: 5412,
    width: map.width,
    height: map.height,
    divisions,
    areas: [],
    ports: [],
    seaRoutes: [],
    plates: [
      {
        id: 0,
        name: '地理选择测试板块',
        center: { x: 500, y: 320 },
        velocity: { x: 0, y: 0 },
        kind: 'continental',
        color: '#b7ad8b',
      },
    ],
    cells: [0, 1, 2, 3, 4].map((id) => ({
      id,
      center: { x: id * 200 + 100, y: 320 },
      polygon: [
        { x: id * 200, y: 0 },
        { x: id * 200 + 200, y: 0 },
        { x: id * 200 + 200, y: 640 },
        { x: id * 200, y: 640 },
      ],
      neighbors: [id - 1, id + 1].filter((n) => n >= 0 && n <= 4),
      land: id < 4,
      plate: 0,
      elevation: id < 4 ? 150 : -200,
      temperature: 20,
      precipitation: 900,
      biome: id < 4 ? 'grass' : 'water',
      shelf: id === 4,
      ...(id < 4
        ? {
            country: `selection_country_${id < 2 ? 0 : 1}`,
            culture: 'selection_culture_0',
            religion: 'selection_religion_0',
          }
        : {}),
    })),
    borders: [0, 1, 2, 3].map((id) => ({
      id: `selection_cell_${id}`,
      kind: 'cell',
      cells: [id, id + 1],
      points: [
        { x: (id + 1) * 200, y: 0 },
        { x: (id + 1) * 200, y: 640 },
      ],
    })),
  };
  map.editor = {
    version: 1,
    mode: 'sculpt',
    baseVisible: false,
    regions: [],
    objects: [],
    generation: {
      version: 2,
      seed: 5412,
      detail: 'standard',
      climate: 'temperate',
      settlements: 0,
      rivers: false,
      routes: false,
      geography: defaultGeographicSettings('world'),
    },
    generated: {
      version: 1,
      signature: '1234567890abcdef-1a2b',
      objects: [
        {
          id: 'selection_saved_land',
          name: '陆地 · 共享地表',
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 800, y: 0 },
            { x: 800, y: 640 },
            { x: 0, y: 640 },
            { x: 0, y: 0 },
            { x: 260, y: 440 },
            { x: 340, y: 440 },
            { x: 340, y: 560 },
            { x: 260, y: 560 },
            { x: 260, y: 440 },
            { x: 0, y: 0 },
          ],
          text: '',
          color: '#ded5bc',
          stroke: 'none',
          strokeWidth: 0,
          size: 1,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: true,
        },
      ],
      elevation: snapshotElevation({
        columns: 50,
        rows: 32,
        width: map.width,
        height: map.height,
        values: Float32Array.from({ length: 50 * 32 }, (_, index) => {
          const x = ((index % 50) + 0.5) * 20,
            y = (Math.floor(index / 50) + 0.5) * 20;
          return x >= 800 || (x >= 260 && x <= 340 && y >= 440 && y <= 560) ? -200 : 150;
        }),
        min: -200,
        max: 150,
      }),
      geography: generated,
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
  const response = await request.put('/api/workspace', {
    data: { data: normalized, revision: current.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
  await page.getByRole('button', { name: '疆域分区', exact: true }).click();
});

test('whole cells are reviewed before explicit country, culture and religion fill and clear', async ({
  page,
  request,
}) => {
  const baseline = await workspace(request);
  const initial = await geography(request);
  await page.getByLabel('填充分区', { exact: true }).selectOption('selection_country_1');
  await expect(page.locator('.geographic-division-target')).toContainText('country-1-关联设定');
  await page.getByRole('button', { name: '选择小区域', exact: true }).click();
  await clickCell(page, 0);
  await clickCell(page, 1);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(2);
  await expect(page.getByRole('status').filter({ hasText: '已选' })).toHaveText(
    '已选 2 个陆地单元',
  );
  expect((await workspace(request)).revision).toBe(baseline.revision);
  expect(await geography(request)).toEqual(initial);
  await clickCell(page, 1);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(1);
  await page.getByRole('button', { name: '填充选中区域', exact: true }).click();
  await expect
    .poll(async () => (await geography(request)).cells[0].country)
    .toBe('selection_country_1');
  expect((await geography(request)).cells[1].country).toBe('selection_country_0');
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  for (const [label, kind, layer] of [
    ['文化', 'culture', 'cultures'],
    ['信仰', 'religion', 'religions'],
  ] as const) {
    const previousLayer = await page
      .locator('.map-layer-buttons [aria-pressed="true"]')
      .getAttribute('data-layer-button');
    await page
      .getByRole('group', { name: '疆域类型' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await expect(page.locator(`[data-layer-button="${previousLayer}"]`)).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.locator(`[data-layer-button="${layer}"]`).click();
    await page.getByLabel('填充分区', { exact: true }).selectOption(`selection_${kind}_1`);
    await clickCell(page, 0);
    await page.getByRole('button', { name: '填充选中区域', exact: true }).click();
    await expect
      .poll(async () => (await geography(request)).cells[0][kind])
      .toBe(`selection_${kind}_1`);
    expect((await geography(request)).cells[0].country).toBe('selection_country_1');
    expect((await geography(request)).cells[1][kind]).toBe(`selection_${kind}_0`);
  }
  await clickCell(page, 0);
  await page.getByRole('button', { name: '清除归属', exact: true }).click();
  await expect.poll(async () => (await geography(request)).cells[0].religion ?? '').toBe('');
  expect((await geography(request)).cells[0].culture).toBe('selection_culture_1');
  expect((await geography(request)).cells[0].country).toBe('selection_country_1');
  const saved = await geography(request);
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/geographic-cell-selection.png' });
  expect(
    await page.evaluate(() => (window as unknown as { __geographicJobs: number }).__geographicJobs),
  ).toBe(0);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  expect(await geography(request)).toEqual(saved);
  expect(
    await page.evaluate(() => (window as unknown as { __geographicJobs: number }).__geographicJobs),
  ).toBe(0);
});

test('dragging pans without painting and Shift/Ctrl selection excludes water within coastal cells', async ({
  page,
  request,
}) => {
  const baseline = (await workspace(request)).revision;
  await page.getByRole('button', { name: '选择小区域', exact: true }).click();
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const beforeSelectionDrag = await page.locator('[data-map-viewport]').getAttribute('transform');
  const start = await screenPoint(page, { x: 100, y: 150 });
  const end = await screenPoint(page, { x: 300, y: 150 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
  expect(await page.locator('[data-map-viewport]').getAttribute('transform')).not.toBe(
    beforeSelectionDrag,
  );
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await page.getByRole('button', { name: '重置地图视图', exact: true }).click();
  await clickCell(page, 4);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  const lake = await screenPoint(page, { x: 300, y: 500 });
  await page.mouse.click(lake.x, lake.y);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await clickCell(page, 0, 'Control');
  await expect(page.locator('[data-selected-cell]')).toHaveCount(2);
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await clickCell(page, 0);
  await clickCell(page, 3, 'Shift');
  await expect(page.locator('[data-selected-cell]')).toHaveCount(4);
  await page.screenshot({ path: '.runtime/geographic-selection-review.png' });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const download = await downloadEvent;
  const exported = await readFile((await download.path())!, 'utf8');
  expect(exported).not.toContain('data-geographic-selection');
  expect(exported).not.toContain('data-selected-cell');
  await page
    .locator('.geography-panel')
    .getByRole('button', { name: '平移地图', exact: true })
    .click();
  const before = await page.locator('[data-map-viewport]').getAttribute('transform');
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const origin = await screenPoint(page, { x: 400, y: 150 });
  await page.mouse.move(origin.x, origin.y);
  await page.mouse.down();
  await page.mouse.move(origin.x + 65, origin.y + 30, { steps: 4 });
  await page.mouse.up();
  expect(await page.locator('[data-map-viewport]').getAttribute('transform')).not.toBe(before);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(4);
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  expect((await workspace(request)).revision).toBe(baseline);
  await expect(page.getByRole('button', { name: '填充选中区域', exact: true })).toBeDisabled();
});

test('new country, culture and faith entries create linked empty divisions then fill selected cells', async ({
  page,
  request,
}) => {
  const initial = await workspace(request);
  for (const [kind, label, customField] of [
    ['country', '国家', '领土政策'],
    ['culture', '文化', '世系传承'],
    ['religion', '信仰', '教义核心'],
  ] as const) {
    await page
      .getByRole('group', { name: '疆域类型' })
      .getByRole('button', { name: label, exact: true })
      .click();
    await page.getByRole('button', { name: `新建${label}`, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(`${label}名称`, { exact: true }).fill(`新创${label}测试`);
    await dialog.getByLabel('摘要', { exact: true }).fill(`由地图单元建立的${label}设定。`);
    await dialog.getByLabel(customField, { exact: true }).fill('沿用当前世界的自定义模板');
    await dialog.getByRole('button', { name: `创建并关联${label}`, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await geography(request)).divisions.find((d) => d.name === `新创${label}测试`)
            ?.entityId ?? '',
      )
      .not.toBe('');
    const saved = await workspace(request);
    const division = saved.data.maps[0].editor!.generated!.geography!.divisions.find(
      (d) => d.name === `新创${label}测试`,
    )!;
    const entry = saved.data.entities.find((entity) => entity.id === division.entityId)!;
    expect(division.kind).toBe(kind);
    expect(entry.type).toBe(divisionEntityTypes[kind]);
    expect(entry.worldId).toBe(saved.data.maps[0].worldId);
    expect(entry.attributes[customField]).toBe('沿用当前世界的自定义模板');
    expect(
      saved.data.maps[0].editor!.generated!.geography!.cells.some((c) => c[kind] === division.id),
    ).toBe(false);
    await page.getByLabel('填充分区', { exact: true }).selectOption(division.id);
    await page.getByRole('button', { name: '选择小区域', exact: true }).click();
    await clickCell(page, 0);
    await page.getByRole('button', { name: '填充选中区域', exact: true }).click();
    await expect.poll(async () => (await geography(request)).cells[0][kind]).toBe(division.id);
  }
  const saved = await workspace(request);
  expect(saved.data.entities.length).toBe(initial.data.entities.length + 3);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  expect((await workspace(request)).data).toEqual(saved.data);
  expect(
    await page.evaluate(() => (window as unknown as { __geographicJobs: number }).__geographicJobs),
  ).toBe(0);
});
