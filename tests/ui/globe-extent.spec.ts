import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import { longitudeSpan } from '../../shared/world-extent';
import type { WorkspaceEnvelope } from '../../shared/model';
async function workspace(request: import('@playwright/test').APIRequestContext) {
  const res = await request.get('/api/workspace');
  expect(new URL(res.url()).port).toBe('3311');
  const value = (await res.json()) as WorkspaceEnvelope;
  expect(value.mode).toBe('demo');
  return value;
}
test('globe chooses regional bounds without numeric coordinate entry and global remains the default', async ({
  page,
  request,
}) => {
  const current = await workspace(request);
  expect(
    (
      await request.put('/api/workspace', {
        data: { data: createSeed(), revision: current.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  const creation = page.getByRole('dialog', { name: '绘制新的疆域' });
  await creation.getByLabel('地图名称').fill('星球北境');
  await creation.getByLabel('地图尺度').selectOption('region');
  await creation.getByRole('radio', { name: '按照色块生成', exact: true }).check();
  await creation.getByRole('button', { name: /选择星球方位与范围/ }).click();
  const globe = page.getByRole('dialog', { name: '选择地图在星球上的范围', exact: true });
  await expect(globe.locator('[data-globe-selection="global"]')).toBeVisible();
  await globe.getByRole('button', { name: '区域', exact: true }).click();
  const climate = globe.getByRole('region', { name: '选区气候与生态预览' });
  await expect(climate).toHaveAttribute('aria-busy', 'false');
  const warm = Number(
    await climate.locator('[data-preview-temperature]').getAttribute('data-preview-temperature'),
  );
  const selected = await globe.locator('[data-globe-selection="regional"]').getAttribute('d');
  await globe.getByRole('button', { name: '放大星球', exact: true }).click();
  await globe.getByRole('button', { name: '放大星球', exact: true }).click();
  await expect(globe.locator('[data-globe-zoom]')).toHaveAttribute('data-globe-zoom', '2');
  expect(await globe.locator('[data-globe-selection="regional"]').getAttribute('d')).toBe(selected);
  await page.screenshot({ path: '.runtime/coastal-globe-zoom.png' });
  // Rotation steps scale with zoom: at 200%, sixteen 2.5° steps reach 40°N.
  // Keep the climate assertion tied to the same latitude rather than button count.
  for (let i = 0; i < 16; i++)
    await globe.getByRole('button', { name: '向北旋转', exact: true }).click();
  await expect(globe.locator('[data-globe-zoom]')).toHaveAttribute('data-globe-latitude', '40');
  await expect(climate).toHaveAttribute('aria-busy', 'false');
  expect(
    Number(
      await climate.locator('[data-preview-temperature]').getAttribute('data-preview-temperature'),
    ),
  ).toBeLessThan(warm - 15);
  await climate.getByRole('button', { name: '气温', exact: true }).click();
  await expect(climate.getByRole('img', { name: '选区气温预览图' })).toBeVisible();
  await climate.getByRole('button', { name: '降水', exact: true }).click();
  await expect(climate.getByRole('img', { name: '选区降水预览图' })).toBeVisible();
  await globe.getByRole('button', { name: '适合窗口', exact: true }).click();
  for (let i = 0; i < 18; i++)
    await globe.getByRole('button', { name: '向东旋转', exact: true }).click();
  expect(
    await globe
      .locator('[data-globe-land]')
      .evaluateAll((nodes) => nodes.every((n) => !/NaN|Infinity/.test(n.getAttribute('d') ?? ''))),
  ).toBe(true);
  await globe.getByRole('img', { name: '可旋转的三维星球' }).focus();
  await page.keyboard.press('ArrowRight');
  const sphere = await globe.getByRole('img', { name: '可旋转的三维星球' }).boundingBox();
  await page.mouse.move(sphere!.x + sphere!.width / 2, sphere!.y + sphere!.height / 2);
  await page.mouse.down();
  await page.mouse.move(sphere!.x + sphere!.width / 2 + 30, sphere!.y + sphere!.height / 2, {
    steps: 6,
  });
  await page.mouse.up();
  await expect(climate).toHaveAttribute('aria-busy', 'false');
  await page.screenshot({ path: '.runtime/climate-globe-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await globe.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: '.runtime/climate-globe-mobile.png' });
  await climate.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/coastal-globe-preview-mobile.png' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'midnight';
  });
  const contrast = await climate.locator('button[aria-pressed="true"]').evaluate((el) => {
    const style = getComputedStyle(el);
    const luminance = (s: string) =>
      s
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    const a = luminance(style.color),
      b = luminance(style.backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThan(4.5);
  await page.screenshot({ path: '.runtime/coastal-globe-preview-midnight.png' });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'parchment';
  });
  await globe.getByRole('button', { name: '使用这个范围', exact: true }).click();
  await expect(creation).toBeVisible();
  await creation.getByRole('button', { name: '创建地图', exact: true }).click();
  await expect
    .poll(async () => (await workspace(request)).data.maps.some((m) => m.name === '星球北境'))
    .toBe(true);
  const map = (await workspace(request)).data.maps.find((m) => m.name === '星球北境')!;
  const geo =
    map.editor!.generation!.version === 2 ? map.editor!.generation!.geography! : undefined;
  expect(geo?.latitudeNorth).toBe(47);
  expect(geo?.latitudeSouth).toBe(33);
  expect(longitudeSpan(geo as { longitudeWest: number; longitudeEast: number })).toBe(20);
  await page.setViewportSize({ width: 1560, height: 1100 });
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  const fresh = page.getByRole('dialog', { name: '绘制新的疆域' });
  await expect(fresh.getByRole('button', { name: /全球 · 从两极到赤道/ })).toBeVisible();
  await fresh.getByRole('button', { name: /选择星球方位与范围/ }).click();
  await page.getByRole('button', { name: '区域', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(fresh).toBeVisible();
  await expect(page.getByRole('dialog', { name: '选择地图在星球上的范围' })).toHaveCount(0);
});
