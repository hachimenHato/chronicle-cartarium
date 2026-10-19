import { test, expect, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

async function screenPoint(page: Page, x: number, y: number) {
  return page.locator('.atlas-canvas > g').evaluate(
    (element, p) => {
      const matrix = (element as SVGGElement).getScreenCTM()!;
      const point = new DOMPoint(p.x, p.y).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    },
    { x, y },
  );
}
async function draw(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const a = await screenPoint(page, from.x, from.y),
    b = await screenPoint(page, to.x, to.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}
async function clickMap(page: Page, x: number, y: number) {
  const p = await screenPoint(page, x, y);
  await page.mouse.click(p.x, p.y);
}

test.beforeEach(async ({ request }) => {
  const envelope = (await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope;
  expect(envelope.mode).toBe('demo');
  const data = createSeed();
  data.maps[0] = { ...data.maps[0], seed: 0, pins: [], strokes: [] };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: envelope.revision } })).ok(),
  ).toBeTruthy();
});

test('three map levels paint, group, bake, edit vertices and persist without changing another map', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const original = ((await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope).data
    .maps[1];
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '草原', exact: true }).click();
  await draw(page, { x: 310, y: 320 }, { x: 570, y: 350 });
  await expect
    .poll(
      async () =>
        ((await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope).data.maps[0]
          .editor?.regions.length,
    )
    .toBe(1);
  await expect(page.locator('[data-map-region] path').first()).toBeVisible();
  await page.screenshot({ path: '.runtime/studio-sketch.png' });
  await page.getByRole('button', { name: /智能塑形/ }).click();
  const library = page.locator('details.studio-library').filter({
    has: page.locator('summary', { hasText: '组件库' }),
  });
  if (!(await library.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await library.locator('summary').click();
  }
  await page.getByRole('button', { name: '放置城堡', exact: true }).click();
  await page.getByRole('button', { name: '智能群组', exact: true }).click();
  await clickMap(page, 660, 300);
  await expect
    .poll(
      async () =>
        ((await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope).data.maps[0]
          .editor?.objects.length || 0,
    )
    .toBeGreaterThan(3);
  await page.getByRole('button', { name: '绘制道路', exact: true }).click();
  await draw(page, { x: 290, y: 470 }, { x: 680, y: 460 });
  await page.getByRole('button', { name: /精细编辑/ }).click();
  await page.getByRole('button', { name: '将生成图转为可编辑组件', exact: true }).click();
  await page.getByRole('button', { name: '转换并精修', exact: true }).click();
  await expect
    .poll(
      async () =>
        ((await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope).data.maps[0]
          .editor?.regions.length,
    )
    .toBe(0);
  await page.getByRole('button', { name: '矩形', exact: true }).click();
  await draw(page, { x: 280, y: 200 }, { x: 440, y: 270 });
  await page.getByRole('button', { name: /编辑轮廓顶点（4）/ }).click();
  const first = page.locator('[data-map-vertex="0"]');
  await expect(first).toBeVisible();
  const at = await first.boundingBox();
  const end = await screenPoint(page, 260, 185);
  await page.mouse.move(at!.x + at!.width / 2, at!.y + at!.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const e = (await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope;
      return e.data.maps[0].editor?.objects.at(-1)?.points[0].x;
    })
    .toBeCloseTo(260, 0);
  await page.getByRole('button', { name: '文字标签', exact: true }).click();
  await page.getByLabel('标签文字', { exact: false }).fill('暮色山谷');
  await clickMap(page, 550, 200);
  await expect
    .poll(
      async () =>
        (
          (await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope
        ).data.maps[0].editor?.objects.at(-1)?.text,
    )
    .toBe('暮色山谷');
  const saved = (await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope;
  expect(saved.data.maps[0].editor?.baseVisible).toBe(false);
  expect(saved.data.maps[0].strokes).toHaveLength(0);
  expect(saved.data.maps[1]).toEqual(original);
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.getByRole('button', { name: /精细编辑/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.atlas-canvas text').filter({ hasText: '暮色山谷' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  const file = await download;
  await file.saveAs('.runtime/studio-detail.svg');
  await page.screenshot({ path: '.runtime/studio-detail.png' });
  expect(errors).toEqual([]);
});

test('map tiers fit a narrow viewport and mode changes keep existing map data', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: /智能塑形/ }).click();
  await expect
    .poll(
      async () =>
        ((await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope).data.maps[0]
          .editor?.mode,
    )
    .toBe('sculpt');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: '.runtime/studio-mobile.png' });
});
