import { test, expect, type APIRequestContext, type Locator } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}
async function metrics(canvas: Locator) {
  await expect(canvas.locator('[data-terrain-composite]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
    { timeout: 45000 },
  );
  return canvas.locator('[data-terrain-composite]').evaluate((root) => {
    const peaks = [...root.querySelectorAll<SVGGElement>('[data-relief-part="峰谷轮廓"]')];
    const masks = [...root.querySelectorAll<SVGGElement>('[data-relief-part="山体遮挡底色"]')];
    const river = root.querySelector('g[fill="#657d79"]');
    return {
      peaks: peaks.length,
      peakWidth: peaks.reduce((sum, p) => sum + p.getBBox().width, 0) / peaks.length,
      rivers: Number(root.getAttribute('data-generation-rivers')),
      roads: Number(root.getAttribute('data-generation-roads')),
      masks: masks.length,
      opaque: masks.every((m) => m.getAttribute('opacity') === '1'),
      behind:
        !!river &&
        masks.every((m) => !!(river.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING)),
      error: root.getAttribute('data-terrain-error'),
    };
  });
}
test('changing coverage updates scale and mountain occlusion in the worker, saves and survives refresh', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const current = await workspace(request),
    data = createSeed(),
    map = data.maps[0];
  Object.assign(map, {
    kind: 'region',
    width: 1000,
    height: 640,
    scaleKm: 400,
    seed: 0,
    pins: [],
    strokes: [],
    editor: {
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
        settlements: 8,
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
    },
  });
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  const canvas = page.locator('.atlas-canvas');
  const region = await metrics(canvas);
  await page.getByRole('button', { name: '地图档案', exact: true }).click();
  const panel = page.locator('.map-dimensions-panel');
  const change = async (coverage: number) => {
    await panel.getByLabel('横向地理范围（km）').fill(String(coverage));
    await panel.getByRole('button', { name: '应用地图大小' }).click();
    await expect.poll(async () => (await workspace(request)).data.maps[0].scaleKm).toBe(coverage);
    return metrics(canvas);
  };
  const world = await change(12000);
  expect(world.peaks).toBeGreaterThan(region.peaks);
  expect(world.peakWidth).toBeLessThan(region.peakWidth * 0.7);
  expect(world.rivers).toBeGreaterThan(region.rivers);
  expect(world.roads).toBeGreaterThan(region.roads);
  await canvas.screenshot({ path: '.runtime/map-scale-world-live.png' });
  const town = await change(10);
  expect(town.peaks).toBeLessThan(region.peaks);
  expect(town.peakWidth).toBeGreaterThan(region.peakWidth);
  expect(town.rivers).toBeLessThan(region.rivers);
  expect(town.roads).toBeLessThan(region.roads);
  for (const value of [world, region, town]) {
    expect(value.masks).toBe(value.peaks);
    expect(value.opaque && value.behind).toBeTruthy();
    expect(value.error).toBe('false');
  }
  await canvas.screenshot({ path: '.runtime/map-scale-town-live.png' });
  const saved = (await workspace(request)).data;
  expect(saved.maps[0].kind).toBe('region');
  expect(saved.maps[0].editor).toEqual(map.editor);
  expect(saved.maps.slice(1)).toEqual(data.maps.slice(1));
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  expect(await metrics(canvas)).toEqual(town);
  expect(errors).toEqual([]);
});
