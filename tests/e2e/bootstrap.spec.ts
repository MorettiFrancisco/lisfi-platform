import { expect, test } from '@playwright/test';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';

// Test-only TOTP. Production codes are always verified by Better Auth.
function totp(secret: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  return (
    (digest.readUInt32BE(digest[digest.length - 1]! & 15) & 0x7fffffff) %
    1000000
  )
    .toString()
    .padStart(6, '0');
}

test('real Worker: bootstrap, enroll MFA, sign in and recover access', async ({
  page,
}, testInfo) => {
  // One initial administrator per isolated D1; verify mobile layout in the same flow.
  test.skip(
    testInfo.project.name !== 'chromium',
    'Singleton bootstrap runs once per database',
  );
  test.setTimeout(60000);
  const password = randomBytes(24).toString('hex');
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Alta del primer administrador' })
    .click();
  await page.getByLabel('Nombre completo').fill('Administrador de prueba');
  await page.getByLabel('Correo electrónico').fill('admin@example.invalid');
  await page.getByLabel('Contraseña nueva').fill(password);
  await page.getByLabel('Repetí la contraseña').fill(password);
  await page
    .getByLabel('Clave temporal de alta')
    .fill(process.env.LISFI_E2E_BOOTSTRAP_TOKEN!);
  await page
    .getByRole('button', { name: 'Crear administrador', exact: true })
    .click();
  await expect(
    page.getByText('Cuenta creada.', { exact: false }),
  ).toBeVisible();
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('requiere configurar');
  expect((await page.request.get('/api/clubs/any')).status()).toBe(403);
  await page.getByLabel('Contraseña actual').fill(password);
  await page
    .getByRole('button', { name: 'Configurar MFA', exact: true })
    .click();
  const qr = page.getByRole('img', {
    name: 'Código QR para configurar tu autenticador LISFI',
  });
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect(
    page.getByRole('button', { name: 'Activar MFA', exact: true }),
  ).toBeDisabled();
  // Disposable credentials in a temporary database; no user data in these previews.
  await mkdir('tmp/previews', { recursive: true });
  await page.screenshot({
    path: 'tmp/previews/mfa-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'tmp/previews/mfa-mobile.png',
    fullPage: true,
  });
  await page
    .getByText('Ingresar la clave manualmente', { exact: true })
    .click();
  const secret = (await page.locator('.secret').innerText()).trim();
  const backup = (
    await page.locator('.recovery-codes code').first().innerText()
  ).trim();
  await page.getByLabel('Guardé mis códigos de recuperación').check();
  await page.getByLabel('Código de activación').fill(totp(secret));
  await page.getByRole('button', { name: 'Activar MFA', exact: true }).click();
  await expect(
    page.getByText('Autenticación de dos pasos activada.', { exact: true }),
  ).toBeVisible();
  await expect(qr).toHaveCount(0);
  await expect(page.locator('.recovery-codes')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await page.getByLabel('Correo electrónico').fill('admin@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByLabel('Código de verificación').fill(totp(secret));
  await page
    .getByRole('button', { name: 'Verificar código', exact: true })
    .click();
  await expect(
    page.getByText('Autenticación de dos pasos activada.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
  await page.getByLabel('Correo electrónico').fill('admin@example.invalid');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'Usar un código de recuperación',
      exact: true,
    })
    .click();
  await page.getByLabel('Código de recuperación', { exact: true }).fill(backup);
  await page
    .getByRole('button', { name: 'Verificar código', exact: true })
    .click();
  await expect(
    page.getByText('Autenticación de dos pasos activada.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Cerrar sesión', exact: true })
    .click();
});
