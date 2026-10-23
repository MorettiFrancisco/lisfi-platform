import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: [
    {
      command: 'pnpm dev:api',
      url: 'http://127.0.0.1:8787/api/health',
      timeout: 120000,
    },
    { command: 'pnpm dev:web', url: 'http://127.0.0.1:5173', timeout: 120000 },
  ],
});
