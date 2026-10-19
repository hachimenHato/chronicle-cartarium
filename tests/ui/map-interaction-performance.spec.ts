import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';
import { addGeographicFixture } from '../fixtures/geographic';
import { validateWorkspace } from '../../server/validation';
import { generationSignature } from '../../src/lib/generated-map';

const workspaceWrites = new WeakMap<Page, number>();

async function remountedArtwork(page: Page) {
  const artwork = await page.locator('[data-map-viewport="true"]').evaluate(async (node) => {
    const copy = node.cloneNode(true) as SVGGElement;
    // MapArtwork's soft filter uses React useId. Remounting changes only that
    // identifier, so rename definitions and their exact URL references together.
    // Every other byte, including filter parameters and all geometry, is hashed.
    const filters = [...copy.querySelectorAll<SVGFilterElement>('filter[id^="map-soft-"]')];
    const ids = filters.map((filter) => filter.id);
    const names = new Map(ids.map((id, index) => [id, `map-soft-react-${index}`]));
    const references = filters.map(() => 0);
    const unresolved: string[] = [];
    filters.forEach((filter, index) => filter.setAttribute('id', `map-soft-react-${index}`));
    for (const element of copy.querySelectorAll('*'))
      for (const attribute of [...element.attributes]) {
        const value = attribute.value.replace(/url\(#(map-soft-[^)]+)\)/g, (match, id: string) => {
          const name = names.get(id);
          if (!name) {
            unresolved.push(id);
            return match;
          }
          references[ids.indexOf(id)]++;
          return `url(#${name})`;
        });
        if (value !== attribute.value) element.setAttribute(attribute.name, value);
      }
    const value = new TextEncoder().encode(copy.innerHTML);
    const digest = await crypto.subtle.digest('SHA-256', value);
    return {
      sha256: [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
      bytes: value.length,
      duplicateDefinitions: ids.length - new Set(ids).size,
      unresolved,
      references,
    };
  });
  expect(artwork.duplicateDefinitions).toBe(0);
  expect(artwork.unresolved).toEqual([]);
  expect(artwork.references.every((count) => count > 0)).toBe(true);
  return artwork;
}

async function unchangedInteraction(
  page: Page,
  request: APIRequestContext,
  before: WorkspaceEnvelope,
) {
  const after = await workspace(request);
  expect(after.revision).toBe(before.revision);
  expect(after.data.maps).toEqual(before.data.maps);
  expect(workspaceWrites.get(page)).toBe(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __interactionJobs: number }).__interactionJobs,
    ),
  ).toBe(0);
}

async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const envelope = (await response.json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  return envelope;
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('[data-map-viewport="true"]').evaluate(
    (node, point) => {
      const result = new DOMPoint(point.x, point.y).matrixTransform(
        (node as SVGGElement).getScreenCTM()!,
      );
      return { x: result.x, y: result.y };
    },
    { x, y },
  );
}

async function releaseInOneFrame(
  page: Page,
  move: { x: number; y: number },
  end: { x: number; y: number },
) {
  await page.locator('.atlas-canvas').evaluate(
    (node, points) => {
      node.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          buttons: 1,
          clientX: points.move.x,
          clientY: points.move.y,
        }),
      );
      node.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          buttons: 0,
          clientX: points.end.x,
          clientY: points.end.y,
        }),
      );
    },
    { move, end },
  );
  await page.mouse.up();
}

test.beforeEach(async ({ request, page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __interactionJobs: number };
    state.__interactionJobs = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      const value = message as { signature?: unknown; generation?: unknown };
      if (value?.generation && typeof value.signature === 'string') state.__interactionJobs++;
      return Reflect.apply(original, this, [message, ...args]);
    };
  });
  const old = await workspace(request);
  const data = addGeographicFixture(createSeed());
  const map = data.maps[0];
  map.pins = [
    {
      id: 'performance_drag_pin',
      x: 300,
      y: 240,
      label: '快速拖动测试',
      description: '',
      kind: 'landmark',
    },
  ];
  map.strokes = [];
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
  workspaceWrites.set(page, 0);
  page.on('request', (request) => {
    if (request.method() === 'PUT' && new URL(request.url()).pathname === '/api/workspace')
      workspaceWrites.set(page, workspaceWrites.get(page)! + 1);
  });
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
});

test('hover, pan and a same-frame wheel burst preserve artwork, cached generation and workspace data', async ({
  page,
  request,
}) => {
  const before = await workspace(request);
  const viewport = page.locator('[data-map-viewport="true"]');
  const artwork = await viewport.innerHTML();
  const from = await screenPoint(page, 450, 340);
  await page.mouse.move(from.x, from.y);
  await page.mouse.move(from.x + 20, from.y + 30, { steps: 12 });
  expect(await viewport.innerHTML()).toBe(artwork);
  await page.mouse.down();
  await page.mouse.move(from.x + 100, from.y + 80, { steps: 12 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute('transform', 'translate(0 0) scale(1)');
  expect(await viewport.innerHTML()).toBe(artwork);
  await page.locator('.atlas-canvas').evaluate((node, at) => {
    for (let i = 0; i < 5; i++)
      node.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: at.x,
          clientY: at.y,
          deltaY: -100,
        }),
      );
  }, from);
  await expect(page.locator('.atlas-zoom > span')).toHaveText('161%');
  expect(await viewport.innerHTML()).toBe(artwork);
  // Reset must replace, rather than resurrect, a still-queued wheel update.
  await page.locator('.atlas-canvas').evaluate((node, at) => {
    node.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: at.x,
        clientY: at.y,
        deltaY: -100,
      }),
    );
    document.querySelector<HTMLButtonElement>('[aria-label="重置地图视图"]')!.click();
  }, from);
  await expect(viewport).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  await page.getByRole('button', { name: '放大地图', exact: true }).click();
  await expect(page.locator('.atlas-zoom > span')).toHaveText('120%');
  await page.getByLabel('切换地图', { exact: true }).selectOption('m_port');
  await expect(viewport).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  await page.getByLabel('切换地图', { exact: true }).selectOption('m_world');
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
  await page.getByRole('button', { name: '重置地图视图', exact: true }).click();
  await expect(viewport).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  await page.waitForTimeout(850);
  const after = await workspace(request);
  expect(after.revision).toBe(before.revision);
  expect(after.data.maps).toEqual(before.data.maps);
  expect(
    await page.evaluate(
      () => (window as unknown as { __interactionJobs: number }).__interactionJobs,
    ),
  ).toBe(0);
  expect(workspaceWrites.get(page)).toBe(0);
});

test('pointer-up before the preview frame persists the final pin and freehand road positions', async ({
  page,
  request,
}) => {
  const original = await workspace(request);
  const baseline = original.data.maps[0].editor!.generated;
  await page.getByRole('button', { name: '选择 / 移动标记', exact: true }).click();
  const start = await screenPoint(page, 300, 240);
  // Selecting a pin without moving must not create history or save the workspace.
  await page.mouse.click(start.x, start.y);
  await page.waitForTimeout(850);
  const selected = await workspace(request);
  expect(selected.revision).toBe(original.revision);
  expect(selected.data.maps[0].pins).toEqual(original.data.maps[0].pins);
  const move = await screenPoint(page, 400, 320);
  const end = await screenPoint(page, 450, 350);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await releaseInOneFrame(page, move, end);
  await expect
    .poll(async () => {
      const pin = (await workspace(request)).data.maps[0].pins[0];
      return [Math.round(pin.x), Math.round(pin.y)];
    })
    .toEqual([450, 350]);
  await page.getByRole('button', { name: '绘制道路', exact: true }).click();
  const roadStart = await screenPoint(page, 200, 430);
  const roadMove = await screenPoint(page, 350, 450);
  const roadEnd = await screenPoint(page, 480, 470);
  await page.mouse.move(roadStart.x, roadStart.y);
  await page.mouse.down();
  await releaseInOneFrame(page, roadMove, roadEnd);
  await expect
    .poll(async () => {
      const point = (await workspace(request)).data.maps[0].strokes[0]?.points.at(-1);
      return point && [Math.round(point.x), Math.round(point.y)];
    })
    .toEqual([480, 470]);
  expect((await workspace(request)).data.maps[0].editor!.generated).toEqual(baseline);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect
    .poll(async () => {
      const transform = await page
        .locator('.atlas-pin')
        .filter({ hasText: '快速拖动测试' })
        .getAttribute('transform');
      const point = transform?.match(/^translate\(([-\d.e+]+),([-\d.e+]+)\)$/);
      return point && point.slice(1).map((value) => Math.round(Number(value) * 1000) / 1000);
    })
    .toEqual([450, 350]);
  expect(
    await page.evaluate(
      () => (window as unknown as { __interactionJobs: number }).__interactionJobs,
    ),
  ).toBe(0);
});

test('composited pan preserves the full zoomed vector surface and commits matching hit coordinates', async ({
  page,
  request,
}) => {
  const before = await workspace(request);
  const viewport = page.locator('[data-map-viewport="true"]');
  const surface = page.locator('.atlas-pan-surface');
  const frame = page.locator('.atlas-canvas-frame');
  for (let i = 0; i < 5; i++)
    await page.getByRole('button', { name: '放大地图', exact: true }).click();
  await expect(page.locator('.atlas-zoom > span')).toHaveText('200%');
  await expect(surface).not.toHaveAttribute('data-map-transforming');
  const original = await viewport.getAttribute('transform');
  const start = await screenPoint(page, 700, 450);
  const pinBefore = await screenPoint(page, 300, 240);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const firstSample = await page.locator('.atlas-canvas').evaluate((node, at) => {
    node.dispatchEvent(
      new PointerEvent('pointermove', {
        bubbles: true,
        pointerId: 1,
        buttons: 1,
        clientX: at.x + 12,
        clientY: at.y + 6,
      }),
    );
    return {
      css: (node.parentElement as HTMLElement).style.transform,
      svg: node.querySelector('[data-map-viewport]')!.getAttribute('transform'),
    };
  }, start);
  expect(
    firstSample.css,
    'the first pan sample is presented before another animation frame',
  ).not.toBe('');
  expect(firstSample.svg).toBe(original);
  await page.mouse.move(start.x + 140, start.y + 65, { steps: 18 });
  await expect(surface).toHaveAttribute('data-map-panning', 'true');
  await expect(viewport).toHaveAttribute('transform', original!);
  await expect
    .poll(async () => surface.evaluate((node) => getComputedStyle(node).transform))
    .not.toBe('none');
  const during = await screenPoint(page, 300, 240);
  expect(during.x - pinBefore.x).toBeCloseTo(140, 0);
  expect(during.y - pinBefore.y).toBeCloseTo(65, 0);
  await frame.screenshot({ path: '.runtime/detail-pan-during.png' });
  await page.mouse.up();
  await expect(surface).not.toHaveAttribute('data-map-panning');
  await expect(viewport).not.toHaveAttribute('transform', original!);
  const after = await screenPoint(page, 300, 240);
  expect(after.x).toBeCloseTo(during.x, 1);
  expect(after.y).toBeCloseTo(during.y, 1);
  await frame.screenshot({ path: '.runtime/detail-pan-committed.png' });
  await page.waitForTimeout(850);
  await unchangedInteraction(page, request, before);
});

test('back-to-back pans accumulate before a frame and resizing ends the current gesture', async ({
  page,
  request,
}) => {
  const before = await workspace(request);
  const start = await screenPoint(page, 650, 400);
  const pin = await screenPoint(page, 300, 240);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.locator('.atlas-canvas').evaluate((node, start) => {
    const event = (type: string, dx: number, dy: number) =>
      node.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId: 1,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
          clientX: start.x + dx,
          clientY: start.y + dy,
        }),
      );
    event('pointermove', 40, 20);
    event('pointerup', 40, 20);
    event('pointerdown', 40, 20);
    event('pointermove', 85, 45);
    event('pointerup', 85, 45);
  }, start);
  await page.mouse.up();
  await expect(page.locator('.atlas-pan-surface')).not.toHaveAttribute('data-map-panning');
  const final = await screenPoint(page, 300, 240);
  expect(final.x - pin.x).toBeCloseTo(85, 1);
  expect(final.y - pin.y).toBeCloseTo(45, 1);
  const next = await screenPoint(page, 650, 400);
  await page.mouse.move(next.x, next.y);
  await page.mouse.down();
  await page.mouse.move(next.x + 50, next.y + 15);
  await page.setViewportSize({ width: 1350, height: 950 });
  await expect(page.locator('.atlas-pan-surface')).not.toHaveAttribute('data-map-panning');
  const committed = await page.locator('[data-map-viewport]').getAttribute('transform');
  await page.mouse.move(next.x + 100, next.y + 45);
  await page.mouse.up();
  await expect(page.locator('[data-map-viewport]')).toHaveAttribute('transform', committed!);
  await page.waitForTimeout(850);
  await unchangedInteraction(page, request, before);
});

test('a wheel during a region-selection pan preserves zoom and never selects or writes a cell', async ({
  page,
  request,
}) => {
  const before = await workspace(request);
  await page.getByRole('button', { name: '疆域分区', exact: true }).click();
  await page.getByRole('button', { name: '选择小区域', exact: true }).click();
  const cell = before.data.maps[0].editor!.generated!.geography!.cells.find(
    (c) => c.land && c.center.x > 300,
  )!;
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  // The linked country label deliberately owns its center's pointer events.
  const start = await screenPoint(page, cell.center.x + 35, cell.center.y + 100);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 50, start.y + 10, { steps: 6 });
  await expect(page.locator('.atlas-pan-surface')).toHaveAttribute('data-map-panning', 'true');
  await page.mouse.wheel(0, -100);
  await expect(page.locator('.atlas-zoom > span')).toHaveText('110%');
  await expect(page.locator('.atlas-pan-surface')).not.toHaveAttribute('data-map-panning');
  await expect(page.locator('.atlas-pan-surface')).not.toHaveAttribute('data-map-transforming');
  const zoomed = await page.locator('[data-map-viewport]').getAttribute('transform');
  await page.mouse.move(start.x + 110, start.y + 25, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('[data-map-viewport]')).toHaveAttribute('transform', zoomed!);
  await expect(page.locator('[data-selected-cell]')).toHaveCount(0);
  await page.waitForTimeout(850);
  await unchangedInteraction(page, request, before);
});

test('color brushes and component shapes commit their release position before the preview frame', async ({
  page,
  request,
}) => {
  await page.getByRole('button', { name: '色块草稿', exact: true }).click();
  await page.getByRole('button', { name: '草原', exact: true }).click();
  const brushStart = await screenPoint(page, 220, 330);
  await page.mouse.move(brushStart.x, brushStart.y);
  await page.mouse.down();
  await releaseInOneFrame(
    page,
    await screenPoint(page, 350, 350),
    await screenPoint(page, 480, 370),
  );
  await expect
    .poll(async () => {
      const point = (await workspace(request)).data.maps[0].editor?.regions.at(-1)?.points.at(-1);
      return point && [Math.round(point.x), Math.round(point.y)];
    })
    .toEqual([480, 370]);

  await page.getByRole('button', { name: /03.*精细编辑/ }).click();
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  const shapeStart = await screenPoint(page, 280, 240);
  await page.mouse.move(shapeStart.x, shapeStart.y);
  await page.mouse.down();
  await releaseInOneFrame(
    page,
    await screenPoint(page, 420, 330),
    await screenPoint(page, 530, 390),
  );
  await expect
    .poll(async () => {
      const point = (await workspace(request)).data.maps[0].editor?.objects.find(
        (object) => object.name === '矩形区域',
      )?.points[2];
      return point && [Math.round(point.x), Math.round(point.y)];
    })
    .toEqual([530, 390]);
  expect(
    await page.evaluate(
      () => (window as unknown as { __interactionJobs: number }).__interactionJobs,
    ),
  ).toBe(0);
});

test('wheel bursts preview on the outer surface and retain the cursor anchor across SVG letterboxing', async ({
  page,
  request,
}) => {
  const before = await workspace(request);
  const viewport = page.locator('[data-map-viewport="true"]');
  const surface = page.locator('.atlas-pan-surface');
  const artwork = await viewport.innerHTML();
  // Force a non-proportional frame: a 1000 × 640 viewBox has vertical margins here.
  await page.locator('.atlas-canvas-frame').evaluate(async (node) => {
    node.style.width = '640px';
    node.style.height = '480px';
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  const { point, anchor } = await viewport.evaluate((node) => {
    const matrix = (node as SVGGElement).getScreenCTM()!;
    const requested = new DOMPoint(460, 310).matrixTransform(matrix);
    // Chromium's constructed WheelEvent may quantize fractional coordinates.
    // Test the map point under the event's actual cursor, not the requested one.
    const event = new WheelEvent('wheel', { clientX: requested.x, clientY: requested.y });
    const anchor = { x: event.clientX, y: event.clientY };
    const point = new DOMPoint(anchor.x, anchor.y).matrixTransform(matrix.inverse());
    return { point: { x: point.x, y: point.y }, anchor };
  });
  const original = await viewport.getAttribute('transform');
  const during = await page.locator('.atlas-canvas').evaluate(
    async (node, input) => {
      const group = node.querySelector<SVGGElement>('[data-map-viewport]')!;
      const surface = node.parentElement!;
      const frame = surface.parentElement!.getBoundingClientRect();
      const root = (node as SVGSVGElement).getScreenCTM()!;
      for (let i = 0; i < 5; i++)
        node.dispatchEvent(
          new WheelEvent('wheel', {
            bubbles: true,
            cancelable: true,
            clientX: input.anchor.x,
            clientY: input.anchor.y,
            deltaY: -100,
          }),
        );
      const immediate = group.getAttribute('transform');
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rendered = new DOMPoint(input.point.x, input.point.y).matrixTransform(
        group.getScreenCTM()!,
      );
      return {
        immediate,
        svg: group.getAttribute('transform'),
        css: getComputedStyle(surface).transform,
        pending: surface.getAttribute('data-map-transforming'),
        zoom: document.querySelector('.atlas-zoom > span')!.textContent,
        point: { x: rendered.x, y: rendered.y },
        letterbox: Math.max(Math.abs(root.e - frame.left), Math.abs(root.f - frame.top)),
      };
    },
    { anchor, point },
  );
  expect(during.letterbox).toBeGreaterThan(10);
  expect(during.immediate).toBe(original);
  expect(during.svg).toBe(original);
  expect(during.css).not.toBe('none');
  expect(during.pending).toBe('true');
  expect(during.zoom).toBe('161%');
  expect(during.point.x).toBeCloseTo(anchor.x, 1);
  expect(during.point.y).toBeCloseTo(anchor.y, 1);
  await expect(surface).not.toHaveAttribute('data-map-transforming');
  await expect(surface).not.toHaveAttribute('style', /transform/);
  await expect(viewport).not.toHaveAttribute('transform', original!);
  const committed = await screenPoint(page, point.x, point.y);
  expect(committed.x).toBeCloseTo(anchor.x, 1);
  expect(committed.y).toBeCloseTo(anchor.y, 1);

  // A native event continues from the complete same-frame burst, not its first wheel.
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -100);
  await expect(page.locator('.atlas-zoom > span')).toHaveText('177%');
  await expect(surface).not.toHaveAttribute('data-map-transforming');
  const native = await screenPoint(page, point.x, point.y);
  expect(native.x).toBeCloseTo(anchor.x, 1);
  expect(native.y).toBeCloseTo(anchor.y, 1);
  expect(await viewport.innerHTML()).toBe(artwork);
  await page.waitForTimeout(850);
  await unchangedInteraction(page, request, before);
});

test('rapid zoom buttons accumulate and reset or map switching cannot revive the old idle commit', async ({
  page,
  request,
}) => {
  const before = await workspace(request);
  const viewport = page.locator('[data-map-viewport="true"]');
  const surface = page.locator('.atlas-pan-surface');
  const artwork = await remountedArtwork(page);
  const original = await viewport.getAttribute('transform');
  const burst = await page.evaluate(async () => {
    const larger = document.querySelector<HTMLButtonElement>('[aria-label="放大地图"]')!;
    const smaller = document.querySelector<HTMLButtonElement>('[aria-label="缩小地图"]')!;
    for (let i = 0; i < 7; i++) larger.click();
    for (let i = 0; i < 2; i++) smaller.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return {
      svg: document.querySelector('[data-map-viewport]')!.getAttribute('transform'),
      zoom: document.querySelector('.atlas-zoom > span')!.textContent,
      pending: document.querySelector('.atlas-pan-surface')!.getAttribute('data-map-transforming'),
    };
  });
  expect(burst.svg).toBe(original);
  expect(burst.zoom).toBe('200%');
  expect(burst.pending).toBe('true');
  await expect(surface).not.toHaveAttribute('data-map-transforming');
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="放大地图"]')!.click();
    document.querySelector<HTMLButtonElement>('[aria-label="重置地图视图"]')!.click();
  });
  await expect(viewport).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  await page.waitForTimeout(180);
  await expect(page.locator('.atlas-zoom > span')).toHaveText('100%');
  await expect(surface).not.toHaveAttribute('data-map-transforming');

  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[aria-label="放大地图"]')!.click();
    const maps = document.querySelector<HTMLSelectElement>('[aria-label="切换地图"]')!;
    maps.value = 'm_port';
    maps.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.getByLabel('切换地图', { exact: true })).toHaveValue('m_port');
  await page.waitForTimeout(180);
  await expect(viewport).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  await expect(page.locator('.atlas-zoom > span')).toHaveText('100%');
  await expect(surface).not.toHaveAttribute('data-map-transforming');
  await page.getByLabel('切换地图', { exact: true }).selectOption('m_world');
  await expect(viewport).toHaveAttribute('transform', 'translate(0 0) scale(1)');
  expect(await remountedArtwork(page)).toEqual(artwork);
  await page.waitForTimeout(850);
  await unchangedInteraction(page, request, before);
});

test('tools immediately following pending zoom retain map coordinates and SVG exports omit the camera', async ({
  page,
  request,
}, testInfo) => {
  const original = await workspace(request);
  const generated = original.data.maps[0].editor!.generated;
  async function drawBeforeIdle(tool: string, points: { x: number; y: number }[]) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    // Keep a real mouse pointer active so synthetic same-frame events may capture it.
    // This begins outside the map, avoiding an earlier accidental mark.
    await page.mouse.move(20, 20);
    await page.mouse.down();
    const state = await page.locator('.atlas-canvas').evaluate(async (node, points) => {
      const group = node.querySelector<SVGGElement>('[data-map-viewport]')!;
      const anchor = new DOMPoint(500, 320).matrixTransform(group.getScreenCTM()!);
      node.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: anchor.x,
          clientY: anchor.y,
          deltaY: -100,
        }),
      );
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const pending = node.parentElement!.getAttribute('data-map-transforming');
      const matrix = group.getScreenCTM()!;
      const screen = points.map((point) => new DOMPoint(point.x, point.y).matrixTransform(matrix));
      const emit = (type: string, point: DOMPoint) =>
        node.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            buttons: type === 'pointerup' ? 0 : 1,
            clientX: point.x,
            clientY: point.y,
          }),
        );
      emit('pointerdown', screen[0]);
      for (const point of screen.slice(1)) emit('pointermove', point);
      emit('pointerup', screen.at(-1)!);
      return { pending, end: { x: screen.at(-1)!.x, y: screen.at(-1)!.y } };
    }, points);
    expect(state.pending).toBe('true');
    await page.mouse.move(state.end.x, state.end.y);
    await page.mouse.up();
  }
  await drawBeforeIdle('绘制道路', [
    { x: 200, y: 430 },
    { x: 350, y: 450 },
    { x: 480, y: 470 },
  ]);
  await expect
    .poll(
      async () => {
        const points = (await workspace(request)).data.maps[0].strokes[0]?.points;
        return points?.map((point) => [Math.round(point.x), Math.round(point.y)]);
      },
      { timeout: 30000 },
    )
    .toEqual([
      [200, 430],
      [350, 450],
      [480, 470],
    ]);
  await drawBeforeIdle('添加标记', [{ x: 610, y: 310 }]);
  await expect
    .poll(
      async () => {
        const pin = (await workspace(request)).data.maps[0].pins.find(
          (pin) => pin.id !== 'performance_drag_pin',
        );
        return pin && [Math.round(pin.x), Math.round(pin.y)];
      },
      { timeout: 30000 },
    )
    .toEqual([610, 310]);
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const saved = await workspace(request);
  const writes = workspaceWrites.get(page);
  const downloading = page.waitForEvent('download');
  const pending = await page.locator('.atlas-canvas').evaluate(async (node) => {
    const group = node.querySelector<SVGGElement>('[data-map-viewport]')!;
    const anchor = new DOMPoint(500, 320).matrixTransform(group.getScreenCTM()!);
    node.dispatchEvent(
      new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: anchor.x,
        clientY: anchor.y,
        deltaY: -100,
      }),
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const pending = node.parentElement!.getAttribute('data-map-transforming');
    [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.trim() === '导出 SVG')!
      .click();
    return pending;
  });
  expect(pending).toBe('true');
  const path = testInfo.outputPath('pending-camera.svg');
  await (await downloading).saveAs(path);
  const svg = await readFile(path, 'utf8');
  const exported = await page.evaluate((content) => {
    const document = new DOMParser().parseFromString(content, 'image/svg+xml');
    const root = document.documentElement;
    const camera = root.querySelector('[data-map-viewport]')!;
    return {
      errors: document.querySelectorAll('parsererror').length,
      width: root.getAttribute('width'),
      height: root.getAttribute('height'),
      transform: camera.getAttribute('transform'),
      style: camera.getAttribute('style'),
      temporary: root.querySelectorAll(
        '[data-map-transforming],[data-map-panning],.atlas-pan-surface',
      ).length,
      pin: root.querySelectorAll('.atlas-pin').length,
    };
  }, svg);
  expect(exported).toEqual({
    errors: 0,
    width: '1000',
    height: '640',
    transform: null,
    style: null,
    temporary: 0,
    pin: 2,
  });
  await expect(page.locator('.atlas-pan-surface')).not.toHaveAttribute('data-map-transforming');
  await page.waitForTimeout(850);
  const after = await workspace(request);
  expect(after.revision).toBe(saved.revision);
  expect(after.data.maps).toEqual(saved.data.maps);
  expect(after.data.maps[0].editor!.generated).toEqual(generated);
  expect(workspaceWrites.get(page)).toBe(writes);
  expect(
    await page.evaluate(
      () => (window as unknown as { __interactionJobs: number }).__interactionJobs,
    ),
  ).toBe(0);
});
