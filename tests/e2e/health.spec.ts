import { expect, test } from '@playwright/test';

test('Vue connects to the local Worker through the Vite proxy', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'LISFI Platform' }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('API conectada');
  const response = await page.request.get('/api/health');
  expect(response.ok()).toBe(true);
  expect(await response.json()).toEqual({ status: 'ok', service: 'lisfi-api' });
});

test('reports a connection failure and allows retry', async ({ page }) => {
  await page.route('**/api/health', (route) =>
    route.fulfill({ status: 503, body: '{}' }),
  );
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('No se pudo conectar');
  await page.unroute('**/api/health');
  await page.getByRole('button', { name: 'Verificar conexión' }).click();
  await expect(page.getByRole('status')).toHaveText('API conectada');
});
