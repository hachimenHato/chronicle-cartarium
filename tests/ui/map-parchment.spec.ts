import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';
import type { MapRegion } from '../../shared/cartography';
import { parchmentSea } from '../../src/lib/map-palette';
import { generateSketchMap } from '../../src/lib/sketch-generation';
import { generationSignature, snapshotElevation } from '../../src/lib/generated-map';
import { validateWorkspace } from '../../server/validation';

async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const value = (await response.json()) as WorkspaceEnvelope;
  expect(value.mode).toBe('demo');
  return value;
}
const region = (
  id: string,
  biome: MapRegion['biome'],
  points: [number, number][],
  width: number,
): MapRegion => ({
  id,
  name: id,
  biome,
  geometry: 'brush',
  points: points.map(([x, y]) => ({ x, y })),
  width,
  seed: 527,
  roughness: 0.35,
  density: 0.55,
  visible: true,
  locked: false,
});
async function paint(objects: Locator) {
  return objects.evaluateAll((nodes) =>
    nodes.map((node) => ({
      fill: node.getAttribute('fill'),
      stroke: node.getAttribute('stroke'),
      width: node.getAttribute('stroke-width'),
      opacity: node.getAttribute('opacity'),
      paths: [...node.querySelectorAll('path')].map((path) => path.getAttribute('d')),
      text: [...node.querySelectorAll('text')].map((text) => text.textContent),
      transforms: [...node.querySelectorAll('[transform]')].map((item) =>
        item.getAttribute('transform'),
      ),
    })),
  );
}
async function downloadSvg(page: Page, path: string) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  await (await downloading).saveAs(path);
  return readFile(path, 'utf8');
}

test('parchment survives overview, editing, freezing and standalone SVG without changing authored colors', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const state = window as unknown as { __parchmentGenerationJobs: number };
    state.__parchmentGenerationJobs = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      const value = message as { generation?: unknown; signature?: unknown };
      if (value?.generation && typeof value.signature === 'string')
        state.__parchmentGenerationJobs++;
      return Reflect.apply(original, this, [message, ...args]);
    };
  });
  const current = await workspace(request),
    data = createSeed();
  const featured = data.maps[0];
  featured.seed = 0;
  featured.width = 1000;
  featured.height = 640;
  featured.pins = [];
  featured.strokes = [
    {
      id: 'paper_authored_ink',
      tool: 'brush',
      color: '#578c99',
      width: 5,
      points: [
        { x: 120, y: 520 },
        { x: 250, y: 525 },
      ],
    },
  ];
  featured.editor = {
    version: 1,
    mode: 'sculpt',
    baseVisible: false,
    regions: [
      region(
        'paper_land',
        'grass',
        [
          [270, 310],
          [730, 310],
        ],
        350,
      ),
      region(
        'paper_ridge',
        'mountain',
        [
          [470, 215],
          [600, 260],
        ],
        105,
      ),
      region(
        'paper_woods',
        'forest',
        [
          [330, 340],
          [455, 375],
        ],
        145,
      ),
      region(
        'paper_lake',
        'water',
        [
          [675, 385],
          [710, 390],
        ],
        65,
      ),
    ],
    generation: {
      version: 1,
      seed: 471,
      climate: 'temperate',
      rivers: true,
      routes: true,
      settlements: 5,
    },
    objects: [
      {
        id: 'paper_authored_text',
        name: '自选颜色',
        kind: 'text',
        points: [{ x: 350, y: 500 }],
        text: '作者原色',
        color: '#abc8c9',
        stroke: '#96b8af',
        strokeWidth: 0.5,
        size: 20,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
      },
    ],
  };
  // Opening an accepted map must render the saved result, without silently adding
  // a first-generation cache to an otherwise unchanged, old V1 source fixture.
  const normalized = validateWorkspace(data),
    acceptedMap = normalized.maps[0],
    acceptedEditor = acceptedMap.editor!,
    output = generateSketchMap(
      acceptedEditor.regions,
      acceptedMap.width,
      acceptedMap.height,
      acceptedEditor.generation!,
      acceptedMap.scaleKm,
      acceptedMap.kind,
    );
  acceptedEditor.generated = {
    version: 1,
    signature: generationSignature(
      acceptedEditor.regions,
      acceptedMap.width,
      acceptedMap.height,
      acceptedEditor.generation,
      acceptedMap.scaleKm,
      acceptedMap.kind,
    ),
    objects: output.objects,
    stats: output.stats,
    sites: output.sites,
    geography: output.geography,
    elevation: output.elevation && snapshotElevation(output.elevation),
  };
  const savedData = validateWorkspace(normalized),
    savedMap = savedData.maps[0];
  // Validation normalizes object-key order used by the generation recipe hash.
  savedMap.editor!.generated!.signature = generationSignature(
    savedMap.editor!.regions,
    savedMap.width,
    savedMap.height,
    savedMap.editor!.generation,
    savedMap.scaleKm,
    savedMap.kind,
  );
  const saved = await request.put('/api/workspace', {
    data: { data: savedData, revision: current.revision },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const acceptedRevision = (await workspace(request)).revision;
  await page.goto('/');
  await page.getByRole('button', { name: '世界总览', exact: true }).click();
  const overview = page.locator('.map-preview > svg');
  await expect(overview.locator('[data-map-paper="parchment"]')).toHaveCount(1);
  await expect(overview.locator('feTurbulence')).toHaveCount(2);
  await expect(overview.locator('[data-terrain-composite]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
    { timeout: 30000 },
  );
  await expect(overview.locator('path[stroke="#578c99"]')).toHaveCount(1);
  await overview.screenshot({ path: '.runtime/parchment-overview.png', animations: 'disabled' });

  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  const canvas = page.locator('.atlas-canvas');
  const composite = canvas.locator('[data-terrain-composite]');
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  await expect(canvas.locator('[data-map-paper="parchment"]')).toHaveCount(1);
  const manual = canvas.locator('[data-map-object="paper_authored_text"]');
  await expect(manual).toHaveAttribute('fill', '#abc8c9');
  await expect(manual).toHaveAttribute('stroke', '#96b8af');
  const before = await paint(composite.locator(':scope > g[fill][stroke]'));
  expect(before.length).toBeGreaterThan(30);
  expect(before[0].fill).toBe(parchmentSea);
  expect((await workspace(request)).data).toEqual(savedData);
  expect((await workspace(request)).revision).toBe(acceptedRevision);
  expect(
    await page.evaluate(
      () => (window as unknown as { __parchmentGenerationJobs: number }).__parchmentGenerationJobs,
    ),
  ).toBe(0);
  await canvas.screenshot({ path: '.runtime/parchment-live.png', animations: 'disabled' });

  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false');
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  expect((await workspace(request)).data).toEqual(savedData);
  expect((await workspace(request)).revision).toBe(acceptedRevision);
  expect(
    await page.evaluate(
      () => (window as unknown as { __parchmentGenerationJobs: number }).__parchmentGenerationJobs,
    ),
  ).toBe(0);

  // A zoomed canvas must still export the complete map; decorative transforms
  // in paper defs or compass groups must remain intact.
  await page.getByRole('button', { name: '放大地图', exact: true }).click();
  await expect(canvas.locator('[data-map-viewport]')).toHaveAttribute('transform', /scale\(1\.2\)/);
  const svg = await downloadSvg(page, '.runtime/parchment-live.svg');
  expect(svg).toContain('data-map-paper="parchment"');
  expect(svg).not.toContain('data-editor-overlay');
  expect(svg).not.toContain('data-editor-hit');
  expect(svg).not.toContain('NaN');
  const standalone = await page.context().newPage();
  await standalone.route('**/parchment-export.svg', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: svg,
    }),
  );
  await standalone.goto('http://127.0.0.1:3311/parchment-export.svg');
  await expect(standalone.locator('parsererror')).toHaveCount(0);
  await expect(standalone.locator('svg')).toHaveAttribute('width', '1000');
  await expect(standalone.locator('[data-map-paper="parchment"]')).toHaveCount(1);
  await expect(standalone.locator('feTurbulence')).toHaveCount(2);
  expect(await standalone.locator('[data-map-viewport]').getAttribute('transform')).toBeNull();
  const missingReferences = await standalone.evaluate(() => {
    const ids = new Set([...document.querySelectorAll('[id]')].map((node) => node.id));
    return [...document.querySelectorAll('*')]
      .flatMap((node) =>
        [...node.attributes].flatMap((attribute) =>
          [...attribute.value.matchAll(/url\(#([^)]*)\)/g)].map((match) => match[1]),
        ),
      )
      .filter((id) => !ids.has(id));
  });
  expect(missingReferences).toEqual([]);
  await standalone.screenshot({
    path: '.runtime/parchment-standalone.png',
    animations: 'disabled',
  });
  await standalone.close();

  await page.getByRole('button', { name: /精细编辑/ }).click();
  await page.getByRole('button', { name: '将生成图转为可编辑组件', exact: true }).click();
  await page.getByRole('button', { name: '转换并精修', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(0);
  const frozen = (await workspace(request)).data.maps[0];
  expect(frozen.editor?.generation).toBeUndefined();
  expect(frozen.strokes).toHaveLength(0);
  expect(frozen.editor?.objects.find((object) => object.id === 'paper_authored_text')).toEqual({
    ...featured.editor.objects[0],
    layer: 'base',
  });
  expect(frozen.editor?.objects.at(-1)?.stroke).toBe('#578c99');
  expect((await paint(canvas.locator('[data-map-object]'))).slice(0, before.length)).toEqual(
    before,
  );
  await expect(canvas.locator('[data-map-paper="parchment"]')).toHaveCount(1);
  const frozenSvg = await downloadSvg(page, '.runtime/parchment-frozen.svg');
  expect(frozenSvg).toContain('data-map-paper="parchment"');
  expect(frozenSvg).toContain('feTurbulence');
  expect((await workspace(request)).data.maps[1]).toEqual(data.maps[1]);

  await page.setViewportSize({ width: 390, height: 844 });
  await canvas.scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: '.runtime/parchment-mobile.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});
