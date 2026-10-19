import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { MapRegion } from '../../shared/cartography';
import type { WorkspaceEnvelope } from '../../shared/model';

// Only Playwright's isolated, per-run DemoStore on port 3311 is used here.
const region = (
  id: string,
  biome: MapRegion['biome'],
  points: { x: number; y: number }[],
  width: number,
  seed: number,
  density: number,
): MapRegion => ({
  id,
  name: id,
  biome,
  geometry: 'brush',
  points,
  width,
  seed,
  density,
  roughness: 0.35,
  visible: true,
  locked: false,
});

const fixtureRegions: MapRegion[] = [
  region(
    'blend_grass_west',
    'grass',
    [
      { x: 230, y: 290 },
      { x: 480, y: 340 },
    ],
    280,
    11,
    0.25,
  ),
  region(
    'blend_grass_east',
    'grass',
    [
      { x: 430, y: 325 },
      { x: 750, y: 365 },
    ],
    250,
    29,
    0.25,
  ),
  region(
    'blend_forest_west',
    'forest',
    [
      { x: 295, y: 265 },
      { x: 365, y: 325 },
    ],
    145,
    43,
    0.85,
  ),
  region(
    'blend_forest_east',
    'forest',
    [
      { x: 365, y: 315 },
      { x: 455, y: 340 },
    ],
    105,
    67,
    0.85,
  ),
  region(
    'blend_ridge',
    'mountain',
    [
      { x: 530, y: 245 },
      { x: 605, y: 270 },
      { x: 690, y: 320 },
    ],
    115,
    89,
    0.75,
  ),
  region(
    'blend_lake',
    'water',
    [
      { x: 545, y: 385 },
      { x: 605, y: 405 },
    ],
    92,
    103,
    0.15,
  ),
];

async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('.atlas-canvas > g').evaluate(
    (element, position) => {
      const matrix = (element as SVGGElement).getScreenCTM()!;
      const result = new DOMPoint(position.x, position.y).matrixTransform(matrix);
      return { x: result.x, y: result.y };
    },
    { x, y },
  );
}

test.beforeEach(async ({ request }) => {
  const envelope = await workspace(request);
  const data = createSeed();
  data.maps[0] = {
    ...data.maps[0],
    seed: 0,
    pins: [],
    strokes: [],
    editor: {
      version: 1,
      mode: 'sketch',
      baseVisible: false,
      regions: structuredClone(fixtureRegions),
      objects: [],
    },
  };
  const response = await request.put('/api/workspace', {
    data: { data, revision: envelope.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});

test('terrain composition previews without saving, then preserves sources through undo, reload and SVG export', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  const workerUrls: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('worker', (worker) => workerUrls.push(worker.url()));
  const original = (await workspace(request)).data.maps;
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  const composite = page.locator('.atlas-canvas [data-terrain-composite="true"]');
  await expect(composite).toBeVisible();
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false');
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  expect(workerUrls.some((url) => url.includes('terrain.worker'))).toBe(true);
  expect(page.workers().some((worker) => worker.url().includes('terrain.worker'))).toBe(true);
  await expect(composite.locator('[data-map-region]')).toHaveCount(6);
  await expect(composite.getByText(/地形暂时无法合成/)).toHaveCount(0);
  // A surface is visible before drawing, rather than merely its transparent source hit areas.
  await expect(composite.locator(':scope > g > path').first()).toBeVisible();
  await page.screenshot({ path: '.runtime/terrain-blend.png' });

  await page.getByRole('button', { name: '草原', exact: true }).click();
  const beforeGesture = await workspace(request);
  const start = await screenPoint(page, 725, 410);
  const end = await screenPoint(page, 790, 490);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await expect(composite).toHaveAttribute('data-terrain-preview', 'true');
  await expect(composite.locator('[data-map-region]')).toHaveCount(7);
  // Keep the pointer down beyond the 650 ms autosave debounce. This intentionally
  // verifies that preview state never queues a delayed persistence request.
  await page.waitForTimeout(850);
  const duringGesture = await workspace(request);
  expect(duringGesture.data.maps[0].editor?.regions).toEqual(fixtureRegions);
  expect(duringGesture.revision).toBe(beforeGesture.revision);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false');
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  await page.screenshot({ path: '.runtime/terrain-brush-preview.png' });
  await page.mouse.up();

  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(7);
  await expect(composite).not.toHaveAttribute('data-terrain-preview', 'true');
  const saved = (await workspace(request)).data.maps[0];
  expect(saved.editor?.regions.slice(0, 6)).toEqual(fixtureRegions);
  expect(saved.editor?.regions[6].biome).toBe('grass');
  expect(saved.editor?.regions[6].points.length).toBeGreaterThan(1);
  expect(saved.editor?.baseVisible).toBe(false);
  expect(saved.editor?.objects).toEqual([]);

  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions)
    .toEqual(fixtureRegions);
  await page.getByRole('button', { name: '重做地图编辑', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions)
    .toEqual(saved.editor?.regions);
  expect((await workspace(request)).data.maps[1]).toEqual(original[1]);

  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(composite).toBeVisible();
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false');
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  await expect(composite.locator('[data-map-region]')).toHaveCount(7);
  expect((await workspace(request)).data.maps[0].editor?.regions).toEqual(saved.editor?.regions);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const download = await downloadEvent;
  const file = '.runtime/terrain-blend.svg';
  await download.saveAs(file);
  const svg = await readFile(file, 'utf8');
  expect(svg).toContain('data-terrain-composite="true"');
  expect(svg).not.toContain('data-terrain-preview="true"');
  expect(svg).not.toContain('data-editor-hit');
  expect(svg).not.toContain('data-editor-overlay');
  expect(svg).not.toContain('data-map-region');
  expect(svg).not.toContain('地形暂时无法合成');
  expect(errors).toEqual([]);
});
