import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';

test('template fields rename safely, persist by world and type, initialize all creation paths and survive backups', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const before = await (await request.get('/api/workspace')).json();
  const data = createSeed();
  const world = data.worlds[0];
  const person = data.entities.find((entity) => entity.type === 'character')!;
  person.attributes = {
    '身份 / 职业': '巡林人',
    外貌特征: '银发琥珀眼',
    秘密与线索: '保留旧资料',
    弱点与恐惧: '',
  };
  const otherWorld = { ...world, id: 'template_other_world', name: '模板隔离世界' };
  const otherPerson = {
    ...person,
    id: 'template_other_person',
    worldId: otherWorld.id,
    name: '隔离角色',
  };
  data.worlds.push(otherWorld);
  data.entities.push(otherPerson);
  expect(
    (await request.put('/api/workspace', { data: { data, revision: before.revision } })).ok(),
  ).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '角色档案', exact: true }).click();
  await page.getByRole('button', { name: '模板设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '模板设置', exact: true });
  await expect(dialog.getByLabel('设定类型')).toHaveValue('character');
  await dialog.getByLabel('字段名称 外貌特征', { exact: true }).fill('外貌描写');
  await dialog.getByLabel('新增字段名称').fill('信仰');
  await dialog.getByRole('button', { name: '添加字段', exact: true }).click();
  await dialog.getByRole('button', { name: '移除字段 弱点与恐惧', exact: true }).click();
  await dialog.getByRole('button', { name: '移除字段 秘密与线索', exact: true }).click();
  await dialog.getByRole('button', { name: '上移字段 信仰', exact: true }).click();
  await page.screenshot({ path: '.runtime/template-settings-desktop.png' });
  await dialog.getByRole('button', { name: '应用模板', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  let snapshot = await (await request.get('/api/workspace')).json();
  let saved = snapshot.data.entities.find((entity: { id: string }) => entity.id === person.id);
  expect(saved.attributes.外貌描写).toBe('银发琥珀眼');
  expect(saved.attributes.外貌特征).toBeUndefined();
  expect(saved.attributes['弱点与恐惧']).toBeUndefined();
  expect(saved.attributes['秘密与线索']).toBe('保留旧资料');
  expect(snapshot.data.worlds[0].entityTemplates.character.at(-2)).toBe('信仰');
  expect(snapshot.data.worlds[1].entityTemplates).toBeUndefined();
  expect(
    snapshot.data.entities.find((entity: { id: string }) => entity.id === otherPerson.id),
  ).toEqual(otherPerson);
  await page.locator('main').getByRole('button', { name: person.name, exact: true }).click();
  await page.getByRole('button', { name: /设定档案/ }).click();
  await expect(page.getByText('银发琥珀眼', { exact: true })).toBeVisible();
  await expect(page.getByText('条目额外字段', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '模板设置', exact: true }).click();
  await expect(dialog.getByLabel('字段名称 外貌描写', { exact: true })).toHaveValue('外貌描写');
  await dialog.getByLabel('字段名称 外貌描写', { exact: true }).fill('取消测试');
  page.once('dialog', (event) => event.accept());
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  expect((await (await request.get('/api/workspace')).json()).revision).toBe(snapshot.revision);
  await page.getByRole('button', { name: '返回知识库', exact: true }).click();
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await page.getByLabel('条目名称', { exact: true }).fill('模板新角色');
  await page.getByRole('button', { name: /设定档案/ }).click();
  await page.getByLabel('外貌描写', { exact: true }).fill('墨蓝长发');
  await page.getByLabel('信仰', { exact: true }).fill('星海之母');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  snapshot = await (await request.get('/api/workspace')).json();
  saved = snapshot.data.entities.find((entity: { name: string }) => entity.name === '模板新角色');
  expect(saved.attributes.信仰).toBe('星海之母');
  expect(saved.attributes['秘密与线索']).toBeUndefined();
  await page.reload();
  await page.getByRole('button', { name: '世界知识库', exact: true }).click();
  await page.getByLabel('按类型筛选').selectOption('religion');
  await page.getByRole('button', { name: '模板设置', exact: true }).click();
  await expect(dialog.getByLabel('设定类型')).toHaveValue('religion');
  await expect(dialog.getByLabel('字段名称 神祇与领域', { exact: true })).toHaveValue('神祇与领域');
  await dialog.getByLabel('设定类型').selectOption('faction');
  while (await dialog.locator('.template-field-row').count())
    await dialog
      .locator('.template-field-row')
      .first()
      .getByRole('button', { name: /移除字段/ })
      .click();
  await dialog.getByLabel('新增字段名称').fill('边境法令');
  await dialog.getByRole('button', { name: '添加字段', exact: true }).click();
  await dialog.getByLabel('新增字段名称').fill('主权来源');
  await dialog.getByRole('button', { name: '添加字段', exact: true }).click();
  await dialog.getByRole('button', { name: '应用模板', exact: true }).click();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await page.getByRole('button', { name: '疆域分区', exact: true }).click();
  await page.getByRole('button', { name: '快速创建国家', exact: false }).click();
  const quick = page.getByRole('dialog', { name: '快速创建国家' });
  await expect(quick.getByText('边境法令', { exact: true })).toBeVisible();
  await expect(quick.getByText('主权来源', { exact: true })).toBeVisible();
  await quick.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /导出创作 JSON/ }).click();
  const download = await downloadPromise;
  const file = await download.path();
  const backup = JSON.parse(await (await import('node:fs/promises')).readFile(file!, 'utf8'));
  expect(backup.data.worlds[0].entityTemplates).toEqual(
    (await (await request.get('/api/workspace')).json()).data.worlds[0].entityTemplates,
  );
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '角色档案', exact: true }).click();
  await page.getByRole('button', { name: '模板设置', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await dialog.getByRole('button', { name: '应用模板', exact: true }).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button', { name: '应用模板', exact: true })).toBeVisible();
  await page.screenshot({ path: '.runtime/template-settings-mobile.png' });
});
