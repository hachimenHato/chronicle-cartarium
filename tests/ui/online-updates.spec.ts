import { test, expect, type Page } from '@playwright/test';
import type { OnlineUpdateStatus, ProgramUpdateStatus } from '../../shared/update';

// All real requests go to the isolated 3311 DemoStore. Update downloads and
// installation are mocked here; this test never contacts a release server or runner.
async function fixture(page: Page) {
  const base = new URL((await page.request.get('/api/status')).url());
  expect(base.port).toBe('3311');
  const installed = await (await page.request.get('/__backups/api/status')).json();
  if (installed.setupRequired) {
    const response = await page.request.post('/__backups/api/install', {
      data: {
        storage: 'sqlite',
        title: '备份体验验证',
        theme: 'midnight',
        access: 'local',
        username: 'gm',
        password: 'ui-backup-password-2026',
        fillExample: true,
      },
    });
    expect(response.status()).toBe(201);
  } else {
    expect(
      (
        await page.request.post('/__backups/api/login', {
          data: { username: 'gm', password: 'ui-backup-password-2026' },
        })
      ).ok(),
    ).toBeTruthy();
  }
  let online: OnlineUpdateStatus = {
    currentVersion: '0.2.0-beta.18',
    platform: 'win32',
    architecture: 'x64',
    settings: { source: 'github', channel: 'preview' },
    checking: false,
    upToDate: false,
    supported: true,
  };
  let program: ProgramUpdateStatus = { mode: 'managed', phase: 'idle', message: '可以安全更新。' };
  const calls = { checks: 0, downloads: 0, applies: 0, settings: 0, cancels: 0, localPolls: 0 };
  let settingsError = false;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    expect(url.port).toBe('3311');
    const path = url.pathname;
    if (path === '/api/admin/updates' && route.request().method() === 'GET')
      return route.fulfill({ json: program });
    if (path === '/api/admin/updates/online' && route.request().method() === 'GET') {
      calls.localPolls += 1;
      return route.fulfill({ json: online });
    }
    if (path === '/api/admin/updates/online/check') {
      calls.checks += 1;
      online = {
        ...online,
        checkedAt: new Date().toISOString(),
        release: {
          version: '0.2.0-beta.19',
          name: '界面测试用新版',
          notes: '改善地图与更新体验。',
          publishedAt: '2026-10-22T00:00:00.000Z',
          releaseUrl:
            'https://github.com/hachimenHato/chronicle-cartarium/releases/tag/v0.2.0-beta.19',
          asset: {
            name: 'chronicle-cartarium-win-x64.ccupdate',
            bytes: 1000000,
            sha256: 'a'.repeat(64),
          },
        },
      };
      return route.fulfill({ json: online });
    }
    if (path === '/api/admin/updates/online/download') {
      calls.downloads += 1;
      expect(route.request().postDataJSON()).toEqual({ version: '0.2.0-beta.19' });
      online = {
        ...online,
        task: {
          id: `download-${calls.downloads}`,
          version: '0.2.0-beta.19',
          phase: 'downloading',
          received: 250000,
          total: 1000000,
          source: 'github',
          message: '正在下载更新包。',
        },
      };
      return route.fulfill({ json: online });
    }
    if (path === '/api/admin/updates/apply') {
      calls.applies += 1;
      expect(route.request().postDataJSON()).toEqual({ packageId: 'verified-package' });
      // Keep reporting prepared to verify that subsequent local polls do not
      // repeat an already-consumed automatic installation intent.
      return route.fulfill({ json: program });
    }
    if (path === '/api/admin/updates/online/cancel') {
      calls.cancels += 1;
      expect(route.request().postDataJSON()).toEqual({ id: online.task?.id });
      online = {
        ...online,
        task: { ...online.task!, phase: 'cancelled', message: '下载已取消。' },
      };
      return route.fulfill({ json: online });
    }
    if (path === '/api/admin/updates/online/settings') {
      calls.settings += 1;
      if (settingsError)
        return route.fulfill({
          status: 422,
          json: { error: 'data_protection', message: '镜像入口暂不可用，请检查配置。' },
        });
      online = {
        ...online,
        settings: route.request().postDataJSON(),
        release: undefined,
        checkedAt: undefined,
      };
      return route.fulfill({ json: online });
    }
    if (path.startsWith('/api/admin/updates/')) throw new Error(`Unexpected update API: ${path}`);
    url.pathname = '/__backups' + path;
    return route.continue({ url: url.toString() });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '工作台设置', exact: true })).toBeVisible();
  const tour = page.getByRole('button', { name: '结束工具教学', exact: true });
  if (await tour.isVisible()) await tour.click();
  const open = async () => {
    await page.getByRole('button', { name: '工作台设置', exact: true }).click();
    await expect(
      page
        .locator('[data-program-update-panel]')
        .getByRole('button', { name: '检查更新', exact: true }),
    ).toBeEnabled();
  };
  const prepare = () => {
    online = {
      ...online,
      task: {
        ...online.task!,
        phase: 'prepared',
        received: 1000000,
        packageId: 'verified-package',
        message: '签名与完整性验证通过。',
      },
    };
    program = {
      mode: 'managed',
      phase: 'prepared',
      packageId: 'verified-package',
      version: '0.2.0-beta.19',
      message: '更新包已验证。',
    };
  };
  const setVerifying = () => {
    online = {
      ...online,
      task: {
        ...online.task!,
        phase: 'verifying',
        received: 1000000,
        message: '正在验证签名与完整性。',
      },
    };
  };
  return {
    calls,
    open,
    prepare,
    setVerifying,
    panel: page.locator('[data-program-update-panel]'),
    failSettings: () => {
      settingsError = true;
    },
  };
}

test('one-click online update checks explicitly, shows progress and applies the matching package once', async ({
  page,
}) => {
  const context = await fixture(page);
  await context.open();
  const { panel, calls } = context;
  expect(calls.checks).toBe(0);
  await panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await panel.getByRole('button', { name: '下载并安全更新', exact: true }).click();
  await expect(panel.getByRole('progressbar', { name: '更新下载进度' })).toHaveAttribute(
    'value',
    '25',
  );
  await expect(panel.getByRole('button', { name: '取消下载', exact: true })).toBeEnabled();
  await page.screenshot({ path: '.runtime/online-updates-desktop.png' });
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations += 1;
  });
  context.prepare();
  await expect.poll(() => calls.applies).toBe(1);
  const polls = calls.localPolls;
  await expect.poll(() => calls.localPolls).toBeGreaterThan(polls);
  expect(calls.applies).toBe(1);
  expect(calls.checks).toBe(1);
  expect(calls.downloads).toBe(1);
  expect(navigations).toBe(0);
});

test('download cancellation is sent once and verification cannot be cancelled', async ({
  page,
}) => {
  const context = await fixture(page);
  await context.open();
  const { panel, calls } = context;
  await panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await panel.getByRole('button', { name: '下载并安全更新', exact: true }).click();
  await panel.getByRole('button', { name: '取消下载', exact: true }).click();
  await expect(panel).toContainText('下载已取消。');
  expect(calls.cancels).toBe(1);
  expect(calls.applies).toBe(0);
  await panel.getByRole('button', { name: '下载并安全更新', exact: true }).click();
  await expect(panel.getByRole('progressbar')).toBeVisible();
  context.setVerifying();
  await expect(
    panel.getByRole('button', { name: '校验中，暂不能取消', exact: true }),
  ).toBeDisabled();
  await expect(panel).toContainText('正在校验文件，尚未开始安装');
  const polls = calls.localPolls;
  await expect.poll(() => calls.localPolls).toBeGreaterThan(polls);
  expect(calls.cancels).toBe(1);
  expect(calls.applies).toBe(0);
  context.prepare();
  await expect.poll(() => calls.applies).toBe(1);
  expect(calls.downloads).toBe(2);
  expect(calls.cancels).toBe(1);
});

test('a draft started during download permanently pauses automatic installation until explicit continuation', async ({
  page,
}) => {
  const context = await fixture(page);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^世界知识库/ })
    .click();
  await page.locator('.entity-card').first().getByRole('button', { name: /^打开/ }).click();
  await context.open();
  await context.panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await context.panel.getByRole('button', { name: '下载并安全更新', exact: true }).click();
  // Exercise the actual editor and its canUpdate prop while the settings modal
  // remains mounted. Dispatch the editor action directly to simulate a late
  // asynchronous draft change behind the modal without mocking React state.
  await page.getByRole('button', { name: '编辑条目', exact: true }).dispatchEvent('click');
  const summary = page.getByPlaceholder('用于搜索结果和悬浮预览');
  await summary.fill('尚未保存的更新测试草稿', { force: true });
  await expect(context.panel).toContainText('检测到尚未保存的修改或其他数据操作');
  context.prepare();
  const continueButton = context.panel.getByRole('button', {
    name: '备份并更新至 0.2.0-beta.19',
    exact: true,
  });
  await expect(continueButton).toBeDisabled();
  await expect(summary).toHaveValue('尚未保存的更新测试草稿');
  expect(context.calls.applies).toBe(0);
  await page
    .locator('.entity-page')
    .getByRole('button', { name: '取消', exact: true })
    .dispatchEvent('click');
  await expect(continueButton).toBeEnabled();
  const polls = context.calls.localPolls;
  await expect.poll(() => context.calls.localPolls).toBeGreaterThan(polls);
  expect(context.calls.applies).toBe(0);
  await continueButton.click();
  await expect.poll(() => context.calls.applies).toBe(1);
});

test('closing settings and refreshing never resumes an old download installation intent', async ({
  page,
}) => {
  const context = await fixture(page);
  await context.open();
  await context.panel.getByRole('button', { name: '检查更新', exact: true }).click();
  await context.panel.getByRole('button', { name: '下载并安全更新', exact: true }).click();
  await expect(context.panel.getByRole('progressbar')).toBeVisible();
  await page
    .getByRole('dialog', { name: '工作台与后台设置' })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(context.panel).toHaveCount(0);
  context.prepare();
  await context.open();
  await expect(
    context.panel.getByRole('button', { name: '备份并更新至 0.2.0-beta.19', exact: true }),
  ).toBeEnabled();
  const polls = context.calls.localPolls;
  await expect.poll(() => context.calls.localPolls).toBeGreaterThan(polls);
  expect(context.calls.applies).toBe(0);
  await page.reload();
  await context.open();
  await expect(
    context.panel.getByRole('button', { name: '备份并更新至 0.2.0-beta.19', exact: true }),
  ).toBeEnabled();
  expect(context.calls.applies).toBe(0);
  expect(context.calls.checks).toBe(1);
});

test('mirror errors keep the draft, expose no built-in accelerator and remain readable on narrow screens', async ({
  page,
}) => {
  const context = await fixture(page);
  await context.open();
  const panel = context.panel;
  await panel.locator('.program-update-advanced > summary').click();
  await panel.getByRole('radio', { name: /自建镜像/ }).check();
  const mirror = panel.getByRole('textbox', { name: /^镜像入口地址/ });
  await mirror.fill('https://updates.example.com/cartarium');
  await panel.getByRole('combobox', { name: '版本渠道', exact: true }).selectOption('stable');
  context.failSettings();
  await panel.getByRole('button', { name: '保存更新设置', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('镜像入口暂不可用');
  await expect(mirror).toHaveValue('https://updates.example.com/cartarium');
  await expect(panel).toContainText('目前没有内置国内加速服务');
  await expect(panel.getByRole('button', { name: '检查更新', exact: true })).toBeDisabled();
  await expect(panel.getByRole('button', { name: '保存更新设置', exact: true })).toBeEnabled();
  expect(context.calls.settings).toBe(1);
  expect(context.calls.checks).toBe(0);
  expect(context.calls.applies).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await mirror.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  const box = await panel.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(390);
  const colors = await mirror.evaluate((element) => ({
    color: getComputedStyle(element).color,
    background: getComputedStyle(element).backgroundColor,
  }));
  expect(colors.color).not.toBe(colors.background);
  await page.screenshot({ path: '.runtime/online-updates-mobile-midnight.png' });
});
