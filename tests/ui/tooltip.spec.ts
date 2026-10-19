import { expect, test, type Page } from '@playwright/test';
import { createSeed } from '../../shared/seed';
import { TOOLTIP_LOCK_MS, TOOLTIP_SHOW_MS } from '../../src/lib/entity-tooltip-state';

const preview = (page: Page, name: string) =>
  page.getByRole('dialog', { name: `${name}词条摘要`, exact: true });

test.beforeEach(async ({ page, request }) => {
  // This API belongs to the isolated DemoStore server, never the user's MySQL workspace.
  const current = await request.get('/api/workspace');
  expect(current.ok()).toBeTruthy();
  const { revision, mode } = await current.json();
  expect(mode).toBe('demo');
  const reset = await request.put('/api/workspace', {
    data: { revision, data: createSeed() },
  });
  expect(reset.ok()).toBeTruthy();
  await page.goto('/');
  await page.getByRole('button', { name: '世界总览', exact: true }).click();
  await expect(
    page.getByRole('main').getByRole('button', { name: '雾港', exact: true }),
  ).toBeVisible();
});

test('直接悬停逐渐填满锁图标，锁定后移开保留并能锁定内部词条，按Esc全部关闭', async ({ page }) => {
  const link = page.getByRole('main').getByRole('button', { name: '雾港', exact: true });
  const parent = preview(page, '雾港');
  await link.hover();
  await page.waitForTimeout(550);
  await expect(parent).toHaveCount(0);
  await expect(parent).toBeVisible();
  await expect(parent).toHaveAttribute('data-locked', 'false');
  const fill = parent.locator('.entity-preview-lock-fill');
  await expect(fill).toHaveCSS('animation-duration', `${TOOLTIP_LOCK_MS / 1000}s`);
  // Observe a partially filled real CSS animation, rather than mutating the timer/state.
  await expect
    .poll(async () => {
      const clip = await fill.evaluate((element) => getComputedStyle(element).clipPath);
      const percent = Number.parseFloat(clip.replace('inset(', ''));
      return percent > 0 && percent < 100;
    })
    .toBe(true);
  await expect(parent).toHaveAttribute('data-locked', 'true');
  await expect(parent.getByLabel('已锁定', { exact: true })).toBeVisible();
  await expect(fill).toHaveCSS('clip-path', 'inset(0px)');

  const bounds = await parent.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);

  await page.mouse.move(2, 2);
  await expect(parent).toBeVisible();
  await expect(parent).toHaveAttribute('data-locked', 'true');
  await parent.getByRole('button', { name: '伊莱娅·灰羽', exact: true }).hover();
  const child = preview(page, '伊莱娅·灰羽');
  await expect(child).toBeVisible();
  await expect(child).toHaveAttribute('data-locked', 'false');
  await expect(child).toHaveAttribute('data-locked', 'true');
  await page.mouse.move(2, 2);
  await expect(page.locator('[data-entity-tooltip-root]')).toHaveCount(2);
  await expect(parent).toBeVisible();
  await expect(child).toBeVisible();
  await page.screenshot({ path: '.runtime/tooltip-nested.png' });

  await page.keyboard.down('Control');
  await page.keyboard.up('Control');
  await expect(page.locator('[data-entity-tooltip-root]')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-entity-tooltip-root]')).toHaveCount(0);
});

test('不足一秒移开或等待中按Esc，不会稍后突然出现摘要', async ({ page }) => {
  const link = page.getByRole('main').getByRole('button', { name: '雾港', exact: true });
  await link.hover();
  await page.waitForTimeout(250);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(TOOLTIP_SHOW_MS + 100);
  await expect(preview(page, '雾港')).toHaveCount(0);
  await link.hover();
  await page.waitForTimeout(250);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(TOOLTIP_SHOW_MS + 100);
  await expect(preview(page, '雾港')).toHaveCount(0);
});

test('等待期间外点和窗口失焦取消显示，键盘聚焦同样延时显示并锁定', async ({ page }) => {
  const link = page.getByRole('main').getByRole('button', { name: '雾港', exact: true });
  const card = preview(page, '雾港');
  await link.hover();
  await page.waitForTimeout(250);
  await page.mouse.click(2, 2);
  await page.waitForTimeout(TOOLTIP_SHOW_MS + 100);
  await expect(card).toHaveCount(0);

  await link.hover();
  await page.waitForTimeout(250);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(TOOLTIP_SHOW_MS + 100);
  await expect(card).toHaveCount(0);

  await page.mouse.move(2, 2);
  await link.focus();
  await page.waitForTimeout(550);
  await expect(card).toHaveCount(0);
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-locked', 'false');
  await expect(card).toHaveAttribute('data-locked', 'true');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('锁定计时从卡片出现开始，显示等待不计入2.7秒', async ({ page }) => {
  await page.evaluate(() => {
    const state = window as unknown as {
      tooltipTimes: { hovered: number; shown: number; locked: number; initiallyLocked: boolean };
    };
    state.tooltipTimes = { hovered: 0, shown: 0, locked: 0, initiallyLocked: false };
    document.addEventListener(
      'mouseover',
      (event) => {
        if (
          event.target instanceof Element &&
          event.target.closest('main .entity-link')?.textContent === '雾港' &&
          !state.tooltipTimes.hovered
        )
          state.tooltipTimes.hovered = performance.now();
      },
      { capture: true },
    );
    new MutationObserver(() => {
      const card = [...document.querySelectorAll('[data-entity-tooltip-root]')].find(
        (element) => element.getAttribute('aria-label') === '雾港词条摘要',
      );
      if (card && !state.tooltipTimes.shown) {
        state.tooltipTimes.shown = performance.now();
        state.tooltipTimes.initiallyLocked = card.getAttribute('data-locked') === 'true';
      }
      if (card?.getAttribute('data-locked') === 'true' && !state.tooltipTimes.locked)
        state.tooltipTimes.locked = performance.now();
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-locked'],
    });
  });
  await page.getByRole('main').getByRole('button', { name: '雾港', exact: true }).hover();
  const card = preview(page, '雾港');
  await expect(card).toBeVisible();
  // Measure the actual DOM transitions, not a delay starting after Playwright's polling.
  // Polling may first notice the card several hundred milliseconds after it appears.
  await expect(card).toHaveAttribute('data-locked', 'true');
  const times = await page.evaluate(
    () =>
      (
        window as unknown as {
          tooltipTimes: {
            hovered: number;
            shown: number;
            locked: number;
            initiallyLocked: boolean;
          };
        }
      ).tooltipTimes,
  );
  expect(times.shown - times.hovered).toBeGreaterThanOrEqual(TOOLTIP_SHOW_MS);
  expect(times.locked - times.shown).toBeGreaterThanOrEqual(TOOLTIP_LOCK_MS);
  expect(times.initiallyLocked).toBe(false);
  await test.info().attach('actual-tooltip-timing', {
    body: JSON.stringify(times),
    contentType: 'application/json',
  });
});

test('未等满锁定时间就移出，不会留下浮窗或由旧计时器重新锁定', async ({ page }) => {
  await page.getByRole('main').getByRole('button', { name: '雾港', exact: true }).hover();
  const card = preview(page, '雾港');
  await expect(card).toHaveAttribute('data-locked', 'false');
  await page.mouse.move(2, 2);
  await expect(card).toHaveCount(0);
  // The original dwell timer would have expired by this point if it were not cancelled.
  await page.waitForTimeout(TOOLTIP_LOCK_MS);
  await expect(page.locator('[data-entity-tooltip-root]')).toHaveCount(0);
});

test('点击锁定浮窗内部会保留，点击所有浮窗外关闭父子浮窗', async ({ page }) => {
  await page.getByRole('main').getByRole('button', { name: '雾港', exact: true }).hover();
  const parent = preview(page, '雾港');
  await expect(parent).toHaveAttribute('data-locked', 'true');
  await parent.locator('header').click();
  await expect(parent).toBeVisible();
  await parent.getByRole('button', { name: '伊莱娅·灰羽', exact: true }).hover();
  const child = preview(page, '伊莱娅·灰羽');
  await expect(child).toHaveAttribute('data-locked', 'true');
  await child.locator('header').click();
  await expect(page.locator('[data-entity-tooltip-root]')).toHaveCount(2);

  await page.mouse.click(2, 2);
  await expect(page.locator('[data-entity-tooltip-root]')).toHaveCount(0);
});
