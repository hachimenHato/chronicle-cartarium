import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

test('globe keeps land and graticules clipped through equatorial, polar and dateline views', async ({
  page,
  request,
}) => {
  const oldResponse = await request.get('/api/workspace');
  expect(new URL(oldResponse.url()).port).toBe('3311');
  const old = (await oldResponse.json()) as WorkspaceEnvelope;
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
  await creation.getByRole('button', { name: /选择星球方位与范围/ }).click();
  const globe = page.getByRole('dialog', { name: '选择地图在星球上的范围', exact: true });
  const sphere = globe.getByRole('img', { name: '可旋转的三维星球' });
  await expect(globe.locator('[data-globe-selection=global]')).toBeVisible();
  for (const [label, count] of [
    ['向东旋转', 2],
    ['向北旋转', 16],
    ['向东旋转', 18],
    ['向南旋转', 32],
  ] as const) {
    for (let i = 0; i < count; i++)
      await globe.getByRole('button', { name: label, exact: true }).click();
    expect(
      await sphere.evaluate((el) =>
        [...el.querySelectorAll('[data-globe-land],[data-globe-graticule]')].every(
          (p) => !/NaN|Infinity|undefined/.test(p.getAttribute('d') ?? ''),
        ),
      ),
    ).toBe(true);
  }
  await sphere.focus();
  expect(await sphere.evaluate((el) => getComputedStyle(el).userSelect)).toBe('none');
  const b = await sphere.boundingBox();
  await page.mouse.move(b!.x + b!.width * 0.5, b!.y + b!.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(b!.x + b!.width * 0.6, b!.y + b!.height * 0.6, { steps: 12 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.getSelection()?.toString())).not.toContain('北');
  await page.screenshot({ path: '.runtime/perf-globe-polar-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'midnight';
  });
  await sphere.scrollIntoViewIfNeeded();
  await page.screenshot({ path: '.runtime/perf-globe-polar-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await globe.getByRole('button', { name: '取消', exact: true }).click();
  await expect(creation).toBeVisible();
  const after = (await (await request.get('/api/workspace')).json()) as WorkspaceEnvelope;
  expect(after.revision).toBe(initial.revision);
  expect(after.data.maps).toEqual(initial.data.maps);
});
