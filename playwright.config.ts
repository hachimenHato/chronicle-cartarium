import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  workers: 1,
  fullyParallel: false,
  timeout: 45000,
  expect: { timeout: 7000 },
  outputDir: '.runtime/ui-results',
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3311',
    channel:
      process.env.UI_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined),
    viewport: { width: 1560, height: 1100 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx tests/ui/server.ts',
    url: 'http://127.0.0.1:3311/api/status',
    reuseExistingServer: false,
    timeout: 20000,
  },
});
