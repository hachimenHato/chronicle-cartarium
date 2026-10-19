import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import { addGeographicFixture } from '../fixtures/geographic';
import { createMapObject } from '../../src/lib/cartography';
import { generationSignature, legacyGenerationSignature } from '../../src/lib/generated-map';
import { validateWorkspace } from '../../server/validation';
import type { WorkspaceEnvelope } from '../../shared/model';

async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const result = (await response.json()) as WorkspaceEnvelope;
  expect(result.mode).toBe('demo');
  return result;
}
async function openPlaces(page: Page) {
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
  await page.getByRole('button', { name: '地名与地点', exact: true }).click();
  await expect(page.locator('.map-places-panel')).toBeVisible();
}
async function jobs(page: Page) {
  return page.evaluate(() => (window as unknown as { __visibilityJobs: number }).__visibilityJobs);
}

test.beforeEach(async ({ request, page }) => {
  await page.addInitScript(() => {
    const tracked = window as unknown as { __visibilityJobs: number };
    tracked.__visibilityJobs = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      const job = message as { generation?: unknown; signature?: unknown };
      if (job?.generation && typeof job.signature === 'string') tracked.__visibilityJobs++;
      return Reflect.apply(original, this, [message, ...args]);
    };
  });
  const current = await workspace(request),
    data = addGeographicFixture(createSeed());
  const map = data.maps[0],
    editor = map.editor!,
    snapshot = editor.generated!;
  delete snapshot.geography!.ports[1].settlementId;
  map.name = '樱灯群岛与银帆海岸的古典地图和沿海城邦交通图志';
  map.pins = [
    { id: 'visibility_pin', kind: 'city', label: '手工都城', description: '', x: 200, y: 200 },
  ];
  map.strokes = [
    {
      id: 'visibility_ink_road',
      tool: 'road',
      color: '#71563e',
      width: 3,
      points: [
        { x: 100, y: 120 },
        { x: 260, y: 210 },
      ],
    },
  ];
  editor.regions = [];
  editor.objects = [
    createMapObject(
      'symbol',
      { x: 480, y: 200 },
      { id: 'visibility_castle', name: '手工城堡', symbol: 'castle' },
    ),
  ];
  snapshot.objects = [
    createMapObject(
      'polygon',
      { x: 0, y: 0 },
      {
        id: 'visibility_sea',
        name: '海面',
        color: '#e6dcc3',
        points: [
          { x: 0, y: 0 },
          { x: 1000, y: 0 },
          { x: 1000, y: 640 },
          { x: 0, y: 640 },
        ],
      },
    ),
    createMapObject(
      'polygon',
      { x: 0, y: 0 },
      {
        id: 'visibility_land',
        name: '陆地 · 共享地表',
        color: '#cfc6a5',
        points: [
          { x: 0, y: 0 },
          { x: 800, y: 0 },
          { x: 800, y: 640 },
          { x: 0, y: 640 },
        ],
      },
    ),
    ...snapshot.sites!.map((site, i) =>
      createMapObject('symbol', site, {
        id: `visibility_site_${i}`,
        name: `聚落 ${i + 1} · 地标`,
        symbol: site.kind,
        size: 36,
      }),
    ),
    createMapObject(
      'path',
      { x: 400, y: 200 },
      {
        id: 'visibility_road_base',
        name: '道路 1 · 路基',
        points: [
          { x: 400, y: 200 },
          { x: 700, y: 400 },
        ],
        stroke: '#eee1bb',
        strokeWidth: 5,
      },
    ),
    createMapObject(
      'path',
      { x: 400, y: 200 },
      {
        id: 'visibility_road',
        name: '道路 1',
        points: [
          { x: 400, y: 200 },
          { x: 700, y: 400 },
        ],
        stroke: '#71563e',
        strokeWidth: 2,
      },
    ),
  ];
  if (editor.generation?.version === 2)
    editor.generation.settlementNames = Object.fromEntries(
      snapshot.sites!.map((site) => [site.id, site.name]),
    );
  const normalized = validateWorkspace(data),
    next = normalized.maps[0];
  // Keep a genuine pre-canonical signature: opening or merely viewing an old
  // accepted cache must neither start a worker nor rewrite the stored map.
  next.editor!.generated!.signature = legacyGenerationSignature(
    next.editor!.regions,
    next.width,
    next.height,
    next.editor!.generation,
    next.scaleKm,
    next.kind,
  );
  expect(next.editor!.generated!.signature).not.toBe(
    generationSignature(
      next.editor!.regions,
      next.width,
      next.height,
      next.editor!.generation,
      next.scaleKm,
      next.kind,
    ),
  );
  const saved = await request.put('/api/workspace', {
    data: { data: normalized, revision: current.revision },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  const accepted = await workspace(request);
  expect(accepted.data.maps[0].editor!.generated!.signature).toBe(
    next.editor!.generated!.signature,
  );
  await page.goto('/');
  await openPlaces(page);
  expect(await jobs(page)).toBe(0);
  const opened = await workspace(request);
  expect(opened.revision).toBe(accepted.revision);
  expect(opened.data.maps[0].editor!.generated!.signature).toBe(next.editor!.generated!.signature);
});

test('individual cities, ports, roads and sea routes hide persistently without regeneration', async ({
  page,
  request,
}) => {
  const panel = page.locator('.map-places-panel');
  const ids = ['银帆城', '银帆港', '道路 1', '银帆航路', '手工都城', '手工城堡', '手绘道路'];
  for (const name of ids) {
    await panel.getByRole('button', { name: `隐藏 ${name}`, exact: true }).click();
    await expect(panel.getByRole('button', { name: `显示 ${name}`, exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  }
  await expect(page.locator('[data-map-artwork="visibility_site_0"]')).toHaveCount(0);
  await expect(page.locator('[data-map-artwork="visibility_road"]')).toHaveCount(0);
  await expect(page.locator('[data-map-artwork="visibility_road_base"]')).toHaveCount(0);
  await expect(page.locator('[data-map-artwork="visibility_castle"]')).toHaveCount(0);
  await expect(page.locator('[data-map-port="geo_port_0"]')).toHaveCount(0);
  await expect(page.locator('[data-sea-route="geo_sea_route_0"]')).toHaveCount(0);
  await expect(page.locator('[data-geographic-name="city_0"]')).toHaveCount(0);
  await expect(page.locator('.atlas-pin[aria-label="手工都城，城镇"]')).toHaveCount(0);
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const saved = (await workspace(request)).data.maps[0];
  expect(saved.editor!.hiddenFeatures).toEqual({
    settlements: ['city_0', 'visibility_pin', 'visibility_castle'],
    ports: ['geo_port_0'],
    roads: ['generated_road_1', 'visibility_ink_road'],
    seaRoutes: ['geo_sea_route_0'],
  });
  expect(saved.editor!.generated!.sites).toHaveLength(2);
  expect(saved.editor!.generated!.geography!.ports).toHaveLength(2);
  expect(saved.editor!.generated!.geography!.seaRoutes).toHaveLength(1);
  expect(await jobs(page)).toBe(0);
  await page.reload();
  await openPlaces(page);
  for (const name of ids)
    await expect(panel.getByRole('button', { name: `显示 ${name}`, exact: true })).toBeVisible();
  expect(await jobs(page)).toBe(0);
  await panel.getByRole('button', { name: '显示 银帆城', exact: true }).click();
  await expect(page.locator('[data-map-artwork="visibility_site_0"]')).toHaveCount(1);
  expect(await jobs(page)).toBe(0);
});

test('independent coastal docks edit and link without altering settlement quotas or associations', async ({
  page,
  request,
}) => {
  const panel = page.locator('.map-places-panel');
  const before = (await workspace(request)).data.maps[0];
  const location = (await workspace(request)).data.entities.find(
    (e) => e.worldId === before.worldId && e.type === 'location' && e.visibility === 'public',
  )!;
  await panel.getByLabel('港口名称 geo_port_1', { exact: true }).fill('潮汐码头');
  await panel.getByLabel('港口名称 geo_port_1', { exact: true }).blur();
  await panel.getByLabel('关联档案 geo_port_1', { exact: true }).selectOption(location.id);
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const next = (await workspace(request)).data.maps[0];
  expect(next.editor!.generated!.sites).toEqual(before.editor!.generated!.sites);
  expect(next.editor!.generated!.geography!.ports[1]).toMatchObject({
    name: '潮汐码头',
    entityId: location.id,
  });
  expect(next.editor!.generated!.geography!.ports[1].settlementId).toBeUndefined();
  expect(await jobs(page)).toBe(0);
  await page.reload();
  await openPlaces(page);
  await expect(panel.getByLabel('港口名称 geo_port_1', { exact: true })).toHaveValue('潮汐码头');
  await expect(panel.getByLabel('关联档案 geo_port_1', { exact: true })).toHaveValue(location.id);
  expect(await jobs(page)).toBe(0);
});

test('selected map pins keep all inspector sections reachable and provide a labelled return', async ({
  page,
  request,
}) => {
  const before = await workspace(request);
  let writes = 0;
  page.on('request', (sent) => {
    if (sent.method() === 'PUT' && new URL(sent.url()).pathname === '/api/workspace') writes++;
  });
  const inspector = page.locator('.atlas-inspector');
  const tabs = inspector.locator('.studio-inspector-tabs');
  const tabNames = ['创作工具', '疆域分区', '兵棋推演', '地名与地点', '地图档案'];
  const selectPin = async () => {
    // Keyboard selection opens the same pin details without creating a drag or a map edit.
    await page.getByRole('button', { name: '手工都城，城镇', exact: true }).press('Enter');
    await expect(inspector.getByLabel('地点名称', { exact: true })).toHaveValue('手工都城');
    for (const name of tabNames)
      await expect(tabs.getByRole('button', { name, exact: true })).toBeVisible();
  };
  for (const name of ['疆域分区', '兵棋推演', '地名与地点', '创作工具', '地图档案']) {
    await selectPin();
    await tabs.getByRole('button', { name, exact: true }).click();
    await expect(inspector.getByLabel('地点名称', { exact: true })).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: '取消选择标记', exact: true })).toHaveCount(
      0,
    );
    if (name === '疆域分区' || name === '兵棋推演') {
      await expect(
        inspector.locator('.geography-panel').getByRole('heading', { name }),
      ).toBeVisible();
      if (name === '兵棋推演') await expect(inspector.locator('.military-tools')).toBeVisible();
    } else if (name === '地名与地点') {
      await expect(inspector.locator('.map-places-panel')).toBeVisible();
    } else if (name === '创作工具') {
      await expect(inspector.locator('.studio-panel')).toBeVisible();
      const source = inspector.getByRole('note', { name: '地图生成来源', exact: true });
      await expect(source).toContainText('当前使用随机地形');
      await expect(source).toContainText('按照色块生成');
      await expect(
        inspector.getByRole('region', { name: '随机地图生成', exact: true }),
      ).toBeVisible();
      await expect(
        inspector.getByRole('slider', { name: '色块生成方式', exact: true }),
      ).toHaveCount(0);
    } else {
      await expect(inspector.getByLabel('地图名称', { exact: true })).toHaveValue(
        before.data.maps[0].name,
      );
    }
  }
  await selectPin();
  const returnToTools = inspector.getByRole('button', { name: '取消选择标记', exact: true });
  await expect(returnToTools).toContainText('返回地图工具');
  await inspector.screenshot({ path: '.runtime/map-pin-inspector-sections.png' });
  await returnToTools.click();
  await expect(inspector.getByLabel('地点名称', { exact: true })).toHaveCount(0);
  await expect(inspector.getByLabel('地图名称', { exact: true })).toBeVisible();
  expect(await jobs(page)).toBe(0);
  expect(writes).toBe(0);
  const after = await workspace(request);
  expect(after.revision).toBe(before.revision);
  expect(after.data.maps[0]).toEqual(before.data.maps[0]);
});

test('map paper keeps title, tools, zoom and footer outside the drawing viewport at desktop and narrow widths', async ({
  page,
  request,
}) => {
  const before = await workspace(request);
  for (const viewport of [
    { width: 1560, height: 1100 },
    { width: 1042, height: 764 },
    { width: 768, height: 720 },
    { width: 390, height: 844 },
    { width: 1042, height: 560 },
    { width: 390, height: 520 },
  ]) {
    await page.setViewportSize(viewport);
    const closeNavigation = page.getByRole('button', { name: '关闭菜单', exact: true });
    if (await page.locator('.sidebar.open').count()) await closeNavigation.click();
    await expect
      .poll(async () =>
        page.locator('.atlas-stage-shell').evaluate((stage) => {
          const canvas = stage.querySelector('.atlas-canvas')!.getBoundingClientRect();
          const frame = stage.getBoundingClientRect();
          const overlaps = (a: DOMRect, b: DOMRect) =>
            a.left < b.right - 1 &&
            a.right > b.left + 1 &&
            a.top < b.bottom - 1 &&
            a.bottom > b.top + 1;
          const controls = [
            '.atlas-map-title',
            '.atlas-tools',
            '.atlas-zoom',
            '.atlas-layers',
            '.atlas-bottom-bar',
          ].map((selector) => stage.querySelector(selector)!.getBoundingClientRect());
          return (
            controls.every(
              (rect) =>
                rect.left >= frame.left &&
                rect.right <= frame.right + 1 &&
                rect.top >= frame.top &&
                rect.bottom <= frame.bottom + 1 &&
                !overlaps(rect, canvas),
            ) &&
            !overlaps(controls[0], controls[2]) &&
            !overlaps(controls[0], controls[3])
          );
        }),
      )
      .toBe(true);
    await page.locator('.atlas-map-legend summary').click();
    const legend = page.locator('.atlas-legend-panel');
    await expect(legend).toBeVisible();
    // In-stage containment alone does not catch a legend covering the left tool rail.
    // Test the expanded panel against every persistent control, including the footer.
    await expect
      .poll(async () =>
        page.locator('.atlas-stage-shell').evaluate((stage) => {
          const frame = stage.getBoundingClientRect();
          const panel = stage.querySelector('.atlas-legend-panel')!;
          const bounds = panel.getBoundingClientRect();
          const violations: string[] = [];
          if (
            bounds.left < frame.left - 1 ||
            bounds.right > frame.right + 1 ||
            bounds.top < frame.top - 1 ||
            bounds.bottom > frame.bottom + 1
          )
            violations.push('legend escapes map paper');
          if (panel.scrollWidth > panel.clientWidth + 1)
            violations.push('legend requires horizontal scrolling');
          for (const selector of [
            '.atlas-tools',
            '.atlas-map-title',
            '.atlas-zoom',
            '.atlas-layers',
            '.atlas-bottom-bar',
          ]) {
            const control = stage.querySelector(selector)!.getBoundingClientRect();
            if (
              bounds.left < control.right - 1 &&
              bounds.right > control.left + 1 &&
              bounds.top < control.bottom - 1 &&
              bounds.bottom > control.top + 1
            )
              violations.push(`legend overlaps ${selector}`);
          }
          return violations;
        }),
      )
      .toEqual([]);
    const lastLegendItem = legend.locator('[data-legend-id]').last();
    await lastLegendItem.scrollIntoViewIfNeeded();
    expect(
      await lastLegendItem.evaluate((item) => {
        const bounds = item.getBoundingClientRect();
        const panel = item.closest('.atlas-legend-panel')!.getBoundingClientRect();
        return (
          bounds.left >= panel.left &&
          bounds.right <= panel.right + 1 &&
          bounds.top >= panel.top &&
          bounds.bottom <= panel.bottom + 1
        );
      }),
    ).toBe(true);
    // The open legend must not steal the pointer from any tool, even after scrolling.
    const toolButtons = page.getByRole('toolbar', { name: '地图绘制工具' }).getByRole('button');
    for (const button of await toolButtons.all()) {
      await button.scrollIntoViewIfNeeded();
      expect(
        await button.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return hit !== null && element.contains(hit);
        }),
      ).toBe(true);
    }
    await page.getByRole('button', { name: '擦除笔画', exact: true }).click();
    await expect(page.getByRole('button', { name: '擦除笔画', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByRole('button', { name: '平移地图', exact: true }).click();
    await legend.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.locator('.atlas-stage-shell').screenshot({
      path: `.runtime/map-visibility-layout-${viewport.width}x${viewport.height}.png`,
    });
    await page.locator('.atlas-map-legend summary').click();
  }
  await page.setViewportSize({ width: 1042, height: 764 });
  // Keep the legend open so fullscreen verifies its panel is hidden as well.
  await page.locator('.atlas-map-legend summary').click();
  await page.getByRole('button', { name: '地图全屏', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.classList.contains('atlas-stage-shell')),
    )
    .toBe(true);
  for (const selector of [
    '.atlas-tools',
    '.atlas-map-title',
    '.atlas-zoom',
    '.atlas-layers',
    '.atlas-bottom-bar',
    '.atlas-legend-panel',
  ])
    await expect(page.locator(selector)).toBeHidden();
  expect(
    await page.locator('.atlas-canvas').evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return (
        rect.left <= 1 &&
        rect.top <= 1 &&
        rect.right >= innerWidth - 1 &&
        rect.bottom >= innerHeight - 1
      );
    }),
  ).toBe(true);
  await page.getByRole('button', { name: '退出地图全屏', exact: true }).click();
  await expect(page.locator('.atlas-tools')).toBeVisible();
  await expect(page.locator('.atlas-legend-panel')).toBeVisible();
  expect(await jobs(page)).toBe(0);
  expect((await workspace(request)).revision).toBe(before.revision);
});
