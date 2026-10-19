import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import { addGeographicFixture } from '../fixtures/geographic';
import { validateWorkspace } from '../../server/validation';
import { generationSignature } from '../../src/lib/generated-map';
import type { WorkspaceEnvelope } from '../../shared/model';

async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const value = (await response.json()) as WorkspaceEnvelope;
  expect(value.mode).toBe('demo');
  return value;
}
async function openPlaces(page: Page) {
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '地名与地点', exact: true }).click();
  await expect(page.locator('.map-places-panel')).toBeVisible();
}
async function jobs(page: Page) {
  return page.evaluate(() => (window as unknown as { __placeJobs: number }).__placeJobs);
}
test.beforeEach(async ({ page, request }) => {
  await page.addInitScript(() => {
    const tracked = window as unknown as { __placeJobs: number };
    tracked.__placeJobs = 0;
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown, ...args: unknown[]) {
      const job = message as { signature?: unknown; generation?: unknown } | null;
      if (job && typeof job.signature === 'string' && job.generation) tracked.__placeJobs++;
      return Reflect.apply(original, this, [message, ...args]);
    };
  });
  const old = await workspace(request),
    data = addGeographicFixture(createSeed());
  const map = data.maps[0],
    recipe = map.editor!.generation;
  expect(recipe?.version).toBe(2);
  if (recipe?.version === 2) {
    recipe.geography!.sketchMode = 'strict';
    recipe.settlementCounts = { city: 1, town: 1, village: 0, castle: 0, camp: 0 };
    recipe.settlementNames = { city_0: '银帆城', town_0: '南湾镇' };
    recipe.settlementLinks = {};
  }
  map.pins = [
    {
      id: 'place_pin',
      x: 260,
      y: 180,
      label: '石灯遗迹',
      description: '手工标记',
      kind: 'landmark',
    },
  ];
  data.worlds[0].entityTemplates = { location: ['地方习俗', '交通资源'] };
  const normalized = validateWorkspace(data),
    next = normalized.maps[0];
  next.editor!.generated!.signature = generationSignature(
    next.editor!.regions,
    next.width,
    next.height,
    next.editor!.generation,
    next.scaleKm,
    next.kind,
  );
  const response = await request.put('/api/workspace', {
    data: { data: normalized, revision: old.revision },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  await page.goto('/');
  await openPlaces(page);
  await expect(page.locator('[data-terrain-composite="true"]')).toHaveAttribute(
    'data-terrain-pending',
    'false',
  );
});

test('one place index edits all names, shares port associations, creates location pages atomically and reloads without generation', async ({
  page,
  request,
}) => {
  const panel = page.locator('.map-places-panel');
  for (const name of [
    '城市名称 city_0',
    '大陆名称 geo_continent',
    '港口名称 geo_port_0',
    '地图标记名称 place_pin',
  ])
    await expect(panel.getByLabel(name, { exact: true })).toBeVisible();
  await expect(panel.getByLabel('国家名称 geo_country_0', { exact: true })).toBeVisible();
  await expect(page.locator('.geography-panel select[aria-label="地理图层"]')).toHaveCount(0);
  expect(await jobs(page)).toBe(0);
  await panel.getByLabel('城市名称 city_0', { exact: true }).fill('樱灯都');
  await panel.getByLabel('城市名称 city_0', { exact: true }).blur();
  await panel.getByLabel('地图标记名称 place_pin', { exact: true }).fill('石灯古迹');
  await panel.getByLabel('地图标记名称 place_pin', { exact: true }).blur();
  const location = (await workspace(request)).data.entities.find(
    (entity) => entity.type === 'location' && entity.visibility === 'public',
  )!;
  await panel.getByLabel('关联档案 city_0', { exact: true }).selectOption(location.id);
  await expect(panel.getByLabel('关联档案 geo_port_0', { exact: true })).toHaveValue(location.id);
  await panel.getByLabel('关联档案 geo_port_0', { exact: true }).selectOption('');
  await expect(panel.getByLabel('关联档案 city_0', { exact: true })).toHaveValue('');
  const continent = panel
    .locator('.map-place-card')
    .filter({ has: page.getByLabel('大陆名称 geo_continent', { exact: true }) });
  await continent.getByRole('button', { name: '建立条目', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '快速创建大陆条目' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: '条目名称', exact: true }).fill('樱灯大陆档案');
  await dialog
    .getByRole('textbox', { name: '摘要', exact: true })
    .fill('可供深入补充的大陆位置与文化交通档案。');
  await dialog.getByRole('button', { name: '创建并关联', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      const data = (await workspace(request)).data;
      const entity = data.entities.find((entry) => entry.name === '樱灯大陆档案');
      return (
        entity &&
        data.maps[0].editor!.generated!.geography!.areas.find((area) => area.id === 'geo_continent')
          ?.entityId === entity.id
      );
    })
    .toBeTruthy();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const saved = (await workspace(request)).data;
  const created = saved.entities.find((entry) => entry.name === '樱灯大陆档案')!;
  expect(created.type).toBe('location');
  expect(created.attributes).toHaveProperty('地方习俗');
  expect(created.attributes).toHaveProperty('交通资源');
  expect(saved.maps[0].pins[0].label).toBe('石灯古迹');
  const recipe = saved.maps[0].editor!.generation;
  expect(recipe?.version === 2 && recipe.settlementLinks?.city_0).toBeUndefined();
  expect(recipe?.version === 2 && recipe.settlementNames?.city_0).toBe('樱灯都');
  expect(await jobs(page)).toBe(0);
  await page.reload();
  await openPlaces(page);
  await expect(panel.getByLabel('城市名称 city_0', { exact: true })).toHaveValue('樱灯都');
  await expect(panel.getByLabel('地图标记名称 place_pin', { exact: true })).toHaveValue('石灯古迹');
  await expect(panel.getByLabel('关联档案 geo_continent', { exact: true })).toHaveValue(created.id);
  expect(await jobs(page)).toBe(0);
  await page.screenshot({ path: '.runtime/map-places-unified-desktop.png' });
});

test('failed place save keeps the editable draft and reports failure instead of reporting saved', async ({
  page,
  request,
}) => {
  const before = (await workspace(request)).data.maps[0].pins[0].label;
  await page.route('**/api/workspace', async (route) => {
    if (route.request().method() === 'PUT')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '地点保存测试失败' }),
      });
    else await route.continue();
  });
  const name = page.getByLabel('地图标记名称 place_pin', { exact: true });
  await name.fill('尚未成功保存的遗迹');
  await name.blur();
  await expect(page.getByText(/地点保存测试失败/).first()).toBeVisible();
  await expect(page.getByText('所有更改已保存', { exact: true })).toHaveCount(0);
  await expect(name).toHaveValue('尚未成功保存的遗迹');
  expect((await workspace(request)).data.maps[0].pins[0].label).toBe(before);
  expect(await jobs(page)).toBe(0);
});
