import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { AtlasMap, WorkspaceEnvelope } from '../../shared/model';
import { createEditorFixture } from '../fixtures/map-editor';
import { generationSignature } from '../../src/lib/generated-map';

test.use({ actionTimeout: 15000 });
const expectSaved = expect.configure({ timeout: 30000 });

/** Match JSON object semantics: key order is irrelevant, array order is retained. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
function digest(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)) ?? 'undefined')
    .digest('hex');
}
function sameContent(actual: unknown, expected: unknown, message: string) {
  expect(digest(actual), message).toBe(digest(expected));
}
function mapState(map: AtlasMap) {
  const recipe = map.editor?.generation;
  return {
    version: recipe?.version,
    seed: recipe?.seed,
    detail: recipe?.version === 2 ? recipe.detail : undefined,
    savedSignature: map.editor?.generated?.signature,
    recipeSignature: generationSignature(
      map.editor?.regions ?? [],
      map.width,
      map.height,
      recipe,
      map.scaleKm,
      map.kind,
    ),
  };
}
function sameWorkspace(actual: WorkspaceEnvelope, expected: WorkspaceEnvelope) {
  expect(actual.revision, 'display-only action must not change workspace revision').toBe(
    expected.revision,
  );
  expect(mapState(actual.data.maps[0]), 'recipe and accepted cache must remain unchanged').toEqual(
    mapState(expected.data.maps[0]),
  );
  sameContent(actual, expected, 'complete workspace JSON must remain unchanged');
}

// Playwright creates a fresh DemoStore on 3311. Never use the user's MySQL app here.
async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace', { maxRetries: 2 });
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}

async function acceptedWorkspace(page: Page, request: APIRequestContext) {
  const composite = page.locator('.atlas-canvas [data-terrain-composite="true"]');
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  await expect
    .poll(
      async () => {
        const state = mapState((await workspace(request)).data.maps[0]);
        return state.savedSignature === state.recipeSignature ? 'accepted' : JSON.stringify(state);
      },
      {
        timeout: 30000,
        message: 'wait for the saved snapshot to match the server-normalized recipe',
      },
    )
    .toBe('accepted');
  await expect(page.locator('.save-status')).toHaveText('所有更改已保存', { timeout: 30000 });
  const envelope = await workspace(request),
    state = mapState(envelope.data.maps[0]);
  expect(
    state.savedSignature,
    `accepted cache for seed ${state.seed}, detail ${state.detail}`,
  ).toBe(state.recipeSignature);
  return envelope;
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('.atlas-canvas > g').evaluate(
    (element, point) => {
      const result = new DOMPoint(point.x, point.y).matrixTransform(
        (element as SVGGElement).getScreenCTM()!,
      );
      return { x: result.x, y: result.y };
    },
    { x, y },
  );
}

async function draw(
  page: Page,
  biome: string,
  width: number,
  from: [number, number],
  to: [number, number],
) {
  await page.getByRole('button', { name: biome, exact: true }).click();
  await page.getByRole('slider', { name: '地形笔刷大小', exact: true }).fill(String(width));
  const a = await screenPoint(page, ...from);
  const b = await screenPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

async function geometry(page: Page) {
  return page.locator('.atlas-canvas [data-terrain-composite="true"]').evaluate(async (element) => {
    const records = [...element.querySelectorAll('path, g[transform], text')]
      .filter((node) => !node.closest('[data-editor-hit]'))
      .map((node) => [
        node.tagName,
        node.getAttribute('d'),
        node.getAttribute('transform'),
        node.getAttribute('fill'),
        node.tagName === 'text' ? node.textContent : null,
      ]);
    // Compare all complete SVG records, without a potentially blocking string
    // diff in the test runner when detailed artwork legitimately differs.
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
      regions: [],
      objects: [createEditorFixture().objects[2]],
    },
  };
  const response = await request.put('/api/workspace', {
    data: { data, revision: envelope.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});

test('painted sketch generates a persistent map, varies reversibly and exports its actual artwork', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const initial = (await workspace(request)).data.maps;
  const untouched = initial[1];
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.getByRole('button', { name: '从色块生成地图', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '第一步：画陆地', exact: true }).click();
  await draw(page, '草原', 320, [265, 300], [730, 315]);
  await draw(page, '草原', 280, [345, 390], [690, 405]);
  await draw(page, '山地', 95, [410, 225], [630, 275]);
  await draw(page, '森林', 125, [300, 345], [420, 390]);
  await draw(page, '水域', 70, [675, 390], [725, 400]);
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(5);
  const source = (await workspace(request)).data.maps[0].editor!.regions;
  const composite = page.locator('.atlas-canvas [data-terrain-composite="true"]');
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await page.mouse.move(20, 20);
  await page.screenshot({ path: '.runtime/sketch-source.png' });
  await page.locator('summary', { hasText: '气候与生成选项' }).click();
  await page.getByLabel('地图生成种子', { exact: true }).fill('2741');
  // V2 starts with five settlements; typed counts are edited in 地名与地点.
  // This scenario exercises the first sketch generation and its persisted artwork.
  await page.getByRole('button', { name: '从色块生成地图', exact: true }).click();
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toBeTruthy();
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  const saved = (await acceptedWorkspace(page, request)).data.maps[0];
  sameContent(saved.editor?.regions, source, 'generation preserves every source region');
  sameContent(
    saved.editor?.objects,
    initial[0].editor?.objects,
    'generation preserves authored objects',
  );
  expect(saved.editor?.generation?.seed).toBe(2741);
  expect(saved.editor?.generation?.settlements).toBe(5);
  expect(saved.editor?.generation).toMatchObject({
    version: 2,
    detail: 'high',
    linework: 'organic',
  });
  await expect(composite).toHaveAttribute('data-generation-rivers', /^[1-9]\d*$/);
  await expect(composite).toHaveAttribute('data-generation-settlements', /^[2-5]$/);
  await expect(composite).toHaveAttribute('data-generation-roads', /^[1-9]\d*$/);
  const firstGeometry = await geometry(page);
  expect(firstGeometry.nodes).toBeGreaterThan(30);
  await page.mouse.move(20, 20);
  await page.screenshot({ path: '.runtime/sketch-generated.png' });
  await page.locator('.atlas-canvas').screenshot({ path: '.runtime/sketch-refined-high.png' });

  // Compare exactly the same five authored strokes and seed at both sampling
  // levels. Only the persisted detail option changes; reverting reproduces it.
  await page.getByLabel('生成细节等级', { exact: true }).selectOption('ultra');
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toMatchObject({ version: 2, detail: 'ultra' });
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  await acceptedWorkspace(page, request);
  expect(await geometry(page)).not.toEqual(firstGeometry);
  sameContent(
    (await workspace(request)).data.maps[0].editor?.regions,
    source,
    'ultra detail preserves source regions',
  );
  await page.mouse.move(20, 20);
  await page.locator('.atlas-canvas').screenshot({ path: '.runtime/sketch-refined-ultra.png' });
  await page.getByLabel('生成细节等级', { exact: true }).selectOption('high');
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toEqual(saved.editor?.generation);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await acceptedWorkspace(page, request);
  expect(await geometry(page)).toEqual(firstGeometry);

  const beforePreview = await acceptedWorkspace(page, request);
  await page.getByRole('button', { name: '色块草稿', exact: true }).click();
  await expect(composite).toHaveAttribute('data-source-preview', 'true');
  await expect(page.getByRole('button', { name: '导出 SVG', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(page.getByRole('button', { name: '导出 SVG', exact: true })).toBeEnabled();
  sameWorkspace(await acceptedWorkspace(page, request), beforePreview);

  await page.getByRole('button', { name: '换一个生成变体', exact: true }).click();
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation?.seed)
    .not.toBe(saved.editor?.generation?.seed);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await acceptedWorkspace(page, request);
  expect(await geometry(page)).not.toEqual(firstGeometry);
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toEqual(saved.editor?.generation);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  const beforeReload = await acceptedWorkspace(page, request);
  expect(await geometry(page)).toEqual(firstGeometry);
  sameContent(
    beforeReload.data.maps[0],
    saved,
    'undoing the variant restores the complete saved map',
  );

  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  const reopened = await acceptedWorkspace(page, request);
  expect(await geometry(page)).toEqual(firstGeometry);
  sameWorkspace(reopened, beforeReload);
  sameContent(reopened.data.maps[0], saved, 'reload preserves the complete accepted map');
  sameContent(reopened.data.maps[1], untouched, 'reload leaves the other map untouched');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs('.runtime/sketch-generated.svg');
  const svg = await readFile('.runtime/sketch-generated.svg', 'utf8');
  expect(svg).toContain('data-terrain-composite="true"');
  expect(svg).not.toContain('data-editor-hit');
  expect(svg).not.toContain('data-editor-overlay');
  expect(svg).not.toContain('地形暂时无法合成');
  expect(svg).not.toContain('NaN');

  // Turning off the recipe restores editable source terrain without losing
  // hand-authored objects; undo restores the same generation recipe and artwork.
  await page.locator('summary', { hasText: '气候与生成选项' }).click();
  await page.getByRole('button', { name: '停止自动生成', exact: true }).click();
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toBeUndefined();
  const stopped = (await workspace(request)).data.maps[0];
  sameContent(stopped.editor?.regions, source, 'stopping generation preserves source regions');
  sameContent(
    stopped.editor?.objects,
    saved.editor?.objects,
    'stopping generation preserves authored objects',
  );
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toEqual(saved.editor?.generation);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 30000 });
  await acceptedWorkspace(page, request);
  expect(await geometry(page)).toEqual(firstGeometry);

  await page.getByRole('button', { name: /精细编辑/ }).click();
  await page.getByRole('button', { name: '将生成图转为可编辑组件', exact: true }).click();
  await page.getByRole('button', { name: '转换并精修', exact: true }).click();
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(0);
  const frozen = (await workspace(request)).data.maps[0];
  expect(frozen.editor?.generation).toBeUndefined();
  expect(frozen.editor!.objects.length).toBeGreaterThan(30);
  expect(frozen.editor!.objects.some((object) => object.name.startsWith('河流'))).toBe(true);
  expect(frozen.editor!.objects.some((object) => object.name.startsWith('聚落'))).toBe(true);
  sameContent(
    frozen.editor!.objects.find((object) => object.id === saved.editor!.objects[0].id),
    { ...saved.editor!.objects[0], layer: 'base' },
    'freezing preserves all fields of the authored base object',
  );
  sameContent(
    (await workspace(request)).data.maps[1],
    untouched,
    'freezing leaves the other map untouched',
  );
  const frozenDownloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  await (await frozenDownloadEvent).saveAs('.runtime/sketch-frozen.svg');
  expect(await readFile('.runtime/sketch-frozen.svg', 'utf8')).not.toContain('NaN');

  // Undo freezing and changing tier so the narrow viewport exercises the live
  // generation controls, not only an ordinary map with flattened artwork.
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expectSaved
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toEqual(saved.editor?.generation);
  await expect(page.getByText('生成结果已转为独立组件', { exact: false })).toHaveCount(0);
  await acceptedWorkspace(page, request);
  await page.getByRole('button', { name: /快速生成/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  const generationPanel = page.getByRole('region', { name: '色块地图生成', exact: true });
  await generationPanel.scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: '生成预览', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const panelBounds = await generationPanel.boundingBox();
  expect(panelBounds).toBeTruthy();
  expect(panelBounds!.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '.runtime/sketch-mobile.png' });
  expect(errors).toEqual([]);
});
