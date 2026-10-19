import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

test('town-scale globe focuses the actual range and preserves it through deep zoom and precise rotation', async ({
  page,
  request,
}) => {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  const old = (await response.json()) as WorkspaceEnvelope;
  expect(old.mode).toBe('demo');
  const saved = await request.put('/api/workspace', {
    data: { data: createSeed(), revision: old.revision },
  });
  expect(saved.ok()).toBeTruthy();
  const initial = (await saved.json()) as WorkspaceEnvelope;
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  const creation = page.getByRole('dialog', { name: '绘制新的疆域' });
  await creation.getByLabel('地图尺度').selectOption('town');
  await creation.getByRole('button', { name: /选择星球方位与范围/ }).click();
  const globe = page.getByRole('dialog', { name: '选择地图在星球上的范围', exact: true }),
    sphere = globe.getByRole('img', { name: '可旋转的三维星球', exact: true });
  await globe.getByRole('button', { name: '城镇', exact: true }).click();
  expect(Number(await sphere.getAttribute('data-globe-zoom'))).toBeGreaterThan(500);
  const range = globe.locator('[data-globe-selection="regional"]');
  const focus = await globe.getByRole('button', { name: '聚焦选区', exact: true }).boundingBox();
  const fit = await globe.getByRole('button', { name: '适合窗口', exact: true }).boundingBox();
  expect(focus!.x + focus!.width).toBeLessThanOrEqual(fit!.x);
  const size = await range.evaluate((element) => {
    const path = element as SVGGraphicsElement,
      rect = path.getBoundingClientRect(),
      viewport = path.ownerSVGElement!.getBoundingClientRect();
    return { width: rect.width / viewport.width, height: rect.height / viewport.height };
  });
  expect(Math.max(size.width, size.height)).toBeCloseTo(0.64, 2);
  expect(Math.min(size.width, size.height)).toBeGreaterThan(0.2);
  await expect(range).toHaveAttribute('vector-effect', 'non-scaling-stroke');
  await expect(globe.getByRole('img', { name: '星球整体定位示意' })).toBeVisible();
  const bounds = await globe.locator('.globe-controls output').innerText(),
    beforeLatitude = Number(await sphere.getAttribute('data-globe-latitude')),
    beforeZoom = Number(await sphere.getAttribute('data-globe-zoom'));
  await globe.getByRole('button', { name: '放大星球', exact: true }).click();
  expect(Number(await sphere.getAttribute('data-globe-zoom'))).toBeGreaterThan(beforeZoom);
  expect(await globe.locator('.globe-controls output').innerText()).toBe(bounds);
  const box = await sphere.boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(async () => Number(await sphere.getAttribute('data-globe-zoom')))
    .toBeGreaterThan(beforeZoom * 1.5);
  expect(await globe.locator('.globe-controls output').innerText()).toBe(bounds);
  await globe.getByRole('button', { name: '向北旋转', exact: true }).click();
  const delta = Number(await sphere.getAttribute('data-globe-latitude')) - beforeLatitude;
  expect(delta).toBeGreaterThan(0);
  expect(delta).toBeLessThan(0.02);
  await globe.getByRole('button', { name: '适合窗口', exact: true }).click();
  await expect(sphere).toHaveAttribute('data-globe-zoom', '1');
  await globe.getByRole('button', { name: '聚焦选区', exact: true }).click();
  expect(Number(await sphere.getAttribute('data-globe-zoom'))).toBeGreaterThan(500);
  await page.screenshot({ path: '.runtime/detail-globe-town-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await sphere.scrollIntoViewIfNeeded();
  const focusMobile = await globe
    .getByRole('button', { name: '聚焦选区', exact: true })
    .boundingBox();
  const fitMobile = await globe
    .getByRole('button', { name: '适合窗口', exact: true })
    .boundingBox();
  expect(focusMobile!.x + focusMobile!.width).toBeLessThanOrEqual(fitMobile!.x);
  await page.screenshot({ path: '.runtime/detail-globe-town-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  expect(
    await sphere.evaluate((node) =>
      [...node.querySelectorAll('path')].every(
        (path) => !/NaN|Infinity/.test(path.getAttribute('d') ?? ''),
      ),
    ),
  ).toBe(true);
  await globe.getByRole('button', { name: '取消', exact: true }).click();
  const after = (await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope;
  expect(after.revision).toBe(initial.revision);
  expect(after.data.maps).toEqual(initial.data.maps);
});
