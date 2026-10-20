import { test, expect } from '@playwright/test';

test('optional login setup and later account activation work without losing the empty workbench', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.port).toBe('3311');
    url.pathname = '/__policy' + url.pathname;
    await route.continue({ url: url.toString() });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(page.getByLabel('开启登录界面')).toBeChecked();
  await page.getByLabel('开启登录界面').uncheck();
  await expect(page.getByLabel('登录密码', { exact: true })).toHaveCount(0);
  await page.getByLabel('开启多用户模式').check();
  await expect(page.getByLabel('开启登录界面')).toBeChecked();
  await expect(page.getByLabel('开启登录界面')).toBeDisabled();
  await page.getByLabel('开启多用户模式').uncheck();
  await page.getByLabel('开启登录界面').uncheck();
  await page.getByRole('button', { name: '完成安装并进入' }).click();
  await page.getByRole('button', { name: '结束工具教学' }).click();
  await expect(page.getByRole('heading', { name: '你的第一个世界，从这里开始' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '你的第一个世界，从这里开始' })).toBeVisible();
  // The empty-world introduction deliberately remains available until a world exists.
  await page.getByRole('button', { name: '结束工具教学' }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '后台设置', exact: true }).click();
  await expect(page.getByLabel('开启多用户模式')).toBeDisabled();
  await page.getByLabel('开启登录界面').check();
  await page.getByLabel('主管理员登录名').fill('gm_policy');
  await page.getByLabel('设置登录密码').fill('ui-policy-password-2026');
  await page.getByLabel('确认登录密码').fill('ui-policy-password-2026');
  await page.getByRole('button', { name: '应用登录设置' }).click();
  await expect(page.getByLabel('开启多用户模式')).toBeEnabled();
  await page.getByLabel('开启多用户模式').check();
  await expect(page.getByText('多用户模式已开启。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('开启登录界面')).toBeDisabled();
  await page.getByLabel('开启多用户模式').uncheck();
  await expect(page.getByLabel('开启登录界面')).toBeEnabled();
  await page.getByLabel('开启登录界面').uncheck();
  await page.getByLabel('主管理员当前密码', { exact: true }).fill('ui-policy-password-2026');
  await page.getByRole('button', { name: '应用登录设置' }).click();
  await expect(page.getByLabel('开启多用户模式')).toBeDisabled();
  await expect(page.getByLabel('开启登录界面')).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole('heading', { name: '你的第一个世界，从这里开始' })).toBeVisible();
});
