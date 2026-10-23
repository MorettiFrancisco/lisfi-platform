import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: 'http://127.0.0.1:5174', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { browserName: 'chromium', viewport: { width: 360, height: 800 } },
    },
  ],
  webServer: [
    {
      command:
        'pnpm --filter @lisfi/api exec wrangler dev --local --ip 127.0.0.1 --port 8788',
      url: 'http://127.0.0.1:8788/api/health',
      timeout: 120000,
    },
    {
      command:
        'pnpm --filter @lisfi/web exec vite --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      env: { LISFI_API_PROXY_TARGET: 'http://127.0.0.1:8788' },
      timeout: 120000,
    },
  ],
});
