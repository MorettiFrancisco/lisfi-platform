import { expect, test } from '@playwright/test';

test('documentation loads locally and can execute health', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:5174/'))
      external.push(request.url());
  });
  await page.goto('/docs/api');
  await expect(page.locator('.swagger-ui')).toContainText('LISFI API');
  await expect(page.locator('.swagger-ui')).toContainText('/api/health');
  await page.locator('#operations-Sistema-get_api_health').click();
  await page.getByRole('button', { name: 'Try it out' }).click();
  await page.getByRole('button', { name: 'Execute' }).click();
  await expect(page.locator('.responses-inner')).toContainText('lisfi-api');
  expect(external).toEqual([]);
});
