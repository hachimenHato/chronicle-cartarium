import { writeFile } from 'node:fs/promises';
import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';
import { createEditorFixture } from '../fixtures/map-editor';
import type { MapPoint, MapRegion } from '../../shared/cartography';

async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}
async function point(page: Page, x: number, y: number) {
  return page.locator('.atlas-canvas [data-map-viewport]').evaluate(
    (g, p) => {
      const at = new DOMPoint(p.x, p.y).matrixTransform((g as SVGGElement).getScreenCTM()!);
      return { x: at.x, y: at.y };
    },
    { x, y },
  );
}
async function draw(page: Page, points: [number, number][]) {
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  const a = await point(page, ...points[0]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const p of points.slice(1)) {
    const b = await point(page, ...p);
    await page.mouse.move(b.x, b.y, { steps: 8 });
  }
  await page.mouse.up();
}
test('source brush stays lightweight with a large saved scene, supports diameter 5 and commits latest samples', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const current = await workspace(request),
    data = createSeed(),
    template = createEditorFixture();
  const regions: MapRegion[] = Array.from({ length: 100 }, (_, i) => ({
    ...template.regions[0],
    id: `source-${i}`,
    biome: i % 3 ? 'grass' : 'forest',
    geometry: 'brush',
    width: 25,
    points: Array.from({ length: 160 }, (_, j) => ({
      x: 140 + j * 4,
      y: 140 + i * 3 + Math.sin(j / 8) * 12,
    })),
  }));
  data.maps[0] = {
    ...data.maps[0],
    seed: 0,
    pins: [],
    strokes: [],
    editor: {
      ...template,
      mode: 'sketch',
      regions,
      objects: Array.from({ length: 1500 }, (_, i) => ({
        ...template.objects[0],
        id: `object-${i}`,
        blur: 2,
        locked: false,
        points: [{ x: 100 + (i % 50) * 15, y: 100 + Math.floor(i / 50) * 12 }],
      })),
    },
  };
  const saved = await request.put('/api/workspace', { data: { data, revision: current.revision } });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.addInitScript(() => {
    const original = window.Worker;
    const state = { active: 0, created: 0 };
    Object.assign(window, { terrainWorkers: state });
    window.Worker = class extends original {
      stopped = false;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        state.active++;
        state.created++;
      }
      terminate() {
        if (!this.stopped) {
          state.active--;
          this.stopped = true;
        }
        super.terminate();
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '色块草稿', exact: true }).click();
  await expect(page.locator('.atlas-canvas [data-source-preview]')).toHaveAttribute(
    'data-source-preview',
    'true',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { terrainWorkers: { active: number } }).terrainWorkers.active,
      ),
    )
    .toBe(0);
  const workers = await page.evaluate(
    () => (window as unknown as { terrainWorkers: { created: number } }).terrainWorkers.created,
  );
  await expect(page.locator('.atlas-canvas [data-map-object]')).toHaveCount(0);
  await expect(page.locator('.atlas-canvas [data-map-divisions]')).toHaveCount(0);
  await page.getByRole('button', { name: '草原', exact: true }).click();
  const diameter = page.getByRole('slider', { name: '地形笔刷大小', exact: true });
  await expect(diameter).toHaveAttribute('min', '5');
  await diameter.fill('5');
  await page.getByRole('button', { name: '山地', exact: true }).click();
  await expect(diameter).toHaveValue('5');
  const start = await point(page, 250, 310);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const metrics = await page.locator('.atlas-canvas').evaluate(async (svg) => {
    const g = svg.querySelector('[data-map-viewport]') as SVGGElement;
    const at = (x: number, y: number) => new DOMPoint(x, y).matrixTransform(g.getScreenCTM()!);
    const fire = (type: string, x: number, y: number) => {
      const p = at(x, y);
      svg.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 99,
          pointerType: 'mouse',
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: p.x,
          clientY: p.y,
        }),
      );
    };
    const intervals: number[] = [],
      started = performance.now();
    let last = started,
      updates = 0;
    const observer = new MutationObserver((records) => {
      updates += records.filter((r) => r.attributeName === 'd').length;
    });
    observer.observe(svg.querySelector('[data-source-preview]')!, {
      subtree: true,
      attributes: true,
      attributeFilter: ['d'],
    });
    for (let frame = 0; frame < 24; frame++)
      await new Promise<void>((resolve) =>
        requestAnimationFrame((time) => {
          intervals.push(time - last);
          last = time;
          for (let sample = 0; sample < 8; sample++)
            fire('pointermove', 250 + frame * 9 + sample, 310 + Math.sin(frame / 4) * 15);
          resolve();
        }),
      );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    fire('pointermove', 480, 310);
    observer.disconnect();
    const sorted = intervals.slice(2).sort((a, b) => a - b);
    return {
      medianMs: sorted[Math.floor(sorted.length / 2)],
      p95Ms: sorted[Math.floor(sorted.length * 0.95)],
      updates,
      samples: 193,
      lastX: 480,
    };
  });
  await page.mouse.up();
  expect(metrics.medianMs).toBeLessThan(40);
  expect(metrics.p95Ms).toBeLessThan(100);
  expect(metrics.updates).toBeLessThan(35);
  await writeFile('.runtime/source-brush-performance.json', JSON.stringify(metrics, null, 2));
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(101);
  const edited = (await workspace(request)).data.maps[0];
  expect(edited.editor!.regions.at(-1)?.width).toBe(5);
  expect(edited.editor!.regions.at(-1)?.points.at(-1)?.x).toBe(480);
  expect(edited.editor!.regions.slice(0, -1)).toEqual(regions);
  expect(edited.editor!.objects).toEqual(data.maps[0].editor!.objects);
  expect(
    await page.evaluate(
      () => (window as unknown as { terrainWorkers: { created: number } }).terrainWorkers.created,
    ),
  ).toBe(workers);
  await expect(page.locator('.atlas-canvas [data-terrain-preview]')).toHaveCount(0);
  await page.screenshot({ path: '.runtime/source-brush-lightweight.png', animations: 'disabled' });
  // Returning to the generated map mounts a worker and consumes the last saved source.
  await page.getByRole('button', { name: '生成预览', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { terrainWorkers: { active: number } }).terrainWorkers.active,
      ),
    )
    .toBeGreaterThan(0);
  // A first-time draft without a generation recipe is lightweight as well.
  await page.locator('summary', { hasText: '气候与生成选项' }).click();
  await page.getByRole('button', { name: '停止自动生成', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.generation)
    .toBeUndefined();
  await page.getByRole('button', { name: '色块草稿', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { terrainWorkers: { active: number } }).terrainWorkers.active,
      ),
    )
    .toBe(0);
  await draw(page, [
    [400, 430],
    [450, 432],
  ]);
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.regions.length)
    .toBe(102);
  await expect(page.locator('.atlas-canvas [data-source-preview]')).toHaveAttribute(
    'data-source-preview',
    'true',
  );
});

test('quick-create all three themes, coastal snapping, cancellation, undo and reload persist together', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const current = await workspace(request),
    data = createSeed(),
    template = createEditorFixture();
  const shore: MapPoint[] = [
    { x: 120, y: 90 },
    { x: 690, y: 90 },
    { x: 700, y: 170 },
    { x: 670, y: 240 },
    { x: 705, y: 310 },
    { x: 685, y: 390 },
    { x: 700, y: 540 },
    { x: 120, y: 540 },
  ];
  data.maps[0] = {
    ...data.maps[0],
    seed: 0,
    pins: [],
    strokes: [],
    scaleKm: 400,
    editor: {
      version: 1,
      mode: 'sketch',
      baseVisible: false,
      regions: [],
      objects: [
        {
          ...template.objects[1],
          id: 'continent',
          name: '大陆',
          kind: 'polygon',
          points: shore,
          color: '#e7ddc1',
          stroke: '#786951',
          blur: undefined,
          layer: 'base',
        },
        {
          ...template.objects[1],
          id: 'coastline',
          name: '沿岸浅海',
          points: [...shore, shore[0]],
          blur: undefined,
          layer: 'base',
        },
      ],
    },
  };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '疆域分区', exact: true }).click();
  const panel = page.locator('[data-division-controls]');
  for (const [label, name, type] of [
    ['国家', '银湾王国', 'faction'],
    ['文化', '海岬文化', 'culture'],
    ['信仰', '潮汐信仰', 'religion'],
  ]) {
    await panel.getByRole('button', { name: label, exact: true }).click();
    await panel.getByRole('button', { name: `快速创建${label}`, exact: false }).click();
    const dialog = page.getByRole('dialog', { name: `快速创建${label}` });
    await dialog.getByLabel(`${label}名称`).fill(name);
    await dialog.getByLabel('摘要', { exact: true }).fill(`${name}沿海岸建立的${label}设定。`);
    if (type === 'religion') await dialog.getByLabel('内容标记').selectOption('gm');
    await dialog.getByRole('button', { name: `创建并关联${label}` }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () =>
        (await workspace(request)).data.entities.some((e) => e.name === name && e.type === type),
      )
      .toBe(true);
    const state = (await workspace(request)).data;
    const entity = state.entities.find((e) => e.name === name)!;
    expect(state.maps[0].editor!.divisions!.find((d) => d.name === name)?.entityId).toBe(entity.id);
    await expect(panel.locator('.division-list')).toContainText(name);
  }
  await panel.getByRole('button', { name: '国家', exact: true }).click();
  await panel.getByRole('button', { name: '快速创建国家', exact: false }).click();
  const dialog = page.getByRole('dialog', { name: '快速创建国家' });
  await dialog.getByLabel('国家名称').fill('银湾王国');
  await dialog.getByRole('button', { name: '创建并关联国家' }).click();
  await expect(dialog.getByRole('alert')).toContainText('同名条目');
  await dialog.getByLabel('国家名称').fill('取消的国家');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await workspace(request)).data.entities.some((e) => e.name === '取消的国家')).toBe(false);
  await panel.getByRole('button', { name: '描边圈选' }).click();
  await panel.getByLabel('边界自然起伏').fill('0');
  await draw(page, [
    [400, 150],
    [710, 150],
    [710, 430],
    [400, 430],
    [400, 150],
  ]);
  await expect
    .poll(async () => (await workspace(request)).data.maps[0].editor?.divisionPaint?.length)
    .toBe(1);
  const before = (await workspace(request)).data.maps[0];
  await panel.getByLabel('最大吸附距离（地图单位）').fill('0');
  await panel.getByRole('button', { name: '一键吸附陆地边缘' }).click();
  await expect(panel.getByRole('status')).toContainText('无需修改');
  expect((await workspace(request)).data.maps[0]).toEqual(before);
  await panel.getByLabel('最大吸附距离（地图单位）').fill('45');
  await panel.getByRole('button', { name: '一键吸附陆地边缘' }).click();
  await expect(panel.getByRole('status')).toContainText('已将');
  await expect
    .poll(
      async () => (await workspace(request)).data.maps[0].editor?.divisionPaint?.[0].points.length,
    )
    .not.toBe(before.editor!.divisionPaint![0].points.length);
  const after = (await workspace(request)).data.maps[0];
  expect(after.editor!.divisionPaint![0].roughness).toBe(0);
  expect(after.editor!.objects).toEqual(before.editor!.objects);
  await page.screenshot({ path: '.runtime/division-coast-snap.png', animations: 'disabled' });
  await page.getByRole('button', { name: '撤销地图编辑' }).click();
  await expect.poll(async () => (await workspace(request)).data.maps[0]).toEqual(before);
  await page.getByRole('button', { name: '重做地图编辑' }).click();
  await expect.poll(async () => (await workspace(request)).data.maps[0]).toEqual(after);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '疆域分区', exact: true }).click();
  await expect(panel.locator('.division-list')).toContainText('银湾王国');
  expect((await workspace(request)).data.maps[0]).toEqual(after);
  expect((await workspace(request)).data.maps[1]).toEqual(data.maps[1]);
  await panel.getByRole('button', { name: '快速创建国家', exact: false }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '.runtime/division-quick-create-mobile.png',
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  expect(errors).toEqual([]);
});

test('actual height generation produces connected engraving and regenerates after diameter-5 edits', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const current = await workspace(request),
    data = createSeed();
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
      objects: [],
      generation: {
        version: 2,
        detail: 'high',
        linework: 'organic',
        seed: 392,
        climate: 'temperate',
        settlements: 4,
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
  };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: current.revision } })).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  const composite = page.locator('.atlas-canvas [data-terrain-composite]');
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 45000 });
  await expect(composite).toHaveAttribute('data-terrain-error', 'false');
  // Engraving belongs to actual editable generated paths, not repeated icon transforms.
  const paths = await composite
    .locator(':scope > g > path')
    .evaluateAll((nodes) => nodes.map((p) => p.getAttribute('d')));
  expect(paths.filter((p) => (p?.match(/L/g)?.length ?? 0) > 24).length).toBeGreaterThan(0);
  await page
    .locator('.atlas-canvas')
    .screenshot({ path: '.runtime/mountain-connected-ridges.png' });
  await page.getByRole('button', { name: /智能塑形/ }).click();
  await page.getByRole('button', { name: '海拔', exact: true }).click();
  await page.getByRole('slider', { name: '海拔笔刷直径', exact: true }).fill('5');
  await draw(page, [
    [430, 310],
    [445, 315],
  ]);
  await expect
    .poll(async () => {
      const recipe = (await workspace(request)).data.maps[0].editor?.generation;
      return recipe?.version === 2 ? recipe.elevation?.strokes.at(-1)?.width : undefined;
    })
    .toBe(5);
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 45000 });
  await page.getByRole('button', { name: '地形', exact: true }).click();
  await expect(composite).toHaveAttribute('data-terrain-pending', 'false', { timeout: 45000 });
});
