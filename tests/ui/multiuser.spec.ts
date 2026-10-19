import { test, expect } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import type { WorkspaceEnvelope } from '../../shared/model';

test('owner configures module and individual grants; normal users see authorized content and moderators cannot use system management', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.port).toBe('3311');
    url.pathname = '/__multiuser' + url.pathname;
    await route.continue({ url: url.toString() });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByLabel('用户名', { exact: true }).fill('gm');
  await page.getByLabel('登录密码', { exact: true }).fill('ui-multiuser-password');
  await page.getByLabel('再次输入密码').fill('ui-multiuser-password');
  await page.getByRole('button', { name: '完成安装并进入' }).click();
  await page
    .getByRole('dialog', { name: '工具教学' })
    .getByRole('button', { name: '结束工具教学' })
    .click();
  const old = (await (
    await page.request.get('/__multiuser/api/workspace')
  ).json()) as WorkspaceEnvelope;
  const data = createSeed();
  const secret = data.entities.at(-1)!;
  secret.visibility = 'gm';
  data.entities.push({
    ...secret,
    id: 'hidden_extra',
    name: '尚未授权的GM秘密',
    content: '没有授权就不能查看',
    attributes: {},
  });
  expect(
    (
      await page.request.put('/__multiuser/api/workspace', {
        data: { data, revision: old.revision },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await page
    .getByRole('dialog', { name: '工具教学' })
    .getByRole('button', { name: '结束工具教学' })
    .click();
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await page.getByLabel('开启多用户模式').check();
  await expect(page.getByText('多用户模式已开启。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  const editor = page.locator('.user-permission-editor');
  await editor.getByLabel('用户名', { exact: true }).fill('player');
  await editor.getByLabel('初始密码').fill('ui-multiuser-password');
  await editor.getByLabel('角色档案创建权限').check();
  await editor.getByLabel('角色档案修改范围').selectOption('own');
  await editor.getByLabel('角色档案删除范围').selectOption('own');
  await editor.getByLabel('选择授权条目').selectOption(secret.id);
  await editor.getByLabel(`${secret.name} read`, { exact: true }).selectOption('allow');
  await editor.getByRole('button', { name: '保存用户与权限' }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '创建用户', exact: true }).click();
  await editor.getByLabel('用户名', { exact: true }).fill('assistant');
  await editor.getByLabel('初始密码').fill('ui-multiuser-password');
  await editor.getByLabel('账户级别').selectOption('moderator');
  await editor.getByRole('button', { name: '保存用户与权限' }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: '退出工作台', exact: true }).click();
  const login = async (name: string) => {
    await page.getByLabel('用户名', { exact: true }).fill(name);
    await page.getByLabel('登录密码', { exact: true }).fill('ui-multiuser-password');
    await page.getByRole('button', { name: '进入创作工作台' }).click();
    await page
      .getByRole('dialog', { name: '工具教学' })
      .getByRole('button', { name: '结束工具教学' })
      .click();
  };
  await login('player');
  const visible = (await (
    await page.request.get('/__multiuser/api/workspace')
  ).json()) as WorkspaceEnvelope;
  expect(visible.data.entities.some((e) => e.id === secret.id)).toBeTruthy();
  expect(visible.data.entities.some((e) => e.id === 'hidden_extra')).toBeFalsy();
  expect(visible.data.maps).toHaveLength(0);
  await expect(page.getByRole('button', { name: '导出世界档案', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '角色档案', exact: true }).click();
  await page.getByRole('button', { name: '创建角色', exact: true }).click();
  await page.getByLabel('条目名称').fill('玩家笔下的NPC');
  await page.getByRole('button', { name: '保存条目', exact: true }).click();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  const mine = (
    await (await page.request.get('/__multiuser/api/workspace')).json()
  ).data.entities.find((e: { name: string }) => e.name === '玩家笔下的NPC');
  expect(mine.createdBy).toMatch(/^user_/);
  await expect(page.getByRole('button', { name: '编辑条目', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /返回知识库/ }).click();
  const other = data.entities.find((e) => e.type === 'character')!;
  await page
    .locator('.entity-card')
    .filter({ hasText: other.name })
    .getByRole('button', { name: `打开${other.name}` })
    .click();
  await expect(page.getByRole('button', { name: '编辑条目', exact: true })).toBeDisabled();
  await page.screenshot({ path: '.runtime/creation-user-readonly.png' });
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '世界管理', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '多用户管理', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '退出工作台', exact: true }).click();
  await login('assistant');
  await expect(page.getByRole('button', { name: '导出世界档案', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: '多用户管理', exact: true })).toBeVisible();
  await expect(page.getByLabel('开启多用户模式')).toBeDisabled();
  await expect(page.getByLabel('更换主题')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '世界管理' })).toHaveCount(0);
  expect((await page.request.get('/__multiuser/api/backup')).status()).toBe(403);
  expect(
    (
      await page.request.put('/__multiuser/api/admin/settings', {
        data: { title: '不允许', theme: 'midnight', access: 'server' },
      })
    ).status(),
  ).toBe(403);
  await page.screenshot({ path: '.runtime/creation-moderator-users.png' });
});
