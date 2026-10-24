import { expect, test } from '@playwright/test';

const identity = {
  user: { id: 'delegate', name: 'Delegado de prueba' },
  roles: [],
  mfaRequired: false,
  clubs: [{ id: 'club', name: 'Club de prueba' }],
};

test('MFA setup retries password errors and removes secrets when session expires', async ({
  page,
}) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: { ...identity, roles: ['LEAGUE_ADMIN'], mfaRequired: true },
    }),
  );
  let attempts = 0;
  await page.route('**/api/auth/two-factor/enable', (route) => {
    attempts++;
    return route.fulfill({
      status: attempts === 1 ? 400 : 200,
      json:
        attempts === 1
          ? {}
          : {
              totpURI:
                'otpauth://totp/LISFI:fixture?secret=JBSWY3DPEHPK3PXP&issuer=LISFI',
              backupCodes: ['test1-code1', 'test2-code2'],
            },
    });
  });
  await page.route('**/api/auth/two-factor/verify-totp', (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto('/');
  await page.getByLabel('Contraseña actual').fill('incorrect');
  await page
    .getByRole('button', { name: 'Configurar MFA', exact: true })
    .click();
  await expect(
    page.getByText('No pudimos iniciar la configuración.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel('Contraseña actual')).toHaveValue('');
  await page.getByLabel('Contraseña actual').fill('correct-fixture-password');
  await page
    .getByRole('button', { name: 'Configurar MFA', exact: true })
    .click();
  await expect(page.getByRole('img')).toBeVisible();
  await page.getByLabel('Guardé mis códigos de recuperación').check();
  await page.getByLabel('Código de activación').fill('123456');
  await page.getByRole('button', { name: 'Activar MFA', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Tu sesión venció. Volvé a ingresar para continuar.',
  );
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  await expect(page.getByText('test1-code1', { exact: true })).toHaveCount(0);
});

test('login, MFA challenge, session restoration and logout', async ({
  page,
}) => {
  let signedIn = false;
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn ? identity : {},
    }),
  );
  await page.route('**/api/auth/sign-in/email', async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      email: 'delegate@example.invalid',
      password: 'test-password',
      rememberMe: false,
    });
    await route.fulfill({ json: { twoFactorRedirect: true } });
  });
  await page.route('**/api/auth/two-factor/verify-totp', async (route) => {
    signedIn = route.request().postDataJSON().code === '123456';
    await route.fulfill({ status: signedIn ? 200 : 400, json: {} });
  });
  await page.route('**/api/auth/sign-out', async (route) => {
    signedIn = false;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill('delegate@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByLabel('Código de verificación').fill('000000');
  await page.getByRole('button', { name: 'Verificar código' }).click();
  await expect(page.getByRole('alert')).toContainText('No pudimos verificar');
  await page.getByLabel('Código de verificación').fill('123456');
  await page.getByRole('button', { name: 'Verificar código' }).click();
  await expect(page.getByText('Club de prueba', { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Delegado de prueba', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByLabel('Correo electrónico')).toBeVisible();
  await expect(page.getByText('Club de prueba', { exact: true })).toHaveCount(
    0,
  );
});

test('unavailable session can retry and failed credentials do not expose account details', async ({
  page,
}) => {
  let available = false;
  await page.route('**/api/me', (route) =>
    route.fulfill({ status: available ? 401 : 503, json: {} }),
  );
  await page.route('**/api/auth/sign-in/email', (route) =>
    route.fulfill({ status: 401, json: { message: 'private server detail' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('no está disponible');
  available = true;
  await page.getByRole('button', { name: 'Reintentar acceso' }).click();
  await page.getByLabel('Correo electrónico').fill('delegate@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'No pudimos iniciar sesión. Revisá tu correo y contraseña.',
  );
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveValue('');
});

test('password login loads session and flags required MFA enrollment', async ({
  page,
}) => {
  let signedIn = false;
  await page.route('**/api/me', (route) =>
    route.fulfill({
      status: signedIn ? 200 : 401,
      json: { ...identity, roles: ['LEAGUE_ADMIN'], mfaRequired: true },
    }),
  );
  await page.route('**/api/auth/sign-in/email', async (route) => {
    signedIn = true;
    await route.fulfill({ json: { user: identity.user } });
  });
  await page.goto('/');
  await page.getByLabel('Correo electrónico').fill('admin@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill('test-password');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('requiere configurar');
  await expect(
    page.getByRole('button', { name: 'Cerrar sesión' }),
  ).toBeVisible();
  await expect(page.getByText('Club de prueba', { exact: true })).toHaveCount(
    0,
  );
});
