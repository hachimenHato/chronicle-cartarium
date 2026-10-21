import { readFile } from 'node:fs/promises';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';
import { validateWorkspace } from '../../server/validation';
import { addGeographicFixture } from '../fixtures/geographic';
import { createMapObject } from '../../src/lib/cartography';
import { generationSignature } from '../../src/lib/generated-map';

async function workspace(request: APIRequestContext): Promise<WorkspaceEnvelope> {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const value = (await response.json()) as WorkspaceEnvelope;
  expect(value.mode).toBe('demo');
  return value;
}

async function ready(page: Page) {
  await expect(page.locator('.atlas-pan-surface')).toHaveAttribute('data-map-cache-ready', 'true', {
    timeout: 25000,
  });
  await expect(page.locator('.atlas-terrain-cache')).toBeVisible();
  await expect(page.locator('[data-map-cache-source]')).toHaveCSS('opacity', '0');
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('[data-map-viewport]').evaluate(
    (node, point) => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(
        (node as SVGGElement).getScreenCTM()!,
      );
      return { x: screen.x, y: screen.y };
    },
    { x, y },
  );
}

// A small visual fingerprint is sufficient to catch a stale displayed image;
// the complete source geometry and persisted map are checked separately.
async function fingerprint(page: Page) {
  return page.locator('.atlas-terrain-cache').evaluate((node) => {
    const thumbnail = document.createElement('canvas');
    thumbnail.width = thumbnail.height = 48;
    thumbnail.getContext('2d')!.drawImage(node as HTMLCanvasElement, 0, 0, 48, 48);
    return thumbnail.toDataURL();
  });
}

test.beforeEach(async ({ page, request }) => {
  const old = await workspace(request);
  const data = addGeographicFixture(createSeed());
  const map = data.maps[0];
  map.pins = [
    {
      id: 'cache_pin',
      label: '矢量交互地点',
      description: '',
      kind: 'landmark',
      x: 300,
      y: 240,
    },
  ];
  map.strokes = [];
  map.editor!.mode = 'detail';
  map.editor!.objects.push(
    createMapObject(
      'polygon',
      { x: 470, y: 420 },
      {
        id: 'cache_editable',
        name: '可编辑缓存区域',
        locked: false,
        points: [
          { x: 470, y: 420 },
          { x: 510, y: 420 },
          { x: 510, y: 460 },
          { x: 470, y: 460 },
        ],
        color: '#375d42',
        stroke: '#253e30',
      },
    ),
  );
  const normalized = validateWorkspace(data);
  const next = normalized.maps[0];
  next.editor!.generated!.signature = generationSignature(
    next.editor!.regions,
    next.width,
    next.height,
    next.editor!.generation,
    next.scaleKm,
    next.kind,
  );
  const saved = await request.put('/api/workspace', {
    data: { data: normalized, revision: old.revision },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('[data-terrain-composite]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
  await ready(page);
});

test.describe('high density display', () => {
  test.use({ deviceScaleFactor: 2 });

  test('400% zoom and pan retain full-resolution terrain, vector hits and unchanged map data', async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(90000);
    const before = await workspace(request);
    const source = await page.locator('[data-map-cache-source]').innerHTML();
    const pixels = await fingerprint(page);
    const canvas = page.locator('.atlas-terrain-cache');
    const frame = page.locator('.atlas-canvas-frame');
    expect(await canvas.getAttribute('aria-hidden')).toBe('true');
    await expect(canvas).toHaveCSS('pointer-events', 'none');
    expect(
      await page
        .locator('.atlas-pin')
        .evaluate((node) => node.closest('[data-map-cache-source]') === null),
    ).toBe(true);
    const box = (await frame.boundingBox())!;
    await page.locator('.atlas-canvas').evaluate(
      (node, at) => {
        for (let index = 0; index < 20; index++)
          node.dispatchEvent(
            new WheelEvent('wheel', {
              bubbles: true,
              cancelable: true,
              clientX: at.x,
              clientY: at.y,
              deltaY: -100,
            }),
          );
      },
      { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) },
    );
    await expect(page.locator('.atlas-zoom > span')).toHaveText('400%');
    await expect(page.locator('.atlas-pan-surface')).not.toHaveAttribute('data-map-transforming');
    await ready(page);
    const resolution = await canvas.evaluate((node) => {
      const bitmap = node as HTMLCanvasElement,
        bounds = node.getBoundingClientRect();
      return {
        x: bitmap.width / bounds.width,
        y: bitmap.height / bounds.height,
        dpr: devicePixelRatio,
      };
    });
    expect(resolution.x).toBeGreaterThanOrEqual(resolution.dpr - 0.01);
    expect(resolution.y).toBeGreaterThanOrEqual(resolution.dpr - 0.01);
    const pin = await screenPoint(page, 300, 240),
      bitmapBefore = (await canvas.boundingBox())!;
    const start = { x: box.x + box.width / 2 + 80, y: box.y + box.height / 2 + 50 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 90, start.y + 40, { steps: 12 });
    await expect(page.locator('.atlas-pan-surface')).toHaveAttribute('data-map-panning', 'true');
    const during = await screenPoint(page, 300, 240),
      bitmapDuring = (await canvas.boundingBox())!;
    expect(during.x - pin.x).toBeCloseTo(90, 0);
    expect(during.y - pin.y).toBeCloseTo(40, 0);
    expect(bitmapDuring.x - bitmapBefore.x).toBeCloseTo(90, 0);
    expect(bitmapDuring.y - bitmapBefore.y).toBeCloseTo(40, 0);
    await frame.screenshot({ path: testInfo.outputPath('dpr2-400-during.png') });
    await page.mouse.up();
    await expect(page.locator('.atlas-pan-surface')).not.toHaveAttribute('data-map-transforming');
    const after = await screenPoint(page, 300, 240),
      bitmapAfter = (await canvas.boundingBox())!;
    expect(after.x).toBeCloseTo(during.x, 1);
    expect(after.y).toBeCloseTo(during.y, 1);
    expect(bitmapAfter.x).toBeCloseTo(bitmapDuring.x, 1);
    expect(bitmapAfter.y).toBeCloseTo(bitmapDuring.y, 1);
    expect(await fingerprint(page)).toBe(pixels);
    expect(await page.locator('[data-map-cache-source]').innerHTML()).toBe(source);
    await frame.screenshot({ path: testInfo.outputPath('dpr2-400-committed.png') });
    await page.waitForTimeout(850);
    expect(await workspace(request)).toEqual(before);
  });
});

test('layer changes and editing invalidate stale terrain while original SVG objects remain editable', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const original = await workspace(request),
    initial = await fingerprint(page);
  await page.locator('.atlas-pan-surface').evaluate((node) => {
    const state = { cleared: 0 };
    (window as unknown as { __cacheChanges: typeof state }).__cacheChanges = state;
    new MutationObserver(() => {
      if (!node.hasAttribute('data-map-cache-ready')) state.cleared++;
    }).observe(node, { attributes: true, attributeFilter: ['data-map-cache-ready'] });
  });
  await page.getByRole('button', { name: '显示地图图层', exact: true }).click();
  await page.getByRole('checkbox', { name: '地形底图', exact: true }).uncheck();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __cacheChanges: { cleared: number } }).__cacheChanges.cleared,
      ),
    )
    .toBeGreaterThan(0);
  await ready(page);
  expect(await fingerprint(page)).not.toBe(initial);
  await page.getByRole('checkbox', { name: '地形底图', exact: true }).check();
  await ready(page);
  expect(await fingerprint(page)).toBe(initial);
  await page.getByRole('button', { name: '显示地图图层', exact: true }).click();
  await page.getByRole('button', { name: '选择 / 移动标记', exact: true }).click();
  const start = await screenPoint(page, 490, 440),
    end = await screenPoint(page, 590, 480);
  expect(
    await page.evaluate(
      (at) =>
        document
          .elementFromPoint(at.x, at.y)
          ?.closest('[data-map-object]')
          ?.getAttribute('data-map-object'),
      start,
    ),
  ).toBe('cache_editable');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await workspace(request)).data.maps[0]
          .editor!.objects.find((object) => object.id === 'cache_editable')!
          .points.map((point) => [Math.round(point.x), Math.round(point.y)]),
      { timeout: 30000 },
    )
    .toEqual([
      [570, 460],
      [610, 460],
      [610, 500],
      [570, 500],
    ]);
  await ready(page);
  expect(await fingerprint(page)).not.toBe(initial);
  expect((await workspace(request)).data.maps[0].editor!.generated).toEqual(
    original.data.maps[0].editor!.generated,
  );
  await page.getByRole('button', { name: '撤销地图编辑', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await workspace(request)).data.maps[0].editor!.objects.find(
          (object) => object.id === 'cache_editable',
        )!.points,
    )
    .toEqual(
      original.data.maps[0].editor!.objects.find((object) => object.id === 'cache_editable')!
        .points,
    );
  await ready(page);
  expect(await fingerprint(page)).toBe(initial);
});

test('cache stays out of SVG exports and releases resources when switching maps or leaving the workshop', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90000);
  const before = await workspace(request);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const filename = testInfo.outputPath('cached-map.svg');
  await (await download).saveAs(filename);
  const svg = await readFile(filename, 'utf8');
  const parsed = await page.evaluate((content) => {
    const document = new DOMParser().parseFromString(content, 'image/svg+xml');
    const root = document.documentElement,
      source = root.querySelector('[data-map-cache-source]')!;
    return {
      errors: document.querySelectorAll('parsererror').length,
      temporary: document.querySelectorAll('canvas,.atlas-terrain-cache,[data-map-cache-ready]')
        .length,
      opacity: [root, source].map((node) => ({
        attribute: node.getAttribute('opacity'),
        style: (node as SVGElement).style.opacity,
      })),
      camera: root.querySelector('[data-map-viewport]')!.getAttribute('transform'),
      paper: document.querySelectorAll('[data-map-paper]').length,
      pins: document.querySelectorAll('.atlas-pin').length,
    };
  }, svg);
  expect(parsed).toEqual({
    errors: 0,
    temporary: 0,
    opacity: [
      { attribute: null, style: '' },
      { attribute: null, style: '' },
    ],
    camera: null,
    paper: 1,
    pins: 1,
  });
  await page.getByLabel('切换地图', { exact: true }).selectOption('m_port');
  await page.getByLabel('切换地图', { exact: true }).selectOption('m_world');
  await ready(page);
  await expect(page.locator('[data-map-object="cache_editable"]')).toHaveCount(1);
  await page.locator('.atlas-terrain-cache').evaluate((node) => {
    (window as unknown as { __releasedCanvas: HTMLCanvasElement }).__releasedCanvas =
      node as HTMLCanvasElement;
  });
  await page.getByRole('button', { name: '创作仪表盘', exact: true }).click();
  await expect(page.locator('.atlas-terrain-cache')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const canvas = (window as unknown as { __releasedCanvas: HTMLCanvasElement })
        .__releasedCanvas;
      return { connected: canvas.isConnected, width: canvas.width, height: canvas.height };
    }),
  ).toEqual({ connected: false, width: 1, height: 1 });
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await ready(page);
  await expect(page.locator('.atlas-terrain-cache')).toHaveCount(1);
  expect(await workspace(request)).toEqual(before);
});

test('uploaded images appear in cached pixels and fullscreen rebuilds omit baked editor annotations', async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(90000);
  const original = await workspace(request);
  // Observe the actual SVG image handed to the bitmap decoder, rather than
  // inferring its contents from the CSS of the original vector tree.
  await page.evaluate(() => {
    const snapshots: { fullscreen: boolean; annotations: number; embeddedImages: number }[] = [];
    (window as unknown as { __cacheSnapshots: typeof snapshots }).__cacheSnapshots = snapshots;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      if (object instanceof Blob && object.type.startsWith('image/svg+xml')) {
        const fullscreen = document.fullscreenElement !== null;
        void object.text().then((content) => {
          const source = new DOMParser().parseFromString(content, 'image/svg+xml');
          snapshots.push({
            fullscreen,
            annotations: source.querySelectorAll('[data-editor-overlay]').length,
            embeddedImages: source.querySelectorAll('image[href^="data:image/png;base64,"]').length,
          });
        });
      }
      return original(object);
    };
  });
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 120;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#d21c9e';
    context.fillRect(0, 0, 200, 120);
    context.fillStyle = '#1ce85a';
    context.fillRect(90, 50, 20, 20);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByRole('button', { name: '导入地图图片', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入地图图片', exact: true });
  await dialog.getByLabel('地图图片', { exact: true }).setInputFiles({
    name: '缓存像素验证.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await dialog.getByLabel('导入方式').selectOption('overlay');
  await dialog.getByLabel('图片地图名称').fill('缓存图片示例');
  await dialog.getByRole('button', { name: '导入图片', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(
      async () =>
        (await workspace(request)).data.maps[0].editor!.objects.filter(
          (object) => object.kind === 'image',
        ).length,
    )
    .toBe(1);
  await ready(page);
  const snapshot = () =>
    page.evaluate(() =>
      (
        window as unknown as {
          __cacheSnapshots: { fullscreen: boolean; annotations: number; embeddedImages: number }[];
        }
      ).__cacheSnapshots.at(-1),
    );
  await expect.poll(snapshot).toEqual({ fullscreen: false, annotations: 1, embeddedImages: 1 });
  async function expectGreenImagePixel() {
    const pixel = await page.locator('.atlas-terrain-cache').evaluate((node) => {
      const bitmap = node as HTMLCanvasElement,
        bounds = bitmap.getBoundingClientRect();
      const viewport = document.querySelector<SVGGElement>('[data-map-viewport]')!;
      const point = new DOMPoint(500, 320).matrixTransform(viewport.getScreenCTM()!);
      const x = Math.floor(((point.x - bounds.x) * bitmap.width) / bounds.width);
      const y = Math.floor(((point.y - bounds.y) * bitmap.height) / bounds.height);
      return [...bitmap.getContext('2d')!.getImageData(x, y, 1, 1).data];
    });
    expect(pixel[0]).toBeLessThan(90);
    expect(pixel[1]).toBeGreaterThan(180);
    expect(pixel[2]).toBeLessThan(130);
    expect(pixel[3]).toBeGreaterThan(240);
  }
  await expectGreenImagePixel();
  await expect(page.locator('[data-map-cache-source] [data-editor-overlay]')).toHaveCount(1);
  await page
    .locator('.atlas-canvas-frame')
    .screenshot({ path: testInfo.outputPath('uploaded-cache.png') });
  const saved = await workspace(request);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const filename = testInfo.outputPath('cached-upload.svg');
  await (await downloading).saveAs(filename);
  const exported = await readFile(filename, 'utf8');
  expect((exported.match(/href="data:image\/png;base64,/g) || []).length).toBe(1);
  expect(exported).not.toContain('href="/uploads/');
  expect(exported).not.toContain('data-editor-overlay');
  await page.getByRole('button', { name: '地图全屏', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.classList.contains('atlas-stage-shell')),
    )
    .toBe(true);
  await ready(page);
  await expect.poll(snapshot).toEqual({ fullscreen: true, annotations: 0, embeddedImages: 1 });
  await expectGreenImagePixel();
  await page.screenshot({ path: testInfo.outputPath('uploaded-cache-fullscreen.png') });
  await page.getByRole('button', { name: '退出地图全屏', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await ready(page);
  await expect.poll(snapshot).toEqual({ fullscreen: false, annotations: 1, embeddedImages: 1 });
  await expectGreenImagePixel();
  await page
    .locator('.atlas-canvas-frame')
    .screenshot({ path: testInfo.outputPath('uploaded-cache-restored.png') });
  expect(await workspace(request)).toEqual(saved);
  expect(saved.data.maps[0].editor!.generated).toEqual(original.data.maps[0].editor!.generated);
});
