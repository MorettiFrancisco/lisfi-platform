import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/seasons?*', (route) =>
    route.fulfill({ json: { items: [], total: 0, page: 1, pageSize: 10 } }),
  );
});

const club = {
  id: 'club',
  name: 'Club de prueba',
  slug: 'club-prueba',
  shortName: null,
  status: 'ACTIVE',
  version: 1,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  president: { id: 'president', name: 'Presidente de prueba' },
  representatives: [{ id: 'representative', name: 'Representante de prueba' }],
  technicalDirectors: [{ id: 'coach', name: 'DT de prueba' }],
  players: [{ id: 'player', name: 'Jugador de prueba' }],
};

test('club president creates a representative invitation link', async ({
  page,
}) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: {
        user: { id: 'president', name: 'President' },
        roles: [],
        mfaRequired: false,
        clubs: [{ id: club.id, name: club.name }],
        presidentClubIds: [club.id],
      },
    }),
  );
  await page.route('**/api/clubs?*', (route) =>
    route.fulfill({ json: { items: [club], total: 1, page: 1, pageSize: 10 } }),
  );
  await page.route('**/api/clubs/club', (route) =>
    route.fulfill({ json: club }),
  );
  await page.route('**/api/representative-invitations', (route) => {
    expect(route.request().postDataJSON()).toEqual({
      clubId: 'club',
      email: 'delegate@example.invalid',
      kind: 'REPRESENTATIVE',
    });
    return route.fulfill({ status: 201, json: { token: 'a'.repeat(64) } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver club Club de prueba' }).click();
  await expect(
    page.getByRole('heading', { name: 'Invitar representante' }),
  ).toBeVisible();
  await page
    .getByLabel('Correo del representante')
    .fill('delegate@example.invalid');
  await page.getByRole('button', { name: 'Generar enlace' }).click();
  await expect(
    page.getByLabel('Enlace para compartir por WhatsApp'),
  ).toHaveValue(/#representative-invitation=a{64}$/);
});

test('representative has read-only club detail and revoked access disappears from the list', async ({
  page,
}, testInfo) => {
  let revoked = false;
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: {
        user: { id: 'representative', name: 'Representante' },
        roles: [],
        mfaRequired: false,
        clubs: [{ id: club.id, name: club.name }],
      },
    }),
  );
  await page.route('**/api/clubs?*', (route) =>
    route.fulfill({
      json: {
        items: revoked ? [] : [club],
        total: revoked ? 0 : 1,
        page: 1,
        pageSize: 10,
      },
    }),
  );
  await page.route('**/api/clubs/club', (route) =>
    route.fulfill({ status: revoked ? 404 : 200, json: revoked ? {} : club }),
  );
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Nuevo club', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Ver club Club de prueba', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Club de prueba', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Presidente', exact: true }),
  ).toContainText('Presidente de prueba');
  await expect(
    page.getByRole('region', { name: 'Representantes', exact: true }),
  ).toContainText('Representante de prueba');
  await expect(
    page.getByRole('region', { name: 'Directores técnicos', exact: true }),
  ).toContainText('DT de prueba');
  await expect(
    page.getByRole('region', { name: 'Jugadores', exact: true }),
  ).toContainText('Jugador de prueba');
  await page.screenshot({
    path: `tmp/previews/estructura-club-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await expect(
    page.getByRole('button', { name: 'Editar club', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Desactivar club', exact: true }),
  ).toHaveCount(0);
  revoked = true;
  await page
    .getByRole('button', { name: 'Volver a clubes', exact: true })
    .click();
  await expect(
    page.getByText('No tenés clubes disponibles', { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Club de prueba', exact: true }),
  ).toHaveCount(0);
});

test('a stale edit preserves the draft and requires reloading before saving the latest version', async ({
  page,
}) => {
  let current = { ...club };
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: {
        user: { id: 'admin', name: 'Admin' },
        roles: ['LEAGUE_ADMIN'],
        mfaRequired: false,
        clubs: [],
      },
    }),
  );
  await page.route('**/api/clubs?*', (route) =>
    route.fulfill({
      json: { items: [current], total: 1, page: 1, pageSize: 10 },
    }),
  );
  await page.route('**/api/clubs/club', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      if (body.version === 1) {
        current = {
          ...current,
          version: 2,
          name: 'Cambio de otro administrador',
        };
        await route.fulfill({
          status: 409,
          json: { error: 'Club was modified' },
        });
      } else {
        expect(body.version).toBe(2);
        current = { ...current, name: body.name, version: 3 };
        await route.fulfill({ json: current });
      }
    } else await route.fulfill({ json: current });
  });
  await page.goto('/');
  await page
    .getByRole('button', { name: 'Ver club Club de prueba', exact: true })
    .click();
  await page.getByRole('button', { name: 'Editar club', exact: true }).click();
  await page.getByLabel('Nombre del club').fill('Mi borrador');
  await page.getByRole('button', { name: 'Guardar club', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Otra persona modificó');
  await expect(page.getByLabel('Nombre del club')).toHaveValue('Mi borrador');
  await page
    .getByRole('button', { name: 'Recargar club', exact: true })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Cambio de otro administrador',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Editar club', exact: true }).click();
  await page.getByLabel('Nombre del club').fill('Nombre final');
  await page.getByRole('button', { name: 'Guardar club', exact: true }).click();
  await expect(
    page.getByText('Club guardado correctamente.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Nombre final', exact: true }),
  ).toBeVisible();
});

test('assignment form and approval queue show the proposed changes', async ({
  page,
}) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/me', (route) =>
    route.fulfill({
      json: {
        user: { id: 'admin', name: 'Admin' },
        roles: ['LEAGUE_ADMIN'],
        mfaRequired: false,
        clubs: [],
      },
    }),
  );
  await page.route('**/api/clubs?*', (route) =>
    route.fulfill({ json: { items: [club], total: 1, page: 1, pageSize: 10 } }),
  );
  await page.route('**/api/clubs/club', (route) =>
    route.fulfill({ json: club }),
  );
  await page.route('**/api/changes', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      requests.push(body);
      await route.fulfill({
        status: 201,
        json: { id: 'new', status: 'PENDING' },
      });
    } else
      await route.fulfill({
        json: {
          items: [
            {
              id: 'pending',
              kind: 'PRESIDENT',
              clubId: club.id,
              clubName: club.name,
              requesterName: 'Representante',
              status: 'PENDING',
              approvals: 1,
              approvedByMe: 0,
              payload: {
                name: 'María Prueba',
                previousPresidentName: 'Presidente anterior',
              },
            },
          ],
        },
      });
  });
  await page.route('**/api/changes/pending/approve', (route) =>
    route.fulfill({ json: { status: 'APPLIED' } }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Ver club Club de prueba' }).click();
  await page.getByRole('button', { name: 'Solicitar asignación' }).click();
  await page.getByLabel('¿Qué querés solicitar?').selectOption('PLAYER');
  await page.getByLabel('Nombre', { exact: true }).fill('Ana');
  await page.getByLabel('Apellido', { exact: true }).fill('Prueba');
  await page.getByRole('button', { name: 'Enviar solicitud' }).click();
  expect(requests).toEqual([
    { kind: 'PLAYER', clubId: club.id, firstName: 'Ana', lastName: 'Prueba' },
  ]);
  await expect(
    page.getByText('Solicitud enviada.', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Reemplaza a Presidente anterior')).toBeVisible();
  await page.getByRole('button', { name: 'Aprobar', exact: true }).click();
});
