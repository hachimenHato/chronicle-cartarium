import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createSeed } from '../../shared/seed';
import { addGeographicFixture } from '../fixtures/geographic';
import type { WorkspaceEnvelope } from '../../shared/model';
import type { MapObject } from '../../shared/cartography';
import { divisionEntityTypes } from '../../shared/cartography';
import { generationSignature } from '../../src/lib/generated-map';
import { validateWorkspace } from '../../server/validation';

// Fresh 3311 DemoStore only. No credentials, environment file or daily data are used.
async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const value = (await response.json()) as WorkspaceEnvelope;
  expect(value.mode).toBe('demo');
  return value;
}
const object = (
  id: string,
  name: string,
  kind: MapObject['kind'],
  points: MapObject['points'],
  style: Partial<MapObject> = {},
): MapObject => ({
  id,
  name,
  kind,
  points,
  text: '',
  color: 'none',
  stroke: 'none',
  strokeWidth: 0,
  size: 16,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: true,
  ...style,
});
async function jobs(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __mapPresentationJobs: number }).__mapPresentationJobs,
  );
}
async function openAtlas(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('.atlas-canvas')).toBeVisible();
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
}
async function downloadSvg(page: Page, path: string) {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 SVG', exact: true }).click();
  await (await downloading).saveAs(path);
  return readFile(path, 'utf8');
}

test.beforeEach(async ({ request, page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { __mapPresentationJobs: number };
    state.__mapPresentationJobs = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      const value = message as { generation?: unknown; signature?: unknown };
      if (value?.generation && typeof value.signature === 'string') state.__mapPresentationJobs++;
      return Reflect.apply(original, this, [message, ...args]);
    };
  });
  const current = await workspace(request),
    data = addGeographicFixture(createSeed());
  const map = data.maps[0],
    editor = map.editor!,
    generated = editor.generated!,
    geography = generated.geography!;
  map.name = '银帆海岸 · 军事图志';
  map.pins = [];
  map.strokes = [];
  editor.objects = [];
  editor.regions = [];
  for (const kind of ['culture', 'religion'] as const)
    for (const index of [0, 1]) {
      const name =
        kind === 'culture' ? ['晴川文化', '赤月文化'][index] : ['星庭信仰', '月轮信仰'][index];
      const id = `presentation_${kind}_${index}`;
      data.entities.push({
        ...data.entities[0],
        id: `${id}_page`,
        name,
        type: divisionEntityTypes[kind],
        visibility: 'public',
      });
      geography.divisions.push({
        id,
        name,
        kind,
        center: { x: index * 400 + 200, y: 320 },
        color: index ? '#ba7873' : '#719b8a',
        entityId: `${id}_page`,
      });
      for (const cell of geography.cells.filter((c) => c.land && c.id === index)) cell[kind] = id;
      if (!index)
        geography.borders.push({
          ...geography.borders[0],
          id: `presentation_border_${kind}`,
          kind,
        });
    }
  const location = data.entities.find((e) => e.type === 'location' && e.worldId === map.worldId)!;
  for (const site of generated.sites!) {
    const entityId = `presentation_${site.id}_page`;
    data.entities.push({ ...location, id: entityId, name: site.name, visibility: 'public' });
    site.entityId = entityId;
  }
  if (editor.generation?.version === 2) {
    editor.generation.settlementNames = Object.fromEntries(
      generated.sites!.map((s) => [s.id, s.name]),
    );
    editor.generation.settlementLinks = Object.fromEntries(
      generated.sites!.map((s) => [s.id, s.entityId!]),
    );
  }
  generated.objects = [
    object(
      'presentation_sea',
      '海面',
      'polygon',
      [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 640 },
        { x: 0, y: 640 },
      ],
      { color: '#e5dfc8' },
    ),
    object(
      'presentation_land',
      '陆地 · 共享地表',
      'polygon',
      [
        { x: 0, y: 0 },
        { x: 800, y: 0 },
        { x: 800, y: 640 },
        { x: 0, y: 640 },
      ],
      { color: '#d8ceac', stroke: '#9f8b68', strokeWidth: 1.3 },
    ),
    object('presentation_mountain', '古典山脉 · 示范山峰', 'symbol', [{ x: 250, y: 225 }], {
      symbol: 'mountain',
      color: '#cbbb96',
      stroke: '#70583f',
      strokeWidth: 0.9,
      size: 72,
    }),
    object('presentation_tree', '松林地标', 'symbol', [{ x: 650, y: 110 }], {
      symbol: 'pine',
      color: '#96a87f',
      stroke: '#50664b',
      strokeWidth: 0.7,
      size: 32,
    }),
    object(
      'presentation_river',
      '银湾河',
      'path',
      [
        { x: 200, y: 75 },
        { x: 235, y: 120 },
        { x: 310, y: 150 },
        { x: 370, y: 115 },
        { x: 430, y: 150 },
        { x: 600, y: 240 },
        { x: 800, y: 220 },
      ],
      { stroke: '#547b82', strokeWidth: 1.8 },
    ),
    object('presentation_note', '旅人石碑文字', 'text', [{ x: 275, y: 120 }], {
      text: '旅人石碑',
      color: '#3c3428',
      stroke: '#f2e6ca',
      strokeWidth: 1.2,
      size: 15,
    }),
    ...generated.sites!.flatMap((s, i) => [
      object(`presentation_site_${i}`, `聚落 ${i + 1} · 地标`, 'symbol', [{ x: s.x, y: s.y }], {
        symbol: s.kind,
        color: '#d7c19a',
        stroke: '#624d36',
        strokeWidth: 0.8,
        size: i ? 32 : 44,
      }),
      object(
        `presentation_old_name_${i}`,
        `聚落 ${i + 1} · 名称`,
        'text',
        [{ x: s.x, y: s.y + 30 }],
        { text: s.name, color: '#483c2b', stroke: '#f4e7c7', strokeWidth: 1.2, size: 13 },
      ),
    ]),
  ];
  editor.military!.push(
    {
      id: 'presentation_attack',
      kind: 'advance',
      name: '西境进攻方向',
      color: '#ab5e48',
      width: 3,
      visible: true,
      points: [
        { x: 160, y: 420 },
        { x: 280, y: 390 },
        { x: 420, y: 445 },
        { x: 540, y: 375 },
        { x: 690, y: 290 },
      ],
    },
    {
      id: 'presentation_defense',
      kind: 'defense',
      name: '海岸纵深防线',
      color: '#557659',
      width: 3,
      visible: true,
      points: [
        { x: 170, y: 550 },
        { x: 290, y: 515 },
        { x: 430, y: 550 },
        { x: 600, y: 495 },
      ],
    },
    {
      id: 'presentation_retreat',
      kind: 'retreat',
      name: '北岭撤退通道',
      color: '#9e7c43',
      width: 2,
      visible: true,
      points: [
        { x: 680, y: 100 },
        { x: 585, y: 155 },
        { x: 495, y: 125 },
      ],
    },
  );
  const normalized = validateWorkspace(data),
    normalizedMap = normalized.maps[0];
  normalizedMap.editor!.generated!.signature = generationSignature(
    normalizedMap.editor!.regions,
    normalizedMap.width,
    normalizedMap.height,
    normalizedMap.editor!.generation,
    normalizedMap.scaleKm,
    normalizedMap.kind,
  );
  const response = await request.put('/api/workspace', {
    data: { data: normalized, revision: current.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});

test('independent layer buttons keep display unchanged when military tools are selected', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openAtlas(page);
  const bar = page.getByRole('region', { name: '地图图层切换', exact: true });
  await expect(bar).toBeVisible();
  await expect(bar.locator('button')).toHaveCount(10);
  expect(await bar.evaluate((el) => !!el.closest('.atlas-inspector'))).toBe(false);
  expect(
    await page
      .locator('.atlas-inspector')
      .getByRole('combobox', { name: '地理图层', exact: true })
      .count(),
  ).toBe(0);
  await page.getByRole('button', { name: '隐藏右侧工具栏', exact: true }).click();
  await expect(page.locator('.atlas-inspector')).toBeHidden();
  await expect(bar).toBeVisible();
  await page.getByRole('button', { name: '显示右侧工具栏', exact: true }).click();
  await page.getByRole('button', { name: '兵棋推演', exact: true }).click();
  const baseline = (await workspace(request)).revision;
  for (const layer of ['atlas', 'temperature', 'elevation', 'countries'] as const) {
    await bar.locator(`[data-layer-button="${layer}"]`).click();
    for (const tool of ['前线', '防御线', '进攻线'] as const) {
      await page
        .locator('.military-tools')
        .getByRole('button', { name: tool, exact: true })
        .click();
      await expect(bar.locator(`[data-layer-button="${layer}"]`)).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(bar.locator('[aria-pressed="true"]')).toHaveCount(1);
      if (layer === 'elevation')
        await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
          'data-terrain-view',
          'elevation',
        );
      else {
        await expect(
          page.locator(`[data-geographic-layer="${layer}"][data-geographic-phase="overlay"]`),
        ).toHaveCount(1);
        await expect(
          page.locator(`[data-geographic-layer="${layer}"][data-geographic-phase="underlay"]`),
        ).toBeVisible();
      }
    }
  }
  expect((await workspace(request)).revision).toBe(baseline);
  expect(await jobs(page)).toBe(0);
  expect(errors).toEqual([]);
});

test('political pigment is below intact terrain ink and unified curved linked names', async ({
  page,
  request,
}) => {
  await openAtlas(page);
  const baseline = (await workspace(request)).revision;
  const detail = page.locator('[data-map-details="true"]');
  await expect(detail.getByText('旅人石碑', { exact: true })).toBeVisible();
  const original = await detail.evaluate((el) => el.outerHTML);
  for (const layer of ['countries', 'cultures', 'religions', 'atlas'] as const) {
    await page.locator(`[data-layer-button="${layer}"]`).click();
    const pigment = page.locator(
      `[data-geographic-layer="${layer}"][data-geographic-phase="underlay"] [data-political-ground="true"]`,
    );
    await expect(pigment).toBeVisible();
    await expect(pigment).toHaveAttribute('opacity', layer === 'atlas' ? '.28' : '0.66');
    expect(await detail.evaluate((el) => el.outerHTML)).toEqual(original);
    expect(
      await page.locator('[data-terrain-composite="true"]').evaluate((el) => {
        const underlay = el.querySelector('[data-geographic-phase="underlay"]'),
          ink = el.querySelector('[data-map-details]');
        return (
          !!underlay &&
          !!ink &&
          !!(underlay.compareDocumentPosition(ink) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      }),
    ).toBe(true);
    await expect(detail.locator('text').filter({ hasText: '银帆城' })).toHaveCount(0);
    await expect(page.locator('[data-cartographic-label="settlement"]')).toHaveCount(2);
  }
  const capital = page.locator(
    '[data-cartographic-label="settlement"][data-geographic-name="city_0"]',
  );
  await capital.hover();
  await expect(page.getByRole('dialog', { name: '银帆城词条摘要', exact: true })).toBeVisible();
  await page.mouse.move(0, 0);
  await expect(page.getByRole('dialog', { name: '银帆城词条摘要', exact: true })).toHaveCount(0);
  const curves = await page
    .locator('[data-cartographic-label="water"] textPath')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const href = node.getAttribute('href')!;
        return document.getElementById(href.slice(1))?.getAttribute('d') ?? '';
      }),
    );
  expect(curves.length).toBeGreaterThan(0);
  expect(curves.every((path) => path.includes(' C'))).toBe(true);
  expect((await workspace(request)).revision).toBe(baseline);
  expect(await jobs(page)).toBe(0);
});

test('battle plan export keeps ribbons, oriented defensive teeth and self-contained name curves', async ({
  page,
}) => {
  await openAtlas(page);
  await expect(page.locator('[data-military-ribbon="true"]')).toHaveCount(1);
  await expect(page.locator('[data-military-mark="defense"]')).not.toHaveCount(0);
  await expect(page.locator('[data-military-kind="defense"] circle')).toHaveCount(0);
  const military = page.locator('[data-military-lines="true"]');
  await page.locator('.atlas-canvas').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/map-presentation-desktop.png' });
  await military.screenshot({ path: '.runtime/map-presentation-military.png' });
  const svg = await downloadSvg(page, '.runtime/map-presentation-export.svg');
  expect(svg).toContain('data-military-ribbon="true"');
  expect(svg).toContain('data-military-mark="defense"');
  expect(svg).toContain('data-cartographic-label="water"');
  expect(svg).not.toContain('data-editor-overlay');
  expect(svg).not.toContain('data-editor-hit');
  const references = [...svg.matchAll(/(?:href="#|url\(#)([^"\s)]+)/g)].map((match) => match[1]);
  expect(references.length).toBeGreaterThan(2);
  for (const reference of references) expect(svg).toContain(`id="${reference}"`);
});

test('layer buttons remain readable and fit the midnight desktop and narrow screen', async ({
  page,
}) => {
  await openAtlas(page);
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'midnight';
  });
  const bar = page.getByRole('region', { name: '地图图层切换', exact: true });
  await page.locator('[data-layer-button="countries"]').click();
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map((value) => Number(value) / 255)
      .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const titleColors = await page.locator('.atlas-breadcrumb button.current').evaluate((el) => ({
    foreground: getComputedStyle(el).color,
    background: getComputedStyle(document.body).backgroundColor,
  }));
  const titleForeground = luminance(titleColors.foreground),
    titleBackground = luminance(titleColors.background);
  expect(
    (Math.max(titleForeground, titleBackground) + 0.05) /
      (Math.min(titleForeground, titleBackground) + 0.05),
  ).toBeGreaterThanOrEqual(4.5);
  await expect
    .poll(async () => {
      const colors = await bar.locator('button').evaluateAll((nodes) =>
        nodes.map((el) => {
          const css = getComputedStyle(el);
          return { foreground: css.color, background: css.backgroundColor };
        }),
      );
      return Math.min(
        ...colors.map((color) => {
          const foreground = luminance(color.foreground),
            background = luminance(color.background);
          return (
            (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05)
          );
        }),
      );
    })
    .toBeGreaterThanOrEqual(4.5);
  await bar.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/map-presentation-midnight-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await bar.scrollIntoViewIfNeeded();
  await expect(bar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  for (const button of await bar.locator('button').all()) {
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThan(35);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  }
  await page.screenshot({ path: '.runtime/map-presentation-midnight-mobile.png' });
});

test('thematic wash softens below ink, count fields fit digits and defensive/front teeth flip without generation', async ({
  page,
  request,
}) => {
  await openAtlas(page);
  const before = (await workspace(request)).data.maps[0].editor!.military!;
  for (const layer of ['terrain', 'temperature', 'precipitation']) {
    await page.locator(`[data-layer-button="${layer}"]`).click();
    const wash = page.locator(`[data-thematic-blend="${layer}"]`);
    await expect(wash).toBeVisible();
    const filter = await wash.getAttribute('filter');
    expect(filter).toMatch(/^url\(#.+-thematic-blend\)$/);
    const radius = await page
      .locator('.atlas-canvas feGaussianBlur')
      .evaluateAll((nodes) => nodes.map((n) => Number(n.getAttribute('stdDeviation'))));
    expect(radius.some((r) => r > 0 && r <= 14)).toBeTruthy();
    await expect(
      page.locator('[data-map-details] text').filter({ hasText: '旅人石碑' }),
    ).toBeVisible();
  }
  await page.locator('[data-layer-button="terrain"]').click();
  await expect(page.locator('[data-terrain-water]')).toHaveAttribute('fill', '#b5d6e2');
  const svg = await downloadSvg(page, '.runtime/climate-blended-terrain.svg');
  expect(svg).toContain('feGaussianBlur');
  const refs = [...svg.matchAll(/url\(#([^)]*thematic-blend)\)/g)].map((m) => m[1]);
  expect(refs.length).toBeGreaterThan(0);
  for (const ref of refs) expect(svg).toContain(`id="${ref}"`);
  await page.getByRole('button', { name: '兵棋推演', exact: true }).click();
  for (const line of before.filter((l) => l.kind === 'front' || l.kind === 'defense')) {
    await page.getByRole('button', { name: `翻转齿向 ${line.name}`, exact: true }).click();
    await expect
      .poll(
        async () =>
          (await workspace(request)).data.maps[0].editor!.military!.find((l) => l.id === line.id)!
            .points,
      )
      .toEqual([...line.points].reverse());
  }
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  for (const line of before.filter((l) => l.kind === 'front' || l.kind === 'defense'))
    expect(
      (await workspace(request)).data.maps[0].editor!.military!.find((l) => l.id === line.id)!
        .points,
    ).toEqual([...line.points].reverse());
  await page.getByRole('button', { name: '地名与地点', exact: true }).click();
  await page.locator('.map-places-count-panel summary').click();
  const input = page.getByLabel('村落生成数量', { exact: true });
  await expect(input).toBeVisible();
  expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(70);
  await page.setViewportSize({ width: 390, height: 844 });
  await input.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const bounds = await page.locator('.sidebar').boundingBox();
      return bounds ? bounds.x + bounds.width : 0;
    })
    .toBeLessThanOrEqual(1);
  expect((await input.boundingBox())!.width).toBeGreaterThanOrEqual(70);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: '.runtime/climate-counts-mobile.png' });
  expect(await jobs(page)).toBe(0);
});
