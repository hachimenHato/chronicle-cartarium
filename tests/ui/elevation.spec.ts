import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { AtlasMap, WorkspaceEnvelope } from '../../shared/model';
import type { ElevationSettings } from '../../shared/cartography';
import { createEditorFixture } from '../fixtures/map-editor';
import { validateWorkspace } from '../../server/validation';
import { generateSketchMap } from '../../src/lib/sketch-generation';
import { generationSignature, matchesGenerationSignature } from '../../src/lib/generated-map';

const expectSaved = expect.configure({ timeout: 30000 });

// This suite only writes the fresh DemoStore started by Playwright on port 3311.
async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace', { maxRetries: 2 });
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const result = (await response.json()) as WorkspaceEnvelope;
  expect(result.mode).toBe('demo');
  return result;
}

function settings(map: AtlasMap): ElevationSettings | undefined {
  return map.editor?.generation?.version === 2 ? map.editor.generation.elevation : undefined;
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('.atlas-canvas [data-map-viewport]').evaluate(
    (element, point) => {
      const transformed = new DOMPoint(point.x, point.y).matrixTransform(
        (element as SVGGElement).getScreenCTM()!,
      );
      return { x: transformed.x, y: transformed.y };
    },
    { x, y },
  );
}

async function ready(page: Page) {
  const composite = page.locator('.atlas-canvas [data-terrain-composite]');
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  return composite;
}

async function savedWorkspace(page: Page, request: APIRequestContext) {
  await ready(page);
  await expectSaved
    .poll(async () => {
      const map = (await workspace(request)).data.maps[0],
        editor = map.editor!;
      if (!editor.generation) return 'accepted';
      return matchesGenerationSignature(
        editor.generated?.signature,
        editor.regions,
        map.width,
        map.height,
        editor.generation,
        map.scaleKm,
        map.kind,
      )
        ? 'accepted'
        : JSON.stringify({
            seed: editor.generation.seed,
            saved: editor.generated?.signature,
            expected: generationSignature(
              editor.regions,
              map.width,
              map.height,
              editor.generation,
              map.scaleKm,
              map.kind,
            ),
          });
    })
    .toBe('accepted');
  await expect(page.locator('.save-status')).toHaveText('所有更改已保存', { timeout: 30000 });
  return workspace(request);
}

async function geometry(page: Page) {
  return page.locator('.atlas-canvas [data-terrain-composite]').evaluate(async (element) => {
    const records = [...element.querySelectorAll(':scope > g[fill][stroke] path')].map((path) => [
      path.getAttribute('d'),
      path.getAttribute('fill'),
      path.getAttribute('stroke'),
      path.parentElement?.getAttribute('fill'),
      path.parentElement?.getAttribute('stroke'),
    ]);
    // Hash every complete record, retaining strict geometry comparison without
    // asking the test runner to diff megabytes of SVG when a contour changes.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(records)),
    );
    return {
      nodes: records.length,
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
        '',
      ),
    };
  });
}

async function drag(page: Page, from: [number, number], to: [number, number], release = true) {
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const a = await screenPoint(page, ...from),
    b = await screenPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  if (release) await page.mouse.up();
}

test.beforeEach(async ({ request }) => {
  const current = await workspace(request);
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
      regions: [],
      objects: [{ ...createEditorFixture().objects[2], visible: true, color: '#b1239a' }],
      generation: {
        version: 2,
        detail: 'standard',
        linework: 'organic',
        seed: 2147,
        climate: 'temperate',
        rivers: true,
        routes: true,
        settlements: 5,
      },
    },
  };
  const response = await request.put('/api/workspace', {
    data: { data, revision: current.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});

test('elevation templates, brush previews, undo, refresh and standalone height SVG preserve authored content', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = (await workspace(request)).data;
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '海拔', exact: true }).click();
  await page.getByLabel('海拔模板', { exact: true }).selectOption('continent');
  await page.getByRole('button', { name: '生成海拔地形', exact: true }).click();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0]))
    .toMatchObject({
      version: 1,
      preset: 'continent',
      seed: 2147,
      relief: 1,
      seaLevel: 0,
      strokes: [],
    });
  const composite = await ready(page);
  await savedWorkspace(page, request);
  await expect(composite).toHaveAttribute('data-terrain-view', 'elevation');
  await expect(page.locator('.atlas-canvas [data-elevation-legend]')).toHaveCount(1);
  expect(Number(await composite.getAttribute('data-elevation-min'))).toBeLessThan(0);
  expect(Number(await composite.getAttribute('data-elevation-max'))).toBeGreaterThan(500);
  const generatedGeometry = await geometry(page);
  expect(generatedGeometry.nodes).toBeGreaterThan(10);
  expect((await workspace(request)).data.maps[0].editor?.regions).toEqual([]);

  // Editing level is an explicit persisted choice, independent of the local brush.
  await page.getByRole('button', { name: /智能塑形/ }).click();
  await page.getByRole('button', { name: '抬高海拔', exact: true }).click();
  await page.getByRole('slider', { name: '海拔笔刷直径', exact: true }).fill('210');
  await page.getByRole('slider', { name: '海拔笔刷强度', exact: true }).fill('0.9');
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.mode)
    .toBe('sculpt');
  const beforeDrag = await savedWorkspace(page, request);
  let previewWrites = 0;
  const countWrites = (response: { request(): { method(): string }; url(): string }) => {
    if (response.request().method() === 'PUT' && response.url().endsWith('/api/workspace'))
      previewWrites++;
  };
  page.on('response', countWrites);
  await drag(page, [390, 300], [590, 315], false);
  await expect.poll(() => geometry(page), { timeout: 30000 }).not.toEqual(generatedGeometry);
  await ready(page);
  // Keep the pointer held beyond the autosave delay: derived previews must not
  // be mistaken for a committed stroke by the save queue.
  await page.waitForTimeout(800);
  expect(await workspace(request)).toEqual(beforeDrag);
  expect(previewWrites).toBe(0);
  page.off('response', countWrites);
  await page.mouse.up();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0])?.strokes.length)
    .toBe(1);
  await ready(page);
  const raisedMap = (await savedWorkspace(page, request)).data.maps[0];
  const raisedGeometry = await geometry(page);
  expect(settings(raisedMap)?.strokes[0]).toMatchObject({
    operation: 'raise',
    width: 210,
    strength: 0.9,
  });
  expect(settings(raisedMap)!.strokes[0].points.length).toBeGreaterThan(1);
  expect(raisedGeometry).not.toEqual(generatedGeometry);

  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0])?.strokes.length)
    .toBe(0);
  await ready(page);
  expect(await geometry(page)).toEqual(generatedGeometry);
  await page.getByRole('button', { name: '重做地图编辑', exact: true }).click();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0]))
    .toEqual(settings(raisedMap));
  await ready(page);
  expect(await geometry(page)).toEqual(raisedGeometry);

  const beforeCancel = await savedWorkspace(page, request);
  await drag(page, [570, 370], [700, 390], false);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await ready(page);
  expect(await geometry(page)).toEqual(raisedGeometry);
  expect(await workspace(request)).toEqual(beforeCancel);

  for (const [index, brush] of ['降低海拔', '定高海拔', '平滑海拔'].entries()) {
    await page.getByRole('button', { name: brush, exact: true }).click();
    if (brush === '定高海拔') {
      await page.getByRole('spinbutton', { name: '目标海拔（米）', exact: true }).fill('1200');
      await page.getByRole('spinbutton', { name: '目标海拔（米）', exact: true }).press('Enter');
    }
    await drag(page, [400 + index * 45, 360], [525 + index * 45, 380]);
    await expectSaved
      .poll(async () => settings((await workspace(request)).data.maps[0])?.strokes.length)
      .toBe(index + 2);
    await ready(page);
  }
  const edited = (await savedWorkspace(page, request)).data.maps[0];
  expect(settings(edited)?.strokes.map((stroke) => stroke.operation)).toEqual([
    'raise',
    'lower',
    'flatten',
    'smooth',
  ]);
  expect(settings(edited)?.strokes[2].target).toBe(1200);
  expect(edited.editor?.regions).toEqual(initial.maps[0].editor?.regions);
  expect(edited.editor?.objects).toEqual(initial.maps[0].editor?.objects);
  expect(edited.strokes).toEqual(initial.maps[0].strokes);
  const editedGeometry = await geometry(page);
  await page.mouse.move(20, 20);
  await page.locator('.atlas-canvas').screenshot({ path: '.runtime/elevation-edited.png' });

  await page.getByRole('button', { name: '清除海拔笔划', exact: true }).click();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0])?.strokes)
    .toEqual([]);
  await ready(page);
  expect(await geometry(page)).toEqual(generatedGeometry);
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0]))
    .toEqual(settings(edited));
  await ready(page);
  expect(await geometry(page)).toEqual(editedGeometry);

  // Global settings also retain the ordered local edits and have one undo step.
  const minBeforeSeaLevel = Number(await composite.getAttribute('data-elevation-min'));
  await page.locator('summary', { hasText: '整体地势与海平面' }).click();
  await page.getByRole('slider', { name: '海平面偏移', exact: true }).fill('250');
  await page.getByRole('slider', { name: '海平面偏移', exact: true }).press('Tab');
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0])?.seaLevel)
    .toBe(250);
  await ready(page);
  expect(Number(await composite.getAttribute('data-elevation-min'))).toBeCloseTo(
    minBeforeSeaLevel - 250,
    1,
  );
  expect(settings((await workspace(request)).data.maps[0])?.strokes).toEqual(
    settings(edited)?.strokes,
  );
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0]))
    .toEqual(settings(edited));
  await ready(page);
  expect(await geometry(page)).toEqual(editedGeometry);

  const beforeView = await savedWorkspace(page, request);
  await page.getByRole('button', { name: '地形', exact: true }).click();
  await ready(page);
  await expect(composite).toHaveAttribute('data-terrain-view', 'atlas');
  await expect(page.locator('.atlas-canvas [data-map-paper="parchment"]')).toHaveCount(1);
  await expect(page.locator('.atlas-canvas [data-elevation-legend]')).toHaveCount(0);
  await expect(page.locator('.atlas-canvas [data-map-object="test_text"]')).toHaveAttribute(
    'fill',
    '#b1239a',
  );
  expect(await geometry(page)).not.toEqual(editedGeometry);
  expect(await workspace(request)).toEqual(beforeView);
  await page.locator('.atlas-canvas').screenshot({ path: '.runtime/elevation-classical.png' });

  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '海拔', exact: true }).click();
  await ready(page);
  await savedWorkspace(page, request);
  expect(await geometry(page)).toEqual(editedGeometry);
  expect((await workspace(request)).data.maps[0].editor).toEqual(edited.editor);
  expect((await workspace(request)).data.maps[1]).toEqual(initial.maps[1]);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  await (await downloading).saveAs('.runtime/elevation-export.svg');
  const svg = await readFile('.runtime/elevation-export.svg', 'utf8');
  expect(svg).toContain('data-terrain-view="elevation"');
  expect(svg).toContain('data-elevation-legend="true"');
  expect(svg).toContain('海拔（米）');
  expect(svg).not.toContain('data-editor-overlay');
  expect(svg).not.toContain('NaN');
  const standalone = await page.context().newPage();
  await standalone.route('**/elevation-export.svg', (route) =>
    route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg }),
  );
  await standalone.goto('http://127.0.0.1:3311/elevation-export.svg');
  await expect(standalone.locator('parsererror')).toHaveCount(0);
  await expect(standalone.locator('[data-elevation-legend]')).toHaveCount(1);
  expect(await standalone.locator('[data-map-viewport]').getAttribute('transform')).toBeNull();
  await standalone.screenshot({ path: '.runtime/elevation-standalone.png' });
  await standalone.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: '.runtime/elevation-mobile.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('enabling elevation on a saved v1 map is explicit and reversible', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const current = await workspace(request);
  const data = current.data;
  const sourceMap = data.maps[0];
  sourceMap.editor!.regions = [
    {
      id: 'height_land',
      name: '原有陆地',
      biome: 'grass',
      geometry: 'brush',
      points: [
        { x: 280, y: 320 },
        { x: 720, y: 320 },
      ],
      width: 320,
      seed: 112,
      roughness: 0.3,
      density: 0.4,
      visible: true,
      locked: false,
    },
  ];
  sourceMap.editor!.generation = {
    version: 1,
    seed: 2147,
    climate: 'temperate',
    rivers: true,
    routes: true,
    settlements: 4,
  };
  // A saved map already has its accepted V1 output. Otherwise opening this
  // fixture legitimately creates its first cache and invalidates no-write checks.
  const normalized = validateWorkspace(data),
    normalizedMap = normalized.maps[0],
    editor = normalizedMap.editor!,
    output = generateSketchMap(
      editor.regions,
      normalizedMap.width,
      normalizedMap.height,
      editor.generation!,
      normalizedMap.scaleKm,
      normalizedMap.kind,
    );
  editor.generated = {
    version: 1,
    signature: generationSignature(
      editor.regions,
      normalizedMap.width,
      normalizedMap.height,
      editor.generation,
      normalizedMap.scaleKm,
      normalizedMap.kind,
    ),
    objects: output.objects,
    stats: output.stats,
    ...(output.sites ? { sites: output.sites } : {}),
  };
  const savedData = validateWorkspace(normalized),
    map = savedData.maps[0];
  // The recipe hash uses the authoritative normalized field ordering.
  map.editor!.generated!.signature = generationSignature(
    map.editor!.regions,
    map.width,
    map.height,
    map.editor!.generation,
    map.scaleKm,
    map.kind,
  );
  const response = await request.put('/api/workspace', {
    data: { data: savedData, revision: current.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await ready(page);
  await savedWorkspace(page, request);
  const original = await geometry(page);
  expect((await workspace(request)).data.maps[0]).toEqual(map);
  const beforeSwitch = await savedWorkspace(page, request);
  await page.getByRole('button', { name: '海拔', exact: true }).click();
  await expect(page.getByRole('region', { name: '色块地图生成', exact: true })).toHaveCount(0);
  await expect(page.getByLabel('海拔模板', { exact: true })).toBeVisible();
  await page.waitForTimeout(850);
  expect(await workspace(request)).toEqual(beforeSwitch);
  await page.getByRole('button', { name: '升级并启用海拔', exact: true }).click();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0]))
    .toMatchObject({ preset: 'sketch', strokes: [] });
  await ready(page);
  const upgraded = (await workspace(request)).data.maps[0];
  expect(upgraded.editor?.generation).toMatchObject({
    version: 2,
    detail: 'high',
    linework: 'organic',
  });
  expect(upgraded.editor?.regions).toEqual(map.editor?.regions);
  expect(upgraded.editor?.objects).toEqual(map.editor?.objects);
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor)
    .toEqual(map.editor);
  await page.getByRole('button', { name: '地形', exact: true }).click();
  await ready(page);
  expect(await geometry(page)).toEqual(original);
  expect((await workspace(request)).data.maps[1]).toEqual(data.maps[1]);
});

test('terrain and elevation pages share brush diameter while switching only changes local tools', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const current = await workspace(request);
  current.data.maps[0].editor!.mode = 'sculpt';
  delete current.data.maps[0].editor!.generation;
  const response = await request.put('/api/workspace', {
    data: { data: current.data, revision: current.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const untouchedMap = current.data.maps[1];
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();

  const terrainTab = page.getByRole('button', { name: '地形', exact: true });
  const elevationTab = page.getByRole('button', { name: '海拔', exact: true });
  const generationPanel = page.getByRole('region', { name: '色块地图生成', exact: true });
  const terrainDiameter = page.getByRole('slider', { name: '地形笔刷大小', exact: true });
  const elevationDiameter = page.getByRole('slider', { name: '海拔笔刷直径', exact: true });
  const elevationTemplate = page.getByLabel('海拔模板', { exact: true });
  await expect(terrainTab).toHaveAttribute('aria-pressed', 'true');
  await expect(generationPanel).toBeVisible();
  await expect(elevationTemplate).toHaveCount(0);
  await expect(page.getByRole('button', { name: '抬高海拔', exact: true })).toHaveCount(0);

  // Tool choices and brush sizing must not write an empty map or reset diameter.
  const beforeTools = await savedWorkspace(page, request);
  let writes = 0;
  page.on('request', (request) => {
    if (request.method() === 'PUT' && request.url().endsWith('/api/workspace')) writes++;
  });
  await terrainDiameter.fill('280');
  for (const biome of ['山地', '森林', '水域', '草原']) {
    await page.getByRole('button', { name: biome, exact: true }).click();
    await expect(terrainDiameter).toHaveValue('280');
  }
  await elevationTab.click();
  await expect(elevationTab).toHaveAttribute('aria-pressed', 'true');
  await expect(generationPanel).toHaveCount(0);
  await expect(elevationTemplate).toBeVisible();
  await expect(page.getByRole('button', { name: '草原', exact: true })).toHaveCount(0);
  await expect(terrainDiameter).toHaveCount(0);
  await terrainTab.click();
  await expect(generationPanel).toBeVisible();
  await expect(elevationTemplate).toHaveCount(0);
  await expect(terrainDiameter).toHaveValue('280');
  await expect(page.getByRole('button', { name: '草原', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.waitForTimeout(850);
  expect(await workspace(request)).toEqual(beforeTools);
  expect(writes).toBe(0);

  await drag(page, [310, 320], [660, 330]);
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(1);
  await page.getByRole('button', { name: '山地', exact: true }).click();
  await expect(terrainDiameter).toHaveValue('280');
  await drag(page, [430, 260], [555, 295]);
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(2);
  const sourceMap = (await savedWorkspace(page, request)).data.maps[0];
  expect(sourceMap.editor?.regions.map(({ biome, width }) => ({ biome, width }))).toEqual([
    { biome: 'grass', width: 280 },
    { biome: 'mountain', width: 280 },
  ]);

  await elevationTab.click();
  await page.getByRole('button', { name: '启用海拔编辑', exact: true }).click();
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0]))
    .toMatchObject({ preset: 'sketch', strokes: [] });
  await ready(page);
  await expect(elevationDiameter).toHaveValue('280');
  await elevationDiameter.fill('360');
  for (const brush of ['降低海拔', '定高海拔', '平滑海拔', '抬高海拔']) {
    await page.getByRole('button', { name: brush, exact: true }).click();
    await expect(elevationDiameter).toHaveValue('360');
  }
  await drag(page, [400, 330], [570, 345]);
  await expectSaved
    .poll(async () => settings((await workspace(request)).data.maps[0])?.strokes.length)
    .toBe(1);
  await ready(page);
  const raised = await savedWorkspace(page, request);
  expect(settings(raised.data.maps[0])?.strokes[0]).toMatchObject({
    width: 360,
    operation: 'raise',
  });
  await page.screenshot({ path: '.runtime/elevation-tools-tab.png' });

  writes = 0;
  await terrainTab.click();
  await expect(generationPanel).toBeVisible();
  await expect(elevationTemplate).toHaveCount(0);
  await expect(elevationDiameter).toHaveCount(0);
  await expect(terrainDiameter).toHaveValue('360');
  await expect(page.getByRole('button', { name: '山地', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(terrainDiameter).toHaveAttribute('max', '500');
  await terrainDiameter.fill('500');
  await elevationTab.click();
  await expect(elevationDiameter).toHaveValue('500');
  await expect(elevationDiameter).toHaveAttribute('min', '5');
  await page.keyboard.press(']');
  await expect(elevationDiameter).toHaveValue('500');
  await elevationDiameter.fill('5');
  await terrainTab.click();
  await expect(terrainDiameter).toHaveValue('5');
  await page.keyboard.press('[');
  await expect(terrainDiameter).toHaveValue('5');
  await terrainDiameter.fill('360');
  await ready(page);
  await page.waitForTimeout(850);
  expect(await workspace(request)).toEqual(raised);
  expect(writes).toBe(0);
  await page.screenshot({ path: '.runtime/terrain-tools-tab.png' });

  // Returning from the elevation page must activate the visible terrain brush.
  await drag(page, [560, 345], [670, 360]);
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(3);
  const final = (await savedWorkspace(page, request)).data;
  expect(final.maps[0].editor?.regions.at(-1)).toMatchObject({ biome: 'mountain', width: 360 });
  expect(final.maps[0].editor?.regions.slice(0, 2)).toEqual(sourceMap.editor?.regions);
  expect(settings(final.maps[0])).toEqual(settings(raised.data.maps[0]));
  expect(final.maps[0].editor?.objects).toEqual(sourceMap.editor?.objects);
  expect(final.maps[1]).toEqual(untouchedMap);
});
