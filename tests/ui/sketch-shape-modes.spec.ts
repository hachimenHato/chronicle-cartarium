import { test, expect, type APIRequestContext } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

async function workspace(request: APIRequestContext) {
  const response = await request.get('/api/workspace');
  expect(new URL(response.url()).port).toBe('3311');
  expect(response.ok()).toBeTruthy();
  const result = (await response.json()) as WorkspaceEnvelope;
  expect(result.mode).toBe('demo');
  return result;
}
test('three-stop sketch slider defaults to B, supports keyboard dragging equivalents and persists map choices', async ({
  page,
  request,
}) => {
  const current = await workspace(request);
  const saved = await request.put('/api/workspace', {
    data: { data: createSeed(), revision: current.revision },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '新地图', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '绘制新的疆域' });
  await expect(dialog.getByRole('slider', { name: '色块生成方式', exact: true })).toHaveCount(0);
  await dialog.getByRole('radio', { name: '按照色块生成', exact: true }).check();
  const slider = dialog.getByRole('slider', { name: '色块生成方式', exact: true });
  await expect(slider).toHaveValue('1');
  await expect(slider).toHaveAttribute('aria-valuetext', 'B 平衡生成');
  await slider.focus();
  await slider.press('Home');
  await expect(slider).toHaveValue('0');
  await expect(dialog.locator('.sketch-mode-control')).toContainText('完全不保留形状和大小');
  await slider.press('End');
  await expect(slider).toHaveValue('2');
  await dialog.getByLabel('地图名称').fill('严格轮廓试绘');
  await dialog.getByRole('button', { name: '创建地图', exact: true }).click();
  await expect
    .poll(async () => {
      const map = (await workspace(request)).data.maps.find((m) => m.name === '严格轮廓试绘');
      return map?.editor?.generation?.version === 2
        ? map.editor.generation.geography?.sketchMode
        : undefined;
    })
    .toBe('strict');
  const studioSlider = page.getByRole('slider', { name: '色块生成方式', exact: true });
  await expect(studioSlider).toHaveValue('2');
  await studioSlider.focus();
  await studioSlider.press('Home');
  await expect
    .poll(async () => {
      const recipe = (await workspace(request)).data.maps.find((m) => m.name === '严格轮廓试绘')
        ?.editor?.generation;
      return recipe?.version === 2 ? recipe.geography?.sketchMode : undefined;
    })
    .toBe('randomized');
  await page.reload();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  const created = (await workspace(request)).data.maps.find((map) => map.name === '严格轮廓试绘')!;
  await page.getByLabel('切换地图', { exact: true }).selectOption(created.id);
  await expect(page.getByRole('slider', { name: '色块生成方式', exact: true })).toHaveValue('0');
});
