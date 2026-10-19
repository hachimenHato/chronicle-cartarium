import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import { coverPresets } from '../../shared/cover-presets';

test.beforeEach(async ({ request }) => {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  const old = await response.json();
  expect(old.mode).toBe('demo');
  expect(
    (
      await request.put('/api/workspace', { data: { data: createSeed(), revision: old.revision } })
    ).ok(),
  ).toBeTruthy();
});

test('midnight search wrappers and inputs share a single surface in libraries, global search and the guide', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '创作仪表盘', exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'midnight';
  });
  await page.getByRole('button', { name: '世界知识库', exact: true }).click();
  const field = page.locator('.library-toolbar .search-field');
  await expect(field).toHaveCSS('background-color', 'rgb(32, 42, 55)');
  await expect(field.locator('input')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await field.locator('input').fill('雾港');
  await expect(field.locator('input')).toHaveCSS('color', 'rgb(237, 243, 245)');
  await page.locator('.sidebar-search').click();
  const search = page.getByRole('dialog', { name: '搜索世界档案' });
  await expect(search.locator('.search-field')).toHaveCSS('background-color', 'rgb(32, 42, 55)');
  await expect(search.locator('input')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await search.locator('input').fill('灰羽');
  await page.screenshot({ path: '.runtime/refinement-search-midnight.png' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '创作指引', exact: true }).click();
  await expect(page.getByLabel('搜索功能介绍')).toHaveCSS('background-color', 'rgb(32, 42, 55)');
  await expect(page.getByLabel('搜索功能介绍')).toHaveCSS('color', 'rgb(237, 243, 245)');
});

test('four real cover presets preview responsively, can be saved and retain their selection after reload', async ({
  page,
  request,
}) => {
  for (const preset of coverPresets) {
    const response = await request.get(preset.url);
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('image/png');
  }
  await page.goto('/');
  await page.getByRole('button', { name: '世界知识库', exact: true }).click();
  await page.getByRole('button', { name: '打开雾港', exact: true }).click();
  await page.getByRole('button', { name: '编辑条目', exact: true }).click();
  await page.getByRole('button', { name: '选择预设封面', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '预设封面', exact: true });
  await expect(dialog.locator('.cover-preset-card')).toHaveCount(4);
  await expect
    .poll(() =>
      dialog
        .locator('img')
        .evaluateAll((images) =>
          images.every((image) => (image as HTMLImageElement).naturalWidth > 500),
        ),
    )
    .toBe(true);
  await page.screenshot({ path: '.runtime/refinement-cover-presets.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await dialog.getByRole('button', { name: '预览星辉高塔', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '预览星辉高塔', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.screenshot({ path: '.runtime/refinement-cover-presets-mobile.png' });
  await dialog.getByRole('button', { name: '使用此封面', exact: true }).click();
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/workspace')).json()).data.entities.find(
          (entity: { name: string }) => entity.name === '雾港',
        ).cover,
    )
    .toBe('/covers/astral-tower.png');
  const saved = await (await request.get('/api/workspace')).json();
  expect(saved.data.entities.find((entity: { name: string }) => entity.name === '雾港').cover).toBe(
    '/covers/astral-tower.png',
  );
  await page.setViewportSize({ width: 1560, height: 1100 });
  await page.reload();
  await page.getByRole('button', { name: '世界知识库', exact: true }).click();
  await page.getByRole('button', { name: '打开雾港', exact: true }).click();
  await expect(page.locator('.portrait-box img')).toHaveAttribute(
    'src',
    '/covers/astral-tower.png',
  );
});

test('parallel and reverse relationships keep separate paths and readable labels after manual layout and dragging', async ({
  page,
  request,
}) => {
  const old = await (await request.get('/api/workspace')).json();
  const data = createSeed();
  const actors = data.entities.filter((entity) => entity.type === 'character').slice(0, 3);
  expect(actors).toHaveLength(3);
  const [a, b, c] = actors;
  a.graphPosition = { x: 50, y: 200 };
  b.graphPosition = { x: 650, y: 200 };
  c.graphPosition = { x: 650, y: 460 };
  const links = [
    ['lane_a', a.id, b.id, '盟约'],
    ['lane_b', a.id, b.id, '亲属'],
    ['lane_c', a.id, c.id, '旧友'],
    ['lane_d', a.id, c.id, '师徒'],
    ['lane_e', b.id, a.id, '追踪'],
  ];
  data.relations = links.map(([id, sourceId, targetId, label]) => ({
    id,
    sourceId,
    targetId,
    label,
    worldId: a.worldId,
    description: '',
    kind: 'ally' as const,
  }));
  expect(
    (await request.put('/api/workspace', { data: { data, revision: old.revision } })).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '人物关系', exact: true }).click();
  const paths = page.locator('.relation-graph .react-flow__edge-path');
  await expect(paths).toHaveCount(5);
  await expect
    .poll(
      async () =>
        new Set(await paths.evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))))
          .size,
    )
    .toBe(5);
  const labels = page.locator('.relation-graph .clue-edge-label');
  await expect(labels).toHaveCount(5);
  const labelBoxes = await labels.evaluateAll((elements) =>
    elements.map((element) => {
      const r = element.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }),
  );
  for (let i = 0; i < labelBoxes.length; i++)
    for (let j = i + 1; j < labelBoxes.length; j++) {
      const p = labelBoxes[i],
        q = labelBoxes[j];
      expect(p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top).toBe(
        true,
      );
    }
  const node = page.locator(`.relation-graph .react-flow__node[data-id="${a.id}"]`);
  const bounds = await node.boundingBox();
  const grab = { x: bounds!.x + bounds!.width * 0.55, y: bounds!.y + bounds!.height * 0.8 };
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x, grab.y + 50, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get('/api/workspace')).json()).data.entities.find(
          (entity: { id: string }) => entity.id === a.id,
        ).graphPosition.y,
    )
    .toBeGreaterThan(200);
  expect(
    new Set(await paths.evaluateAll((paths) => paths.map((path) => path.getAttribute('d')))).size,
  ).toBe(5);
  await page.screenshot({ path: '.runtime/refinement-relationship-lanes.png' });
});
