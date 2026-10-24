import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';
import { createHmac, randomBytes } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import app from '../../index';
import { createAuth } from './auth';
import { createDb } from '../../db';
import {
  account,
  user,
  clubs,
  clubMemberships,
  globalRoleAssignments,
  session,
  twoFactor,
} from '../../db/schema';
import type { Bindings } from '../../env';

const origin = 'http://localhost:5173';
const password = randomBytes(24).toString('hex');
let passwordHash: string;
let mf: Miniflare;
let env: Bindings;
let cookie = '';
let ipCounter = 0;

async function request(
  path: string,
  body?: Record<string, unknown>,
  extraHeaders = {},
) {
  return app.request(
    `${origin}${path}`,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        origin,
        cookie,
        'cf-connecting-ip': `192.0.2.${ipCounter}`,
        ...extraHeaders,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    env,
  );
}

function saveCookies(response: Response) {
  const values = response.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0]);
  if (values.length) cookie = values.join('; ');
}

async function seedUser(id: string, admin = false) {
  const db = createDb(env.DB);
  await db.insert(user).values({
    id,
    name: `Fixture ${id}`,
    email: `${id}@example.invalid`,
    emailVerified: true,
  });
  await db.insert(account).values({
    id: `account-${id}`,
    accountId: id,
    providerId: 'credential',
    userId: id,
    password: passwordHash,
    updatedAt: new Date(),
  });
  if (admin)
    await db.insert(globalRoleAssignments).values({
      id: `role-${id}`,
      userId: id,
      role: 'LEAGUE_ADMIN',
      createdAt: new Date().toISOString(),
    });
}

async function login(id: string) {
  cookie = '';
  const response = await request('/api/auth/sign-in/email', {
    email: `${id}@example.invalid`,
    password,
  });
  expect(response.status, await response.clone().text()).toBe(200);
  saveCookies(response);
  return response;
}

// Test-only authenticator: production TOTP generation/verification is Better Auth's.
function totp(uri: string) {
  const secret = new URL(uri).searchParams.get('secret')!;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.toUpperCase()]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const bytes = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, '0');
}

beforeAll(async () => {
  passwordHash = await hashPassword(password);
  mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      compatibilityDate: '2026-10-22',
      d1Databases: ['DB'],
    }),
  );
  const DB = await mf.getD1Database('DB');
  env = {
    DB: DB as unknown as D1Database,
    AUTH_SECRET: randomBytes(48).toString('hex'),
    AUTH_BASE_URL: origin,
  };
  const migrations = new URL('../../../migrations/', import.meta.url);
  for (const file of (await readdir(migrations))
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = await readFile(new URL(file, migrations), 'utf8');
    await env.DB.batch(
      sql
        .split('--> statement-breakpoint')
        .filter((s) => s.trim())
        .map((s) => env.DB.prepare(s)),
    );
  }
}, 30000);

beforeEach(async () => {
  cookie = '';
  delete env.BOOTSTRAP_TOKEN;
  delete env.BOOTSTRAP_EXPIRES_AT;
  ipCounter++;
  for (const table of [
    'initial_admin_bootstrap',
    'club_memberships',
    'global_role_assignments',
    'clubs',
    'user',
    'rateLimit',
    'verification',
  ]) {
    await env.DB.prepare(`DELETE FROM "${table}"`).run();
  }
});

describe('controlled first-administrator enrollment', () => {
  function enableBootstrap() {
    env.BOOTSTRAP_TOKEN = randomBytes(32).toString('hex');
    env.BOOTSTRAP_EXPIRES_AT = new Date(Date.now() + 60000).toISOString();
    return { 'x-bootstrap-token': env.BOOTSTRAP_TOKEN };
  }
  const details = {
    name: 'First administrator',
    email: 'first@example.invalid',
    password,
  };

  it('fails closed without a valid expiring token and trusted origin', async () => {
    expect((await request('/api/bootstrap', details)).status).toBe(404);
    const headers = enableBootstrap();
    env.BOOTSTRAP_EXPIRES_AT = new Date(0).toISOString();
    expect((await request('/api/bootstrap', details, headers)).status).toBe(
      404,
    );
    env.BOOTSTRAP_EXPIRES_AT = 'invalid';
    expect((await request('/api/bootstrap', details, headers)).status).toBe(
      404,
    );
    env.BOOTSTRAP_EXPIRES_AT = new Date(Date.now() + 60000).toISOString();
    expect(
      (
        await request('/api/bootstrap', details, {
          ...headers,
          origin: 'https://evil.invalid',
        })
      ).status,
    ).toBe(403);
    expect(
      (await request('/api/bootstrap', details, { ...headers, origin: '' }))
        .status,
    ).toBe(403);
    expect((await request('/api/bootstrap', details)).status).toBe(403);
    expect(
      (
        await request('/api/bootstrap', details, {
          'x-bootstrap-token': 'wrong',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          '/api/bootstrap',
          { ...details, password: 'short' },
          headers,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          '/api/bootstrap',
          { ...details, role: 'LEAGUE_ADMIN' },
          headers,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          '/api/bootstrap',
          { ...details, name: 'x'.repeat(9000) },
          headers,
        )
      ).status,
    ).toBe(413);
    expect(await createDb(env.DB).select().from(user)).toHaveLength(0);
  });

  it('limits failed token attempts persistently', async () => {
    const headers = enableBootstrap();
    for (let i = 0; i < 5; i++)
      expect((await request('/api/bootstrap', details)).status).toBe(403);
    const response = await request('/api/bootstrap', details, headers);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(await createDb(env.DB).select().from(user)).toHaveLength(0);
  });

  it('creates a login-compatible admin once, without verified email or a session', async () => {
    const headers = enableBootstrap();
    const response = await request(
      '/api/bootstrap',
      { ...details, email: ' FIRST@example.invalid ' },
      headers,
    );
    expect(response.status, await response.clone().text()).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    const users = await createDb(env.DB).select().from(user);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      email: details.email,
      emailVerified: false,
      twoFactorEnabled: false,
    });
    const signedIn = await request('/api/auth/sign-in/email', {
      email: details.email,
      password,
    });
    expect(signedIn.status).toBe(200);
    saveCookies(signedIn);
    expect(await (await request('/api/me')).json()).toMatchObject({
      roles: ['LEAGUE_ADMIN'],
      mfaRequired: true,
    });
    expect((await request('/api/clubs/any')).status).toBe(403);
    expect(
      (
        await request(
          '/api/bootstrap',
          { ...details, email: 'second@example.invalid' },
          headers,
        )
      ).status,
    ).toBe(409);
    await env.DB.prepare('DELETE FROM global_role_assignments').run();
    await env.DB.prepare('DELETE FROM "user"').run();
    // Removing accounts or rotating the capability cannot reopen a completed bootstrap.
    expect(
      (await request('/api/bootstrap', details, enableBootstrap())).status,
    ).toBe(409);
  });

  it('serializes concurrent enrollment and leaves only the winning account', async () => {
    const headers = enableBootstrap();
    const responses = await Promise.all([
      request('/api/bootstrap', details, headers),
      request(
        '/api/bootstrap',
        { ...details, email: 'other@example.invalid' },
        headers,
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    for (const table of [
      'user',
      'account',
      'global_role_assignments',
      'initial_admin_bootstrap',
    ]) {
      expect(
        await env.DB.prepare(`SELECT count(*) AS total FROM "${table}"`).first(
          'total',
        ),
      ).toBe(1);
    }
  });

  it('does not promote existing accounts and rolls back the bootstrap marker', async () => {
    await seedUser('first');
    const headers = enableBootstrap();
    expect((await request('/api/bootstrap', details, headers)).status).toBe(
      409,
    );
    expect(
      await createDb(env.DB).select().from(globalRoleAssignments),
    ).toHaveLength(0);
    expect(
      await env.DB.prepare('SELECT * FROM initial_admin_bootstrap').first(),
    ).toBeNull();
    expect(
      (
        await request(
          '/api/bootstrap',
          { ...details, email: 'new@example.invalid' },
          headers,
        )
      ).status,
    ).toBe(201);
  });

  it('refuses bootstrap when a historical administrator assignment exists', async () => {
    await seedUser('old-admin', true);
    await createDb(env.DB)
      .update(globalRoleAssignments)
      .set({ revokedAt: new Date().toISOString() });
    expect(
      (await request('/api/bootstrap', details, enableBootstrap())).status,
    ).toBe(409);
    expect(await createDb(env.DB).select().from(user)).toHaveLength(1);
  });

  it('rolls back the account, credentials and marker if the role write fails', async () => {
    const headers = enableBootstrap();
    await env.DB.prepare(
      `CREATE TRIGGER fail_initial_role BEFORE INSERT ON global_role_assignments BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
    ).run();
    try {
      expect((await request('/api/bootstrap', details, headers)).status).toBe(
        500,
      );
      for (const table of [
        'user',
        'account',
        'global_role_assignments',
        'initial_admin_bootstrap',
      ]) {
        expect(
          await env.DB.prepare(
            `SELECT count(*) AS total FROM "${table}"`,
          ).first('total'),
        ).toBe(0);
      }
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_initial_role').run();
    }
    expect((await request('/api/bootstrap', details, headers)).status).toBe(
      201,
    );
  });
});
afterAll(async () => {
  await mf?.dispose();
});

describe('authentication and live club permissions on D1', () => {
  it('requires actual authenticator verification and consumes recovery codes once', async () => {
    await seedUser('admin', true);
    await login('admin');
    const wrongPassword = await request('/api/auth/two-factor/enable', {
      password: 'incorrect-password',
    });
    expect(wrongPassword.ok).toBe(false);
    expect(await createDb(env.DB).select().from(twoFactor)).toHaveLength(0);
    const enabled = await request('/api/auth/two-factor/enable', {
      password,
      method: 'totp',
    });
    expect(enabled.status).toBe(200);
    const { totpURI, backupCodes } = (await enabled.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    expect(backupCodes).toHaveLength(10);
    // A partial multi-step library update must never grant administrative access.
    await createDb(env.DB).update(user).set({ twoFactorEnabled: true });
    expect(await (await request('/api/me')).json()).toMatchObject({
      mfaRequired: true,
    });
    expect((await request('/api/clubs/any')).status).toBe(403);
    await createDb(env.DB).update(user).set({ twoFactorEnabled: false });
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    expect(verified.status).toBe(200);
    saveCookies(verified);
    expect(await (await request('/api/me')).json()).toMatchObject({
      mfaRequired: false,
    });
    await request('/api/auth/sign-out', {});
    await login('admin');
    const recovered = await request('/api/auth/two-factor/verify-backup-code', {
      code: backupCodes[0],
    });
    expect(recovered.status).toBe(200);
    saveCookies(recovered);
    expect((await request('/api/me')).status).toBe(200);
    await request('/api/auth/sign-out', {});
    await login('admin');
    expect(
      (
        await request('/api/auth/two-factor/verify-backup-code', {
          code: backupCodes[0],
        })
      ).ok,
    ).toBe(false);
    expect((await request('/api/me')).status).toBe(401);
  });
  it('rejects weak secrets and insecure nonlocal origins', () => {
    expect(() => createAuth({ ...env, AUTH_SECRET: 'short' })).toThrow();
    expect(() =>
      createAuth({ ...env, AUTH_BASE_URL: 'http://example.invalid' }),
    ).toThrow();
  });

  it('enforces membership uniqueness and rolls back a failing D1 batch', async () => {
    await seedUser('delegate');
    const db = createDb(env.DB);
    await db.insert(clubs).values({
      id: 'a',
      name: 'Club A',
      slug: 'a',
      createdAt: new Date().toISOString(),
    });
    await db.insert(clubMemberships).values({
      id: 'first',
      userId: 'delegate',
      clubId: 'a',
      createdAt: new Date().toISOString(),
    });
    await expect(
      db.insert(clubMemberships).values({
        id: 'duplicate',
        userId: 'delegate',
        clubId: 'a',
        createdAt: new Date().toISOString(),
      }),
    ).rejects.toThrow();
    await expect(
      env.DB.batch([
        env.DB.prepare(
          "INSERT INTO clubs (id, name, slug, created_at) VALUES ('b', 'Club B', 'b', '2026-01-01')",
        ),
        env.DB.prepare(
          "INSERT INTO clubs (id, name, slug, created_at) VALUES ('a', 'Duplicate', 'a', '2026-01-01')",
        ),
      ]),
    ).rejects.toThrow();
    expect(await db.select().from(clubs).where(eq(clubs.id, 'b'))).toHaveLength(
      0,
    );
  });
  it('fails closed without secrets and rejects unauthenticated reads', async () => {
    expect((await app.request('/api/me', {}, { DB: env.DB })).status).toBe(503);
    expect((await request('/api/me')).status).toBe(401);
    expect((await request('/api/clubs/other')).status).toBe(401);
    cookie = 'better-auth.session_token=forged';
    expect((await request('/api/me')).status).toBe(401);
  });

  it('disables public signup and rejects untrusted origins', async () => {
    const response = await request('/api/auth/sign-up/email', {
      name: 'Fixture',
      email: 'fixture@example.invalid',
      password,
    });
    expect(response.status).toBe(400);
    expect(await createDb(env.DB).select().from(user)).toHaveLength(0);
    const crossSite = await request(
      '/api/auth/sign-in/email',
      { email: 'fixture@example.invalid', password },
      { origin: 'https://untrusted.invalid' },
    );
    expect(crossSite.status).toBe(403);
  });

  it('allows multiple memberships, hides other clubs and observes revocation in the same session', async () => {
    await seedUser('delegate');
    const db = createDb(env.DB);
    for (const id of ['a', 'b', 'c'])
      await db.insert(clubs).values({
        id,
        name: `Club ${id}`,
        slug: id,
        createdAt: new Date().toISOString(),
      });
    for (const clubId of ['a', 'b'])
      await db.insert(clubMemberships).values({
        id: clubId,
        userId: 'delegate',
        clubId,
        createdAt: new Date().toISOString(),
      });
    const signedIn = await login('delegate');
    expect(signedIn.headers.get('set-cookie')).toContain('HttpOnly');
    expect(signedIn.headers.get('set-cookie')).toContain('SameSite=Lax');
    const me = await request('/api/me');
    expect(await me.json()).toMatchObject({
      roles: [],
      clubs: [{ id: 'a' }, { id: 'b' }],
    });
    expect((await request('/api/clubs/a')).status).toBe(200);
    expect((await request('/api/clubs/b')).status).toBe(200);
    expect((await request('/api/clubs/c')).status).toBe(404);
    await db
      .update(clubMemberships)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(clubMemberships.id, 'a'));
    expect((await request('/api/clubs/a')).status).toBe(404);
    expect((await request('/api/clubs/b')).status).toBe(200);
    await db.update(clubs).set({ status: 'INACTIVE' }).where(eq(clubs.id, 'b'));
    expect((await request('/api/clubs/b')).status).toBe(404);
  });

  it('invalidates access on logout, expiry and suspension', async () => {
    await seedUser('delegate');
    await login('delegate');
    const oldCookie = cookie;
    expect((await request('/api/auth/sign-out', {})).status).toBe(200);
    cookie = oldCookie;
    expect((await request('/api/me')).status).toBe(401);
    await login('delegate');
    await createDb(env.DB)
      .update(session)
      .set({ expiresAt: new Date(0) });
    expect((await request('/api/me')).status).toBe(401);
    await login('delegate');
    await createDb(env.DB).update(user).set({ status: 'SUSPENDED' });
    expect((await request('/api/me')).status).toBe(401);
    cookie = '';
    const denied = await request('/api/auth/sign-in/email', {
      email: 'delegate@example.invalid',
      password,
    });
    expect(denied.ok).toBe(false);
  });

  it('requires verified MFA for each admin and rechecks revoked global roles', async () => {
    const db = createDb(env.DB);
    await db.insert(clubs).values({
      id: 'a',
      name: 'Club A',
      slug: 'a',
      createdAt: new Date().toISOString(),
    });
    for (const id of ['admin-one', 'admin-two']) {
      ipCounter++;
      await seedUser(id, true);
      await login(id);
      const preMfaCookie = cookie;
      expect(await (await request('/api/me')).json()).toMatchObject({
        mfaRequired: true,
      });
      expect((await request('/api/clubs/a')).status).toBe(403);
      const enabled = await request('/api/auth/two-factor/enable', {
        password,
      });
      expect(enabled.status, await enabled.clone().text()).toBe(200);
      const { totpURI } = (await enabled.json()) as { totpURI: string };
      saveCookies(enabled);
      const verified = await request('/api/auth/two-factor/verify-totp', {
        code: totp(totpURI),
      });
      expect(verified.status, await verified.clone().text()).toBe(200);
      saveCookies(verified);
      expect((await request('/api/clubs/a')).status).toBe(200);
      const verifiedCookie = cookie;
      cookie = preMfaCookie;
      expect((await request('/api/me')).status).toBe(401);
      cookie = verifiedCookie;
      await db
        .update(globalRoleAssignments)
        .set({ revokedAt: new Date().toISOString() })
        .where(eq(globalRoleAssignments.userId, id));
      expect((await request('/api/clubs/a')).status).toBe(404);
      const challenge = await login(id);
      expect(await challenge.json()).toMatchObject({ twoFactorRedirect: true });
      expect((await request('/api/me')).status).toBe(401);
    }
  });

  it('persists rate limits across fresh auth instances', async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const auth = createAuth(env);
      const response = await auth.handler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin,
            'cf-connecting-ip': '192.0.2.200',
          },
          body: JSON.stringify({ email: 'absent@example.invalid', password }),
        }),
      );
      if (attempt === 5) expect(response.status).toBe(429);
    }
  });
});
