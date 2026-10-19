import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import { defaultGeographicSettings } from '../../shared/geography';
import type { WorkspaceEnvelope } from '../../shared/model';
import { divisionEntityTypes, type MapPoint } from '../../shared/cartography';
import { distanceToSegment } from '../../src/lib/terrain';

// New DemoStore only: never read .env or connect these tests to the daily app.
async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}
async function map(request: APIRequestContext) {
  return (await workspace(request)).data.maps[0];
}
async function screenPoint(page: Page, point: MapPoint) {
  return page.locator('[data-map-viewport]').evaluate((element, value) => {
    const transformed = new DOMPoint(value.x, value.y).matrixTransform(
      (element as SVGGElement).getScreenCTM()!,
    );
    return { x: transformed.x, y: transformed.y };
  }, point);
}
async function draw(page: Page, points: MapPoint[]) {
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const start = await screenPoint(page, points[0]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    const target = await screenPoint(page, point);
    await page.mouse.move(target.x, target.y, { steps: 5 });
  }
  await page.mouse.up();
}
async function requests(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __terrainRequests: number }).__terrainRequests,
  );
}
async function openAtlas(page: Page) {
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('.atlas-canvas')).toBeVisible();
}
async function generated(page: Page, request: APIRequestContext) {
  await page.goto('/');
  await openAtlas(page);
  await expect
    .poll(async () => (await map(request)).editor?.generated?.geography?.cells.length ?? 0, {
      timeout: 60000,
    })
    .toBeGreaterThan(50);
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
    { timeout: 60000 },
  );
  return await map(request);
}

test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => {
    const tracked = window as unknown as { __terrainRequests: number };
    tracked.__terrainRequests = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      const candidate = message as { signature?: unknown; generation?: unknown } | null;
      if (candidate && typeof candidate.signature === 'string' && candidate.generation)
        tracked.__terrainRequests++;
      return Reflect.apply(original, this, [message, ...args]);
    };
  });
  const envelope = await workspace(request),
    data = createSeed();
  data.maps[0] = {
    ...data.maps[0],
    seed: 382914,
    width: 1200,
    height: 800,
    scaleKm: 4800,
    pins: [],
    strokes: [],
    editor: {
      version: 1,
      mode: 'sketch',
      baseVisible: false,
      regions: [],
      objects: [],
      generation: {
        version: 2,
        seed: 382914,
        detail: 'standard',
        linework: 'organic',
        climate: 'temperate',
        settlements: 10,
        settlementCounts: { village: 3, town: 2, city: 2, castle: 2, camp: 1 },
        rivers: true,
        routes: true,
        elevation: {
          version: 1,
          preset: 'continent',
          seed: 382914,
          relief: 1,
          seaLevel: 0,
          strokes: [],
        },
        geography: {
          ...defaultGeographicSettings('world'),
          source: 'random',
          plateCount: 6,
          countryCount: 4,
          cultureCount: 3,
          religionCount: 3,
          regionDensity: 0.7,
        },
      },
    },
  };
  const response = await request.put('/api/workspace', {
    data: { data, revision: envelope.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});

test('saved generation reopens without worker jobs and names survive thematic layer switches', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = await generated(page, request);
  const linkedWorkspace = (await workspace(request)).data;
  const entityIds = linkedWorkspace.entities.map((entity) => entity.id).sort();
  for (const division of initial.editor!.generated!.geography!.divisions) {
    expect(division.entityId).toBeTruthy();
    const entry = linkedWorkspace.entities.find((entity) => entity.id === division.entityId);
    expect(entry?.worldId).toBe(initial.worldId);
    expect(entry?.type).toBe(divisionEntityTypes[division.kind]);
  }
  expect(initial.editor?.generated?.objects.length).toBeGreaterThan(100);
  expect(initial.editor?.generated?.elevation?.values.length).toBeGreaterThan(1000);
  expect(initial.editor?.generated?.signature).toMatch(/^[0-9a-f]{16}-/);
  expect(await requests(page)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '地名与地点', exact: true }).click();
  const geographic = initial.editor!.generated!.geography!;
  const continent =
    geographic.areas.find((area) => area.kind === 'continent') ??
    geographic.areas.find((area) => area.kind === 'island')!;
  expect(continent).toBeTruthy();
  const input = page.getByLabel(
    `${continent.kind === 'continent' ? '大陆' : '岛屿'}名称 ${continent.id}`,
    { exact: true },
  );
  await input.fill('苍岚大陆');
  await input.press('Tab');
  await expect
    .poll(
      async () =>
        (await map(request)).editor?.generated?.geography?.areas.find(
          (area) => area.id === continent.id,
        )?.name,
    )
    .toBe('苍岚大陆');
  const edited = await map(request),
    baseline = (await workspace(request)).revision,
    count = await requests(page);
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/geographic-atlas-desktop.png' });
  for (const layer of [
    'elevation',
    'temperature',
    'precipitation',
    'plates',
    'countries',
    'cultures',
    'religions',
    'terrain',
    'regions',
    'atlas',
  ]) {
    await page.locator(`[data-layer-button="${layer}"]`).click();
    if (layer === 'elevation')
      await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
        'data-terrain-view',
        'elevation',
      );
    else
      await expect(
        page.locator(
          `[data-geographic-layer="${layer}"][data-geographic-phase="${['temperature', 'precipitation', 'terrain'].includes(layer) ? 'underlay' : 'overlay'}"]`,
        ),
      ).toBeVisible();
    await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
      'data-terrain-pending',
      'false',
    );
    if (
      ['countries', 'cultures', 'religions', 'terrain', 'temperature', 'precipitation'].includes(
        layer,
      )
    )
      await page.screenshot({ path: `.runtime/geographic-${layer}-desktop.png` });
  }
  expect(await requests(page)).toBe(count);
  expect((await workspace(request)).revision).toBe(baseline);
  expect((await workspace(request)).data.entities.map((entity) => entity.id).sort()).toEqual(
    entityIds,
  );
  await page.getByRole('button', { name: '世界总览', exact: true }).click();
  await openAtlas(page);
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
  expect(await requests(page)).toBe(count);
  await page.reload();
  await openAtlas(page);
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
  expect(await requests(page)).toBe(0);
  const reopened = await map(request);
  expect(reopened.editor?.generated).toEqual(edited.editor?.generated);
  expect((await workspace(request)).revision).toBe(baseline);
  expect((await workspace(request)).data.entities.map((entity) => entity.id).sort()).toEqual(
    entityIds,
  );
  await expect(page.locator(`[data-geographic-name="${continent.id}"]`)).toContainText('苍岚大陆');
  expect(errors).toEqual([]);
});

test('shared cell assignment and constrained fronts plus attack arrows persist across reopening', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const initial = await generated(page, request),
    geography = initial.editor!.generated!.geography!;
  await page.getByRole('button', { name: '疆域分区', exact: true }).click();
  const destination = geography.divisions.find((division) => division.kind === 'country')!;
  const target = geography.cells.find(
    (cell) =>
      cell.land &&
      cell.country !== destination.id &&
      cell.center.x > 150 &&
      cell.center.x < 1050 &&
      cell.center.y > 100 &&
      cell.center.y < 700,
  )!;
  expect(target).toBeTruthy();
  await page.getByLabel('填充分区', { exact: true }).selectOption(destination.id);
  await page.getByRole('button', { name: '选择小区域', exact: true }).click();
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const location = await screenPoint(page, target.center);
  await page.mouse.click(location.x, location.y);
  await expect(page.locator(`[data-selected-cell="${target.id}"]`)).toBeVisible();
  expect((await map(request)).editor?.generated?.geography?.cells[target.id].country).not.toBe(
    destination.id,
  );
  await page.getByRole('button', { name: '填充选中区域', exact: true }).click();
  await expect
    .poll(async () => (await map(request)).editor?.generated?.geography?.cells[target.id].country)
    .toBe(destination.id);
  await page
    .locator('.geography-panel')
    .getByRole('button', { name: '平移地图', exact: true })
    .click();
  const changed = (await map(request)).editor!.generated!.geography!;
  const border = changed.borders.find(
    (edge) =>
      edge.kind === 'cell' &&
      changed.cells[edge.cells[0]]?.land &&
      changed.cells[edge.cells[1]]?.land &&
      edge.points.every(
        (point) => point.x > 150 && point.x < 1050 && point.y > 100 && point.y < 700,
      ) &&
      Math.hypot(
        edge.points[0].x - edge.points.at(-1)!.x,
        edge.points[0].y - edge.points.at(-1)!.y,
      ) > 20,
  )!;
  expect(border).toBeTruthy();
  await page.getByRole('button', { name: '兵棋推演', exact: true }).click();
  await page.locator('[data-layer-button="regions"]').click();
  await page.getByRole('button', { name: '前线', exact: true }).click();
  await draw(page, border.points);
  await expect
    .poll(
      async () =>
        (await map(request)).editor?.military?.filter((line) => line.kind === 'front').length,
    )
    .toBe(1);
  const front = (await map(request)).editor!.military!.find((line) => line.kind === 'front')!;
  expect(front.points.length).toBeGreaterThan(1);
  const availableEdges = changed.borders.filter(
    (edge) =>
      edge.kind === 'cell' &&
      changed.cells[edge.cells[0]]?.land &&
      changed.cells[edge.cells[1]]?.land,
  );
  for (let i = 1; i < front.points.length; i++) {
    const midpoint = {
      x: (front.points[i - 1].x + front.points[i].x) / 2,
      y: (front.points[i - 1].y + front.points[i].y) / 2,
    };
    expect(
      availableEdges.some((edge) =>
        edge.points
          .slice(1)
          .some((point, index) => distanceToSegment(midpoint, edge.points[index], point) < 0.1),
      ),
    ).toBeTruthy();
  }
  await page.getByRole('button', { name: '进攻线', exact: true }).click();
  await draw(page, [
    { x: 430, y: 475 },
    { x: 490, y: 430 },
    { x: 540, y: 455 },
    { x: 590, y: 390 },
  ]);
  await expect.poll(async () => (await map(request)).editor?.military?.length).toBe(2);
  const saved = await map(request),
    count = await requests(page);
  expect(
    saved.editor?.military?.find((line) => line.kind === 'advance')?.points.length,
  ).toBeGreaterThan(3);
  await page.locator('[data-layer-button="countries"]').click();
  await expect(page.locator('[data-military-line]')).toHaveCount(2);
  await page.screenshot({ path: '.runtime/geographic-fronts-desktop.png' });
  expect(await requests(page)).toBe(count);
  await page.reload();
  await openAtlas(page);
  await expect(page.locator('[data-military-line]')).toHaveCount(2);
  expect((await map(request)).editor?.military).toEqual(saved.editor?.military);
  expect((await map(request)).editor?.generated?.geography?.cells[target.id].country).toBe(
    destination.id,
  );
  expect(await requests(page)).toBe(0);
});
