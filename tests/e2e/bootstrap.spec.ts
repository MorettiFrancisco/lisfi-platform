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

test('real Worker: administrators, MFA, club invitations and approvals', async ({
  page,
}, testInfo) => {
  // One initial administrator per isolated D1; verify mobile layout in the same flow.
  test.skip(
    testInfo.project.name !== 'chromium',
    'Singleton bootstrap runs once per database',
  );
  test.setTimeout(180000);
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
  // Swagger uses the same-origin browser session and must not bypass MFA.
  await page.goto('/docs/api');
  await expect(page.locator('.swagger-ui')).toContainText('LISFI API');
  await page
    .locator('.opblock')
    .filter({ hasText: '/api/me' })
    .locator('.opblock-summary')
    .click();
  await page.getByRole('button', { name: 'Try it out' }).click();
  await page.getByRole('button', { name: 'Execute' }).click();
  await expect(page.locator('.responses-inner')).toContainText(
    'Administrador de prueba',
  );
  await page.goto('/');
  await expect(
    page.getByText('Administrador de prueba', { exact: true }),
  ).toBeVisible();
  // The first administrator may request a club, but cannot create it alone.
  await page.getByRole('button', { name: 'Nuevo club', exact: true }).click();
  await page.getByLabel('Nombre del club').fill('Estrella del Sur');
  await page.getByLabel('Nombre corto (opcional)').fill('Estrella');
  await page.getByLabel('Identificador del club').fill('estrella-sur');
  await page
    .getByRole('button', { name: 'Solicitar alta', exact: true })
    .click();
  await expect(
    page.getByText('Solicitud de alta enviada.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Alta de club: Estrella del Sur')).toBeVisible();
  await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await expect(
    page.getByText('Pendiente · 1/2 aprobaciones', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Ya aprobaste', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.club-list li')).toHaveCount(0);
  // The original administrator creates an invitation; the second person chooses
  // their own password, enrolls MFA, and completes the outstanding approval.
  await page
    .getByLabel('Correo de la persona invitada')
    .fill('second@example.invalid');
  await page.getByRole('button', { name: 'Generar invitación' }).click();
  const invitation = await page.getByLabel('Clave de invitación').inputValue();
  expect(invitation).toMatch(/^[a-f0-9]{64}$/);
  const secondContext = await page
    .context()
    .browser()!
    .newContext({
      extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.42' },
    });
  const second = await secondContext.newPage();
  const secondPassword = randomBytes(24).toString('hex');
  await second.goto('http://127.0.0.1:5174');
  await second.getByRole('button', { name: 'Aceptar invitación' }).click();
  await second.getByLabel('Nombre completo').fill('Segundo administrador');
  await second.getByLabel('Correo electrónico').fill('second@example.invalid');
  await second.getByLabel('Contraseña nueva').fill(secondPassword);
  await second.getByLabel('Repetí la contraseña').fill(secondPassword);
  await second.getByLabel('Clave de invitación').fill(invitation);
  await second
    .getByRole('button', { name: 'Crear cuenta', exact: true })
    .click();
  await expect(
    second.getByText('Cuenta creada.', { exact: false }),
  ).toBeVisible();
  await second.getByLabel('Contraseña', { exact: true }).fill(secondPassword);
  await second.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('requiere configurar');
  expect(
    (await second.request.get('http://127.0.0.1:5174/api/clubs')).status(),
  ).toBe(403);
  await second.getByLabel('Contraseña actual').fill(secondPassword);
  await second
    .getByRole('button', { name: 'Configurar MFA', exact: true })
    .click();
  await second
    .getByText('Ingresar la clave manualmente', { exact: true })
    .click();
  const secondSecret = (await second.locator('.secret').innerText()).trim();
  await second.getByLabel('Guardé mis códigos de recuperación').check();
  await second.getByLabel('Código de activación').fill(totp(secondSecret));
  await second
    .getByRole('button', { name: 'Activar MFA', exact: true })
    .click();
  await expect(
    second.getByText('Alta de club: Estrella del Sur'),
  ).toBeVisible();
  await second.getByRole('button', { name: 'Aprobar', exact: true }).click();
  await expect(
    second.getByText('Segunda aprobación registrada', { exact: false }),
  ).toBeVisible();
  await expect(second.locator('.club-list')).toContainText('Estrella del Sur');
  // End-to-end: league invites the president, who invites a representative;
  // neither approval alone can give the representative access to the club.
  await second
    .getByRole('button', { name: 'Ver club Estrella del Sur' })
    .click();
  const presidentPanel = second.getByRole('region', {
    name: 'Invitar presidente',
  });
  await presidentPanel
    .getByLabel('Correo de la persona invitada')
    .fill('president@example.invalid');
  await presidentPanel.getByRole('button', { name: 'Generar enlace' }).click();
  const presidentLink = await presidentPanel
    .getByLabel('Enlace para compartir por WhatsApp')
    .inputValue();
  const presidentContext = await page
    .context()
    .browser()!
    .newContext({ extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.43' } });
  const president = await presidentContext.newPage();
  const presidentPassword = randomBytes(24).toString('hex');
  await president.goto(presidentLink);
  await president.getByLabel('Nombre completo').fill('Presidenta de prueba');
  await president
    .getByLabel('Correo electrónico')
    .fill('president@example.invalid');
  await president.getByLabel('Contraseña nueva').fill(presidentPassword);
  await president.getByLabel('Repetí la contraseña').fill(presidentPassword);
  await president.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(
    president.getByText('Cuenta creada.', { exact: false }),
  ).toBeVisible();
  await president
    .getByLabel('Contraseña', { exact: true })
    .fill(presidentPassword);
  await president
    .getByRole('button', { name: 'Ingresar', exact: true })
    .click();
  await president
    .getByRole('button', { name: 'Ver club Estrella del Sur' })
    .click();
  const representativePanel = president.getByRole('region', {
    name: 'Invitar representante',
  });
  await representativePanel
    .getByLabel('Correo de la persona invitada')
    .fill('delegate@example.invalid');
  await representativePanel
    .getByRole('button', { name: 'Generar enlace' })
    .click();
  const delegateLink = await representativePanel
    .getByLabel('Enlace para compartir por WhatsApp')
    .inputValue();
  const delegateContext = await page
    .context()
    .browser()!
    .newContext({ extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.44' } });
  const delegate = await delegateContext.newPage();
  const delegatePassword = randomBytes(24).toString('hex');
  await delegate.goto(delegateLink);
  await delegate.getByLabel('Nombre completo').fill('Representante de prueba');
  await delegate
    .getByLabel('Correo electrónico')
    .fill('delegate@example.invalid');
  await delegate.getByLabel('Contraseña nueva').fill(delegatePassword);
  await delegate.getByLabel('Repetí la contraseña').fill(delegatePassword);
  await delegate.getByRole('button', { name: 'Crear cuenta' }).click();
  await delegate
    .getByLabel('Contraseña', { exact: true })
    .fill(delegatePassword);
  await delegate.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(
    delegate.getByText('No tenés clubes disponibles', { exact: false }),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Ver club Estrella del Sur' }).click();
  const requestFirst = page
    .locator('.request-list li')
    .filter({ hasText: 'Incorporación solicitada' });
  await requestFirst
    .getByRole('button', { name: 'Aprobar', exact: true })
    .click();
  await expect(requestFirst).toContainText('1/2 aprobaciones');
  await delegate.reload();
  await expect(
    delegate.getByText('No tenés clubes disponibles', { exact: false }),
  ).toBeVisible();
  await second.getByRole('button', { name: 'Actualizar solicitudes' }).click();
  const requestSecond = second
    .locator('.request-list li')
    .filter({ hasText: 'Incorporación solicitada' });
  await requestSecond
    .getByRole('button', { name: 'Aprobar', exact: true })
    .click();
  await expect(requestSecond).toContainText('Aplicada');
  await delegate.reload();
  await expect(delegate.locator('.club-list')).toContainText(
    'Estrella del Sur',
  );
  // A second independent representative follows the same approval workflow.
  await representativePanel
    .getByLabel('Correo de la persona invitada')
    .fill('delegate-two@example.invalid');
  await representativePanel
    .getByRole('button', { name: 'Generar enlace' })
    .click();
  const secondDelegateLink = await representativePanel
    .getByLabel('Enlace para compartir por WhatsApp')
    .inputValue();
  const secondDelegateContext = await page
    .context()
    .browser()!
    .newContext({ extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.45' } });
  const secondDelegate = await secondDelegateContext.newPage();
  const secondDelegatePassword = randomBytes(24).toString('hex');
  await secondDelegate.goto(secondDelegateLink);
  await secondDelegate
    .getByLabel('Nombre completo')
    .fill('Segundo representante');
  await secondDelegate
    .getByLabel('Correo electrónico')
    .fill('delegate-two@example.invalid');
  await secondDelegate
    .getByLabel('Contraseña nueva')
    .fill(secondDelegatePassword);
  await secondDelegate
    .getByLabel('Repetí la contraseña')
    .fill(secondDelegatePassword);
  await secondDelegate.getByRole('button', { name: 'Crear cuenta' }).click();
  await secondDelegate
    .getByLabel('Contraseña', { exact: true })
    .fill(secondDelegatePassword);
  await secondDelegate
    .getByRole('button', { name: 'Ingresar', exact: true })
    .click();
  await expect(
    secondDelegate.getByText('No tenés clubes disponibles', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Actualizar solicitudes' }).click();
  const pendingFirst = page
    .locator('.request-list li')
    .filter({ hasText: 'delegate-two@example.invalid' });
  await pendingFirst
    .getByRole('button', { name: 'Aprobar', exact: true })
    .click();
  await second.getByRole('button', { name: 'Actualizar solicitudes' }).click();
  const pendingSecond = second
    .locator('.request-list li')
    .filter({ hasText: 'delegate-two@example.invalid' });
  await pendingSecond
    .getByRole('button', { name: 'Aprobar', exact: true })
    .click();
  await secondDelegate.reload();
  await expect(secondDelegate.locator('.club-list')).toContainText(
    'Estrella del Sur',
  );
  await secondDelegateContext.close();
  await delegateContext.close();
  await presidentContext.close();
  await secondContext.close();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Nueva temporada' }).click();
  await page
    .getByLabel('Nombre de la temporada')
    .fill('Temporada de prueba 2027');
  await page.getByLabel('Año', { exact: true }).fill('2027');
  await page.getByLabel('Fecha de inicio').fill('2027-03-01');
  await page.getByLabel('Fecha de fin').fill('2027-12-01');
  await page
    .locator('.seasons-panel')
    .screenshot({ path: 'tmp/previews/temporada-formulario.png' });
  await page.getByRole('button', { name: 'Crear borrador' }).click();
  await expect(page.getByText('Temporada creada como borrador.')).toBeVisible();
  await page.getByRole('button', { name: 'Activar temporada' }).click();
  await page.getByRole('button', { name: 'Confirmar activación' }).click();
  await expect(page.getByText('Temporada activada.')).toBeVisible();
  await page
    .locator('.seasons-panel')
    .screenshot({ path: 'tmp/previews/temporada-activa.png' });
  await page.setViewportSize({ width: 360, height: 800 });
  await page
    .locator('.seasons-panel')
    .screenshot({ path: 'tmp/previews/temporada-movil.png' });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Cerrar temporada' }).click();
  await page.getByRole('button', { name: 'Confirmar cierre' }).click();
  await expect(
    page.getByText('Temporada cerrada.', { exact: false }),
  ).toBeVisible();
  await expect(page.locator('.season-list')).toContainText('Cerrada');
  await page.getByRole('button', { name: 'Ver actividad' }).click();
  await expect(page.locator('.audit-list')).toContainText('Temporada cerrada');
  await expect(page.locator('.audit-list')).toContainText(
    'Temporada de prueba 2027',
  );
  await page
    .locator('.audit-panel')
    .screenshot({ path: 'tmp/previews/actividad-movil.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .locator('.audit-panel')
    .screenshot({ path: 'tmp/previews/actividad-desktop.png' });
  await page.getByLabel('Tipo', { exact: true }).selectOption('SEASON');
  await page.getByRole('button', { name: 'Buscar actividad' }).click();
  await expect(page.locator('.audit-list > li')).toHaveCount(3);
  await expect(page.locator('.audit-list')).not.toContainText(
    'Solicitud aprobada',
  );
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
