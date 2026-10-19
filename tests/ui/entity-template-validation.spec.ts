import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';

test('template validation, empty definitions and default restore keep data safe when persistence fails', async ({
  page,
  request,
}) => {
  const before = await (await request.get('/api/workspace')).json();
  const data = createSeed();
  const world = data.worlds[0];
  world.entityTemplates = { character: ['外貌描写', '信仰'] };
  data.entities.find((entity) => entity.type === 'character')!.attributes = {
    外貌描写: '银发',
    信仰: '',
    私人档案: '不能覆盖',
  };
  expect(
    (await request.put('/api/workspace', { data: { data, revision: before.revision } })).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '角色档案', exact: true }).click();
  await page.getByRole('button', { name: '模板设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模板设置' });
  await dialog.getByLabel('新增字段名称').fill('信仰');
  await dialog.getByRole('button', { name: '添加字段', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('字段名称不能重复。');
  await dialog.getByLabel('新增字段名称').fill('');
  await dialog.getByLabel('字段名称 外貌描写', { exact: true }).fill('私人档案');
  await dialog.getByRole('button', { name: '应用模板', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('已有不同内容');
  expect((await (await request.get('/api/workspace')).json()).revision).toBe(before.revision + 1);
  while (await dialog.locator('.template-field-row').count())
    await dialog
      .locator('.template-field-row')
      .first()
      .getByRole('button', { name: /移除字段/ })
      .click();
  await dialog.getByRole('button', { name: '应用模板', exact: true }).click();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const empty = await (await request.get('/api/workspace')).json();
  expect(empty.data.worlds[0].entityTemplates.character).toEqual([]);
  expect(
    empty.data.entities.find((entity: { type: string }) => entity.type === 'character').attributes,
  ).toEqual({ 外貌描写: '银发', 私人档案: '不能覆盖' });
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await page.getByRole('button', { name: /设定档案/ }).click();
  await expect(page.locator('.attribute-item')).toHaveCount(0);
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '模板设置', exact: true }).click();
  await expect(dialog.locator('.template-field-row')).toHaveCount(0);
  await dialog.getByRole('button', { name: '恢复默认字段', exact: true }).click();
  await expect(dialog.locator('.template-field-row')).toHaveCount(10);
  await page.route('**/api/workspace', (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { message: '用于回归的保存失败' } })
      : route.continue(),
  );
  await dialog.getByRole('button', { name: '应用模板', exact: true }).click();
  await expect(page.locator('.save-error')).toContainText('用于回归的保存失败');
  await expect(page.getByText('所有更改已保存', { exact: true })).toHaveCount(0);
  expect((await (await request.get('/api/workspace')).json()).revision).toBe(empty.revision);
});
