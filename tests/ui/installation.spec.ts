import { test, expect } from '@playwright/test';
test('installation offers a real choice, empty startup works, reset fills the complete example, themes and login persist', async ({
  page,
}) => {
  test.setTimeout(90000);
  let reportCleanupWarning = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.port).toBe('3311');
    url.pathname = '/__installation' + url.pathname;
    if (url.pathname.endsWith('/api/admin/reset') && reportCleanupWarning) {
      const response = await route.fetch({ url: url.toString() });
      return route.fulfill({
        response,
        json: { ...(await response.json()), cleanupWarning: true },
      });
    }
    return route.continue({ url: url.toString() });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '数据保存在哪里？' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /本地数据库/ })).toBeChecked();
  await page.getByRole('radio', { name: /MySQL 数据库/ }).check();
  await expect(page.getByLabel('数据库主机')).toBeVisible();
  await expect(page.getByLabel('新建数据库名称')).toHaveValue(/^chronicle_cartarium_/);
  await page.getByRole('radio', { name: /本地数据库/ }).check();
  await expect(page.getByLabel('数据库主机')).toHaveCount(0);
  await page.screenshot({ path: '.runtime/beta-install-storage.png' });
  await page.getByRole('button', { name: '下一步' }).click();
  await page.getByLabel('工作台名称').fill('月汐创作室');
  await page.getByLabel('界面主题').selectOption('jade');
  await page.getByRole('button', { name: '下一步' }).click();
  await expect(page.getByLabel('填充范例内容')).not.toBeChecked();
  await page.getByLabel('用户名', { exact: true }).fill('gm');
  await page.getByLabel('登录密码', { exact: true }).fill('ui-install-password-2026');
  await page.getByLabel('再次输入密码').fill('ui-install-password-2026');
  await page.getByRole('button', { name: '完成安装并进入' }).click();
  await expect(page.getByRole('heading', { name: '你的第一个世界，从这里开始' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '工具教学' })).toBeVisible();
  await page.getByRole('button', { name: '结束工具教学' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'jade');
  await page.getByLabel('世界名称').fill('空白世界');
  await page.getByRole('button', { name: '创建空白世界' }).click();
  await expect(page.getByRole('dialog', { name: '工具教学' })).toBeVisible();
  await page.getByRole('button', { name: '结束工具教学' }).click();
  await expect(page.getByText('所有更改已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await expect(page.getByLabel('填充范例内容')).not.toBeChecked();
  await expect(page.getByRole('button', { name: '确认初始化' })).toBeDisabled();
  await page.getByLabel('请输入“初始化全部创作数据”确认').fill('初始化全部创作数据');
  await page.getByLabel('填充范例内容').check();
  reportCleanupWarning = true;
  await page.getByRole('button', { name: '确认初始化' }).click();
  await expect(page.getByRole('heading', { name: '创作仪表盘' })).toBeVisible();
  await expect(page.getByText(/部分旧图片未能清理/)).toBeVisible();
  reportCleanupWarning = false;
  await expect(page.getByRole('button', { name: '20 角色人物' })).toBeVisible();
  await page.screenshot({ path: '.runtime/beta-dashboard-example.png' });
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await page.getByLabel('更换主题').selectOption('midnight');
  await page.getByRole('button', { name: '保存工作台设置' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '创作指引', exact: true }).click();
  await page.getByRole('button', { name: '工具速查', exact: true }).click();
  await page.getByLabel('搜索功能介绍').fill('悬浮');
  await page.getByRole('button', { name: /关联导航与悬浮词条/ }).click();
  await expect(page.getByRole('heading', { name: '关联导航与悬浮词条' })).toBeVisible();
  await page.screenshot({ path: '.runtime/beta-guide-midnight.png' });
  await page.getByRole('button', { name: '地图工坊', exact: true }).click();
  await expect(page.locator('.atlas-inspector')).toBeVisible();
  expect(await page.locator('.atlas-inspector').evaluate((el) => getComputedStyle(el).color)).toBe(
    'rgb(40, 62, 54)',
  );
  await page.screenshot({ path: '.runtime/beta-map-midnight.png' });
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await page.getByRole('button', { name: '退出工作台', exact: true }).click();
  await expect(page.getByLabel('登录密码', { exact: true })).toBeVisible();
  await expect(page.locator('.startup form')).toHaveCSS('background-color', 'rgb(38, 49, 64)');
  await expect(page.locator('.startup form h1')).toHaveCSS('color', 'rgb(237, 243, 245)');
  await expect(page.getByLabel('用户名', { exact: true })).toHaveCSS(
    'background-color',
    'rgb(32, 42, 55)',
  );
  await page.screenshot({ path: '.runtime/refinement-login-midnight.png' });
  await page.getByLabel('用户名', { exact: true }).fill('gm');
  await page.getByLabel('登录密码', { exact: true }).fill('ui-install-password-2026');
  await page.getByRole('button', { name: '进入创作工作台' }).click();
  await expect(page.getByRole('heading', { name: '创作仪表盘' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'midnight');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: '创作仪表盘' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.screenshot({ path: '.runtime/beta-dashboard-mobile.png' });
  await page.setViewportSize({ width: 1560, height: 1100 });
  await page.getByRole('button', { name: '工作台设置', exact: true }).click();
  await expect(page.getByLabel('填充范例内容')).not.toBeChecked();
  await page.getByLabel('请输入“初始化全部创作数据”确认').fill('初始化全部创作数据');
  await page.getByRole('button', { name: '确认初始化' }).click();
  await expect(page.getByRole('heading', { name: '你的第一个世界，从这里开始' })).toBeVisible();
  await expect(page.getByText(/原数据与图片已自动备份/)).toBeVisible();
});
