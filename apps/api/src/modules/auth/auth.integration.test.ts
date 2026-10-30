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
  clubOfficials,
  players,
  clubPlayers,
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
  method?: string,
) {
  return app.request(
    `${origin}${path}`,
    {
      method: method ?? (body ? 'POST' : 'GET'),
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
      d1Databases: ['DB', 'MIGRATION_DB'],
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
    'change_approvals',
    'change_requests',
    'club_players',
    'players',
    'club_officials',
    'audit_logs',
    'admin_invitations',
    'representative_invitations',
    'recovery_links',
    'initial_admin_bootstrap',
    'club_president_authorities',
    'club_memberships',
    'global_role_assignments',
    'seasons',
    'clubs',
    'user',
    'rateLimit',
    'verification',
  ]) {
    await env.DB.prepare(`DELETE FROM "${table}"`).run();
  }
});

describe('club structure and representative terminology', () => {
  it('migrates existing delegate memberships without losing identity or revocation history', async () => {
    const database = await mf.getD1Database('MIGRATION_DB');
    const migrationDirectory = new URL('../../../migrations/', import.meta.url);
    const migrationFiles = (await readdir(migrationDirectory))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    const applyMigration = async (file: string) => {
      const contents = await readFile(
        new URL(file, migrationDirectory),
        'utf8',
      );
      await database.batch(
        contents
          .split('--> statement-breakpoint')
          .filter((part) => part.trim())
          .map((part) => database.prepare(part)),
      );
    };
    for (const file of migrationFiles.filter((file) => file < '0004'))
      await applyMigration(file);
    await database.batch([
      database.prepare(
        `INSERT INTO "user" (id, name, email) VALUES ('legacy-user', 'Migration fixture', 'migration@example.invalid')`,
      ),
      database.prepare(
        `INSERT INTO clubs (id, name, slug, created_at) VALUES ('legacy-club', 'Migration club', 'migration-club', '2026-01-01')`,
      ),
      database.prepare(
        `INSERT INTO club_memberships (id, user_id, club_id, role, created_at, revoked_at) VALUES ('active-link', 'legacy-user', 'legacy-club', 'CLUB_DELEGATE', '2026-01-01', NULL), ('old-link', 'legacy-user', 'legacy-club', 'CLUB_DELEGATE', '2025-01-01', '2025-12-01')`,
      ),
    ]);
    for (const file of migrationFiles.filter((file) => file >= '0004'))
      await applyMigration(file);
    const rows = await database
      .prepare('SELECT * FROM club_memberships ORDER BY id')
      .all();
    expect(rows.results).toEqual([
      {
        id: 'active-link',
        user_id: 'legacy-user',
        club_id: 'legacy-club',
        role: 'CLUB_REPRESENTATIVE',
        created_at: '2026-01-01',
        revoked_at: null,
      },
      {
        id: 'old-link',
        user_id: 'legacy-user',
        club_id: 'legacy-club',
        role: 'CLUB_REPRESENTATIVE',
        created_at: '2025-01-01',
        revoked_at: '2025-12-01',
      },
    ]);
    await expect(
      database
        .prepare(
          `INSERT INTO club_memberships (id, user_id, club_id, role, created_at) VALUES ('invalid-role', 'legacy-user', 'legacy-club', 'CLUB_DELEGATE', '2026-01-01')`,
        )
        .run(),
    ).rejects.toThrow();
  });

  it('returns president, representatives, technical directors and players only for authorized clubs', async () => {
    const db = createDb(env.DB);
    const createdAt = new Date().toISOString();
    for (const id of ['representative-one', 'representative-two', 'suspended'])
      await seedUser(id);
    await db
      .update(user)
      .set({ status: 'SUSPENDED' })
      .where(eq(user.id, 'suspended'));
    for (const id of ['a', 'b'])
      await db
        .insert(clubs)
        .values({ id, name: `Club ${id}`, slug: `club-${id}`, createdAt });
    for (const userId of [
      'representative-one',
      'representative-two',
      'suspended',
    ])
      await db
        .insert(clubMemberships)
        .values({ id: userId, userId, clubId: 'a', createdAt });
    await db.insert(clubOfficials).values([
      {
        id: 'president-a',
        clubId: 'a',
        name: 'Presidente A',
        position: 'PRESIDENT',
        createdAt,
      },
      {
        id: 'old-president',
        clubId: 'a',
        name: 'Anterior presidente',
        position: 'PRESIDENT',
        createdAt,
        endedAt: createdAt,
      },
      {
        id: 'coach-one',
        clubId: 'a',
        name: 'DT Uno',
        position: 'TECHNICAL_DIRECTOR',
        createdAt,
      },
      {
        id: 'coach-two',
        clubId: 'a',
        name: 'DT Dos',
        position: 'TECHNICAL_DIRECTOR',
        createdAt,
      },
      {
        id: 'president-b',
        clubId: 'b',
        name: 'Presidente B',
        position: 'PRESIDENT',
        createdAt,
      },
    ]);
    await db.insert(players).values([
      { id: 'player-a', firstName: 'Jugador', lastName: 'A', createdAt },
      { id: 'player-b', firstName: 'Jugador', lastName: 'B', createdAt },
    ]);
    await db.insert(clubPlayers).values([
      { id: 'player-link-a', clubId: 'a', playerId: 'player-a', createdAt },
      { id: 'player-link-b', clubId: 'b', playerId: 'player-b', createdAt },
      {
        id: 'old-player-link',
        clubId: 'a',
        playerId: 'player-b',
        createdAt,
        endedAt: createdAt,
      },
    ]);
    await login('representative-one');
    const response = await request('/api/clubs/a');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      president: { id: 'president-a', name: 'Presidente A' },
      representatives: [
        { id: 'representative-one' },
        { id: 'representative-two' },
      ],
      technicalDirectors: [{ id: 'coach-two' }, { id: 'coach-one' }],
      players: [{ id: 'player-a', name: 'Jugador A' }],
    });
    expect((await request('/api/clubs/b')).status).toBe(404);
    await db
      .update(clubMemberships)
      .set({ revokedAt: createdAt })
      .where(eq(clubMemberships.id, 'representative-two'));
    expect(await (await request('/api/clubs/a')).json()).toMatchObject({
      representatives: [{ id: 'representative-one' }],
    });
    await db
      .update(clubMemberships)
      .set({ revokedAt: createdAt })
      .where(eq(clubMemberships.id, 'representative-one'));
    expect((await request('/api/clubs/a')).status).toBe(404);
  });

  it('permits one current president, multiple directors and historical player links', async () => {
    const db = createDb(env.DB);
    const createdAt = new Date().toISOString();
    await db
      .insert(clubs)
      .values({ id: 'a', name: 'Club A', slug: 'club-a', createdAt });
    await db.insert(clubOfficials).values({
      id: 'first',
      clubId: 'a',
      name: 'Presidente',
      position: 'PRESIDENT',
      createdAt,
    });
    await expect(
      db.insert(clubOfficials).values({
        id: 'second',
        clubId: 'a',
        name: 'Otro',
        position: 'PRESIDENT',
        createdAt,
      }),
    ).rejects.toThrow();
    await db
      .update(clubOfficials)
      .set({ endedAt: createdAt })
      .where(eq(clubOfficials.id, 'first'));
    await db.insert(clubOfficials).values({
      id: 'second',
      clubId: 'a',
      name: 'Otro',
      position: 'PRESIDENT',
      createdAt,
    });
    await db.insert(players).values({
      id: 'player',
      firstName: 'Jugador',
      lastName: 'Prueba',
      createdAt,
    });
    await db
      .insert(clubPlayers)
      .values({ id: 'link', clubId: 'a', playerId: 'player', createdAt });
    await expect(
      db.insert(clubPlayers).values({
        id: 'duplicate',
        clubId: 'a',
        playerId: 'player',
        createdAt,
      }),
    ).rejects.toThrow();
    await db
      .update(clubPlayers)
      .set({ endedAt: createdAt })
      .where(eq(clubPlayers.id, 'link'));
    await db
      .insert(clubPlayers)
      .values({ id: 'next-link', clubId: 'a', playerId: 'player', createdAt });
    expect(await db.select().from(players)).toHaveLength(1);
  });
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

describe('second administrator invitations', () => {
  async function owner() {
    await seedUser('owner', true);
    await env.DB.prepare(
      'INSERT INTO initial_admin_bootstrap (id,user_id,created_at) VALUES (1,?,?)',
    )
      .bind('owner', new Date().toISOString())
      .run();
    await login('owner');
    const enabled = await request('/api/auth/two-factor/enable', { password });
    expect(enabled.status).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    expect(verified.status).toBe(200);
    saveCookies(verified);
    return cookie;
  }
  const recipient = {
    name: 'Segundo administrador',
    email: 'second@example.invalid',
    password,
  };
  async function invite() {
    const response = await request('/api/admin-invitations', {
      email: recipient.email,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    return (await response.json()) as { token: string; expiresAt: string };
  }
  it('restricts issuance to the original active MFA administrator', async () => {
    expect(
      (await request('/api/admin-invitations', { email: recipient.email }))
        .status,
    ).toBe(401);
    await seedUser('owner', true);
    await env.DB.prepare(
      'INSERT INTO initial_admin_bootstrap (id,user_id,created_at) VALUES (1,?,?)',
    )
      .bind('owner', new Date().toISOString())
      .run();
    await login('owner');
    expect(
      (await request('/api/admin-invitations', { email: recipient.email }))
        .status,
    ).toBe(403);
    await seedUser('ordinary-admin', true);
    await login('ordinary-admin');
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    saveCookies(verified);
    expect(
      (await request('/api/admin-invitations', { email: recipient.email }))
        .status,
    ).toBe(403);
    expect(
      await env.DB.prepare(
        'SELECT count(*) AS total FROM admin_invitations',
      ).first('total'),
    ).toBe(0);
  }, 30000);

  it('creates a single-use invitation with a hashed token and requires MFA for the second admin', async () => {
    const ownerCookie = await owner();
    const ownerMe = await (await request('/api/me')).json();
    expect(ownerMe).toMatchObject({ canManageAdmins: true });
    const { token } = await invite();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const stored = await env.DB.prepare(
      'SELECT token_hash FROM admin_invitations',
    ).first<string>('token_hash');
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toBe(token);
    cookie = '';
    expect(
      (
        await request(
          '/api/admin-invitations/accept',
          { ...recipient, token },
          { origin: 'https://untrusted.invalid' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/admin-invitations/accept', {
          ...recipient,
          email: 'wrong@example.invalid',
          token,
        })
      ).status,
    ).toBe(400);
    const response = await request('/api/admin-invitations/accept', {
      ...recipient,
      token,
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(
      (await request('/api/admin-invitations/accept', { ...recipient, token }))
        .status,
    ).toBe(400);
    const audits = await env.DB.prepare(
      "SELECT action,metadata_json FROM audit_logs WHERE action IN ('ADMIN_INVITED','ADMIN_GRANTED') ORDER BY action",
    ).all<{ action: string; metadata_json: string }>();
    expect(audits.results.map((entry) => entry.action).sort()).toEqual([
      'ADMIN_GRANTED',
      'ADMIN_INVITED',
    ]);
    expect(JSON.stringify(audits.results)).not.toContain(token);
    expect(JSON.stringify(audits.results)).not.toContain(recipient.email);
    await login('second');
    expect(await (await request('/api/me')).json()).toMatchObject({
      mfaRequired: true,
      canManageAdmins: false,
    });
    expect((await request('/api/clubs')).status).toBe(403);
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    expect(verified.status).toBe(200);
    saveCookies(verified);
    expect((await request('/api/clubs')).status).toBe(200);
    expect(
      (
        await request('/api/admin-invitations', {
          email: 'third@example.invalid',
        })
      ).status,
    ).toBe(403);
    cookie = ownerCookie;
    expect((await request('/api/clubs')).status).toBe(200);
  }, 30000);

  it('prevents expired, revoked and duplicate-account invitations without partial writes', async () => {
    const ownerCookie = await owner();
    const expired = await invite();
    await env.DB.prepare(
      "UPDATE admin_invitations SET expires_at='2000-01-01T00:00:00.000Z'",
    ).run();
    cookie = '';
    expect(
      (
        await request('/api/admin-invitations/accept', {
          ...recipient,
          token: expired.token,
        })
      ).status,
    ).toBe(400);
    cookie = ownerCookie;
    const duplicate = await invite();
    await seedUser('second');
    cookie = '';
    expect(
      (
        await request('/api/admin-invitations/accept', {
          ...recipient,
          token: duplicate.token,
        })
      ).status,
    ).toBe(400);
    expect(
      await env.DB.prepare(
        'SELECT accepted_at FROM admin_invitations WHERE token_hash=?',
      )
        .bind(
          Array.from(
            new Uint8Array(
              await crypto.subtle.digest(
                'SHA-256',
                new TextEncoder().encode(duplicate.token),
              ),
            ),
            (b) => b.toString(16).padStart(2, '0'),
          ).join(''),
        )
        .first('accepted_at'),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM global_role_assignments WHERE user_id='second'",
      ).first('n'),
    ).toBe(0);
    cookie = ownerCookie;
    const revoked = await request('/api/admin-invitations', {
      email: 'revoked@example.invalid',
    });
    const revokedToken = ((await revoked.json()) as { token: string }).token;
    cookie = '';
    await createDb(env.DB)
      .update(globalRoleAssignments)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(globalRoleAssignments.userId, 'owner'));
    expect(
      (
        await request('/api/admin-invitations/accept', {
          ...recipient,
          email: 'revoked@example.invalid',
          token: revokedToken,
        })
      ).status,
    ).toBe(400);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM "user" WHERE email=?')
        .bind('revoked@example.invalid')
        .first('n'),
    ).toBe(0);
  }, 30000);

  it('recovers a representative account via a one-use link and invalidates previous sessions', async () => {
    const ownerCookie = await owner();
    await seedUser('representative');
    await login('representative');
    const previousSession = cookie;
    expect((await request('/api/me')).status).toBe(200);
    expect(
      (await request('/api/recovery-links', { userId: 'owner' })).status,
    ).toBe(403);
    cookie = ownerCookie;
    const response = await request('/api/recovery-links', {
      userId: 'representative',
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const { token } = (await response.json()) as { token: string };
    expect(
      await env.DB.prepare('SELECT token_hash FROM recovery_links').first(
        'token_hash',
      ),
    ).not.toBe(token);
    const newPassword = randomBytes(24).toString('hex');
    cookie = '';
    expect(
      (
        await request(
          '/api/recovery-links/accept',
          { token, password: newPassword },
          { origin: 'https://bad.invalid' },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request('/api/recovery-links/accept', {
          token,
          password: newPassword,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await request('/api/recovery-links/accept', {
          token,
          password: newPassword,
        })
      ).status,
    ).toBe(400);
    cookie = previousSession;
    expect((await request('/api/me')).status).toBe(401);
    cookie = '';
    expect(
      (
        await request('/api/auth/sign-in/email', {
          email: 'representative@example.invalid',
          password,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          '/api/auth/sign-in/email',
          {
            email: 'representative@example.invalid',
            password: newPassword,
          },
          { 'cf-connecting-ip': '192.0.2.249' },
        )
      ).status,
    ).toBe(200);
    const audit = await env.DB.prepare(
      "SELECT metadata_json FROM audit_logs WHERE action='PASSWORD_RECOVERED'",
    ).first<string>('metadata_json');
    expect(audit).toBeTruthy();
    expect(audit).not.toContain(token);
    expect(audit).not.toContain(newPassword);
  }, 30000);

  it('allows only the initial administrator to revoke other administrators without revoking the owner', async () => {
    const ownerCookie = await owner();
    await seedUser('other-admin', true);
    await login('other-admin');
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    saveCookies(verified);
    const otherCookie = cookie;
    expect((await request('/api/administrators')).status).toBe(403);
    expect(
      (await request('/api/administrators/owner', undefined, {}, 'DELETE'))
        .status,
    ).toBe(403);
    cookie = ownerCookie;
    expect(
      (await request('/api/administrators/owner', undefined, {}, 'DELETE'))
        .status,
    ).toBe(403);
    expect(
      (
        await request(
          '/api/administrators/other-admin',
          undefined,
          { origin: 'https://bad.invalid' },
          'DELETE',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          '/api/administrators/other-admin',
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          '/api/administrators/other-admin',
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(404);
    cookie = otherCookie;
    expect((await request('/api/administrators')).status).toBe(403);
    expect(await (await request('/api/me')).json()).toMatchObject({
      roles: [],
    });
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM audit_logs WHERE action='ADMIN_REVOKED'",
      ).first('n'),
    ).toBe(1);
  }, 30000);

  it('permits one concurrent acceptance and rolls back on an audit failure', async () => {
    const ownerCookie = await owner();
    const first = await invite();
    cookie = '';
    const [a, b] = await Promise.all([
      request('/api/admin-invitations/accept', {
        ...recipient,
        token: first.token,
      }),
      request('/api/admin-invitations/accept', {
        ...recipient,
        token: first.token,
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 400].sort());
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM "user" WHERE email=?')
        .bind(recipient.email)
        .first('n'),
    ).toBe(1);
    cookie = ownerCookie;
    const next = await request('/api/admin-invitations', {
      email: 'rollback@example.invalid',
    });
    const token = ((await next.json()) as { token: string }).token;
    await env.DB.prepare(
      "CREATE TRIGGER fail_admin_grant BEFORE INSERT ON audit_logs WHEN NEW.action='ADMIN_GRANTED' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END",
    ).run();
    try {
      cookie = '';
      expect(
        (
          await request('/api/admin-invitations/accept', {
            ...recipient,
            email: 'rollback@example.invalid',
            token,
          })
        ).status,
      ).toBe(400);
      expect(
        await env.DB.prepare('SELECT count(*) AS n FROM "user" WHERE email=?')
          .bind('rollback@example.invalid')
          .first('n'),
      ).toBe(0);
      const row = await env.DB.prepare(
        'SELECT accepted_at FROM admin_invitations WHERE email=?',
      )
        .bind('rollback@example.invalid')
        .first();
      expect(row).toMatchObject({ accepted_at: null });
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_admin_grant').run();
    }
    expect(
      (
        await request('/api/admin-invitations/accept', {
          ...recipient,
          email: 'rollback@example.invalid',
          token,
        })
      ).status,
    ).toBe(201);
  }, 30000);
});

describe('club management and atomic audit', () => {
  async function administrator() {
    await seedUser('club-admin', true);
    await login('club-admin');
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    expect(verified.status).toBe(200);
    saveCookies(verified);
  }
  async function secondAdministrator() {
    await seedUser('second-admin', true);
    await login('second-admin');
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    expect(verified.status).toBe(200);
    saveCookies(verified);
    return cookie;
  }
  const details = {
    name: 'Estrella del Sur',
    shortName: 'Estrella',
    slug: 'estrella-sur',
  };
  async function createClub() {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await createDb(env.DB)
      .insert(clubs)
      .values({ id, ...details, createdAt: now });
    await env.DB.prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json) VALUES (?, 'club-admin', 'CLUB_CREATED', 'CLUB', ?, ?, '{}')",
    )
      .bind(crypto.randomUUID(), id, now)
      .run();
    return { id, version: 1 };
  }
  it('lets an invited president use an existing account and membership atomically', async () => {
    await administrator();
    const adminCookie = cookie;
    const club = await createClub();
    await seedUser('existing-president');
    await createDb(env.DB).insert(clubMemberships).values({
      id: 'existing-member',
      userId: 'existing-president',
      clubId: club.id,
      createdAt: new Date().toISOString(),
    });
    const invite = await request('/api/representative-invitations', {
      clubId: club.id,
      email: 'existing-president@example.invalid',
      kind: 'PRESIDENT',
    });
    expect(invite.status).toBe(201);
    const token = ((await invite.json()) as { token: string }).token;
    await login('existing-president');
    const presidentCookie = cookie;
    await env.DB.prepare(
      "CREATE TRIGGER fail_president_invite BEFORE INSERT ON audit_logs WHEN NEW.action='PRESIDENT_INVITATION_ACCEPTED' BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    ).run();
    try {
      expect(
        (
          await request('/api/representative-invitations/accept-existing', {
            token,
          })
        ).status,
      ).toBe(400);
      expect(
        await env.DB.prepare(
          'SELECT count(*) FROM club_president_authorities',
        ).first('count(*)'),
      ).toBe(0);
      expect(
        await env.DB.prepare('SELECT count(*) FROM club_officials').first(
          'count(*)',
        ),
      ).toBe(0);
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_president_invite').run();
    }
    const concurrent = await Promise.all([
      request('/api/representative-invitations/accept-existing', { token }),
      request('/api/representative-invitations/accept-existing', { token }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);
    expect(
      await concurrent.find((response) => response.status === 201)!.json(),
    ).toMatchObject({ kind: 'PRESIDENT', requested: false });
    expect(
      await env.DB.prepare(
        'SELECT count(*) FROM club_memberships WHERE user_id=? AND club_id=? AND revoked_at IS NULL',
      )
        .bind('existing-president', club.id)
        .first('count(*)'),
    ).toBe(1);
    expect(
      await env.DB.prepare(
        'SELECT membership_id FROM club_president_authorities WHERE user_id=?',
      )
        .bind('existing-president')
        .first('membership_id'),
    ).toBe('existing-member');
    expect(
      await env.DB.prepare('SELECT count(*) FROM change_requests').first(
        'count(*)',
      ),
    ).toBe(0);
    expect(await (await request('/api/me')).json()).toMatchObject({
      presidentClubIds: [club.id],
    });
    expect(
      (
        await request('/api/representative-invitations', {
          clubId: club.id,
          email: 'invitee@example.invalid',
        })
      ).status,
    ).toBe(201);
    expect(
      await env.DB.prepare(
        "SELECT count(*) FROM audit_logs WHERE action='PRESIDENT_INVITATION_ACCEPTED'",
      ).first('count(*)'),
    ).toBe(1);
    cookie = adminCookie;
    expect(
      (
        await request(
          `/api/clubs/${club.id}/representatives/existing-member`,
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(200);
    cookie = presidentCookie;
    expect((await request(`/api/clubs/${club.id}`)).status).toBe(404);
  }, 30000);
  it('lets an existing representative accept a second club invitation with two approvals and no duplicate identity', async () => {
    await administrator();
    const firstAdmin = cookie;
    const secondAdmin = await secondAdministrator();
    cookie = firstAdmin;
    const clubB = await createClub();
    const now = new Date().toISOString();
    const db = createDb(env.DB);
    await db.insert(clubs).values([
      { id: 'club-a', name: 'Club A', slug: 'club-a', createdAt: now },
      { id: 'club-c', name: 'Club C', slug: 'club-c', createdAt: now },
    ]);
    await seedUser('existing-rep');
    await seedUser('president-b');
    await seedUser('wrong-user');
    await env.DB.prepare('UPDATE "user" SET "emailVerified"=0 WHERE id=?')
      .bind('existing-rep')
      .run();
    await db.insert(clubMemberships).values([
      { id: 'rep-a', userId: 'existing-rep', clubId: 'club-a', createdAt: now },
      {
        id: 'president-b-membership',
        userId: 'president-b',
        clubId: clubB.id,
        createdAt: now,
      },
    ]);
    await env.DB.prepare(
      'INSERT INTO club_president_authorities (id,membership_id,club_id,user_id,created_at) VALUES (?,?,?,?,?)',
    )
      .bind(
        'president-b-authority',
        'president-b-membership',
        clubB.id,
        'president-b',
        now,
      )
      .run();
    ipCounter++;
    await login('president-b');
    const invitation = await request('/api/representative-invitations', {
      clubId: clubB.id,
      email: 'existing-rep@example.invalid',
    });
    expect(invitation.status).toBe(201);
    const token = ((await invitation.json()) as { token: string }).token;
    ipCounter++;
    await login('wrong-user');
    expect(
      (
        await request('/api/representative-invitations/accept-existing', {
          token,
        })
      ).status,
    ).toBe(400);
    ipCounter++;
    await login('existing-rep');
    const repCookie = cookie;
    expect(
      (
        await request(
          '/api/representative-invitations/accept-existing',
          { token },
          { origin: 'https://wrong.invalid' },
        )
      ).status,
    ).toBe(403);
    await env.DB.prepare(
      "CREATE TRIGGER fail_existing_invite_audit BEFORE INSERT ON audit_logs WHEN NEW.action='REPRESENTATIVE_INVITATION_ACCEPTED' BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    ).run();
    try {
      expect(
        (
          await request('/api/representative-invitations/accept-existing', {
            token,
          })
        ).status,
      ).toBe(400);
      expect(
        await env.DB.prepare(
          'SELECT accepted_at FROM representative_invitations WHERE email=?',
        )
          .bind('existing-rep@example.invalid')
          .first('accepted_at'),
      ).toBeNull();
      expect(
        await env.DB.prepare('SELECT count(*) FROM change_requests').first(
          'count(*)',
        ),
      ).toBe(0);
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_existing_invite_audit').run();
    }
    const accepted = await Promise.all([
      request('/api/representative-invitations/accept-existing', { token }),
      request('/api/representative-invitations/accept-existing', { token }),
    ]);
    expect(accepted.map((response) => response.status).sort()).toEqual([
      201, 400,
    ]);
    expect(
      await env.DB.prepare('SELECT count(*) FROM change_requests').first(
        'count(*)',
      ),
    ).toBe(1);
    expect(
      await env.DB.prepare('SELECT count(*) FROM "user" WHERE email=?')
        .bind('existing-rep@example.invalid')
        .first('count(*)'),
    ).toBe(1);
    expect((await request('/api/clubs/club-a')).status).toBe(200);
    expect((await request(`/api/clubs/${clubB.id}`)).status).toBe(404);
    expect((await request('/api/clubs/club-c')).status).toBe(404);
    const id = await env.DB.prepare(
      "SELECT id FROM change_requests WHERE kind='REPRESENTATIVE'",
    ).first<string>('id');
    cookie = firstAdmin;
    expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(200);
    cookie = repCookie;
    expect((await request(`/api/clubs/${clubB.id}`)).status).toBe(404);
    cookie = secondAdmin;
    expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(200);
    cookie = repCookie;
    expect((await request(`/api/clubs/${clubB.id}`)).status).toBe(200);
    expect((await request('/api/clubs/club-c')).status).toBe(404);
    const membership = await env.DB.prepare(
      'SELECT id FROM club_memberships WHERE user_id=? AND club_id=? AND revoked_at IS NULL',
    )
      .bind('existing-rep', clubB.id)
      .first<string>('id');
    cookie = firstAdmin;
    expect(
      (
        await request(
          `/api/clubs/${clubB.id}/representatives/${membership}`,
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(200);
    cookie = repCookie;
    expect((await request(`/api/clubs/${clubB.id}`)).status).toBe(404);
    expect((await request('/api/clubs/club-a')).status).toBe(200);
  }, 45000);
  it('replaces a president atomically, revokes only that club and invalidates outstanding invitations', async () => {
    await administrator();
    const firstCookie = cookie;
    const secondCookie = await secondAdministrator();
    cookie = firstCookie;
    const club = await createClub();
    const db = createDb(env.DB);
    await seedUser('old-president');
    const now = new Date().toISOString();
    await db.insert(clubs).values({
      id: 'other-club',
      name: 'Other',
      slug: 'other-club',
      createdAt: now,
    });
    await db.insert(clubMemberships).values([
      {
        id: 'president-membership',
        userId: 'old-president',
        clubId: club.id,
        createdAt: now,
      },
      {
        id: 'other-membership',
        userId: 'old-president',
        clubId: 'other-club',
        createdAt: now,
      },
    ]);
    await env.DB.prepare(
      'INSERT INTO club_president_authorities (id,membership_id,club_id,user_id,created_at) VALUES (?,?,?,?,?)',
    )
      .bind(
        'old-authority',
        'president-membership',
        club.id,
        'old-president',
        now,
      )
      .run();
    await env.DB.prepare(
      "INSERT INTO club_officials (id,club_id,name,position,created_at) VALUES (?,?,'Old President','PRESIDENT',?)",
    )
      .bind('old-official', club.id, now)
      .run();
    const issued = await request('/api/representative-invitations', {
      email: 'old-link@example.invalid',
      clubId: club.id,
      kind: 'PRESIDENT',
    });
    expect(issued.status).toBe(201);
    const token = ((await issued.json()) as { token: string }).token;
    const change = await request('/api/changes', {
      kind: 'PRESIDENT',
      clubId: club.id,
      name: 'New President',
    });
    const id = ((await change.json()) as { id: string }).id;
    expect(change.status).toBe(201);
    expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(200);
    expect(
      await env.DB.prepare('SELECT revoked_at FROM club_memberships WHERE id=?')
        .bind('president-membership')
        .first('revoked_at'),
    ).toBeNull();
    cookie = secondCookie;
    await env.DB.prepare(
      "CREATE TRIGGER fail_president_revoke BEFORE INSERT ON audit_logs WHEN NEW.action='MEMBERSHIP_REVOKED' BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    ).run();
    try {
      expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(
        409,
      );
      expect(
        await env.DB.prepare(
          'SELECT revoked_at FROM club_president_authorities WHERE id=?',
        )
          .bind('old-authority')
          .first('revoked_at'),
      ).toBeNull();
      expect(
        await env.DB.prepare('SELECT ended_at FROM club_officials WHERE id=?')
          .bind('old-official')
          .first('ended_at'),
      ).toBeNull();
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_president_revoke').run();
    }
    expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(200);
    expect(
      await env.DB.prepare('SELECT revoked_at FROM club_memberships WHERE id=?')
        .bind('president-membership')
        .first('revoked_at'),
    ).toBeTruthy();
    expect(
      await env.DB.prepare('SELECT revoked_at FROM club_memberships WHERE id=?')
        .bind('other-membership')
        .first('revoked_at'),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT count(*) FROM audit_logs WHERE action='MEMBERSHIP_REVOKED' AND resource_id=?",
      )
        .bind(club.id)
        .first('count(*)'),
    ).toBe(1);
    expect(await (await request(`/api/clubs/${club.id}`)).json()).toMatchObject(
      { president: { name: 'New President' } },
    );
    cookie = '';
    expect(
      (
        await request('/api/representative-invitations/accept', {
          token,
          name: 'Old invitation',
          email: 'old-link@example.invalid',
          password,
        })
      ).status,
    ).toBe(400);
    await login('old-president');
    expect((await request(`/api/clubs/${club.id}`)).status).toBe(404);
    expect((await request('/api/clubs/other-club')).status).toBe(200);
    expect(
      (
        await request('/api/representative-invitations', {
          clubId: club.id,
          email: 'blocked@example.invalid',
        })
      ).status,
    ).toBe(404);
    cookie = firstCookie;
    const newInvite = await request('/api/representative-invitations', {
      clubId: club.id,
      email: 'new-president@example.invalid',
      kind: 'PRESIDENT',
    });
    expect(newInvite.status).toBe(201);
    const newToken = ((await newInvite.json()) as { token: string }).token;
    cookie = '';
    expect(
      (
        await request(
          '/api/representative-invitations/accept',
          {
            token: newToken,
            name: 'New President',
            email: 'new-president@example.invalid',
            password,
          },
          { 'cf-connecting-ip': '192.0.2.245' },
        )
      ).status,
    ).toBe(201);
    expect(
      await env.DB.prepare(
        "SELECT count(*) FROM club_officials WHERE club_id=? AND position='PRESIDENT' AND ended_at IS NULL",
      )
        .bind(club.id)
        .first('count(*)'),
    ).toBe(1);
  }, 45000);

  it('rejects a president change if authority changed after the request', async () => {
    await administrator();
    const firstCookie = cookie;
    const secondCookie = await secondAdministrator();
    cookie = firstCookie;
    const club = await createClub();
    const change = await request('/api/changes', {
      kind: 'PRESIDENT',
      clubId: club.id,
      name: 'Requested President',
    });
    const id = ((await change.json()) as { id: string }).id;
    expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(200);
    await seedUser('new-president');
    const now = new Date().toISOString();
    await createDb(env.DB).insert(clubMemberships).values({
      id: 'new-member',
      userId: 'new-president',
      clubId: club.id,
      createdAt: now,
    });
    await env.DB.prepare(
      'INSERT INTO club_president_authorities (id,membership_id,club_id,user_id,created_at) VALUES (?,?,?,?,?)',
    )
      .bind('new-authority', 'new-member', club.id, 'new-president', now)
      .run();
    cookie = secondCookie;
    expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(409);
    expect(
      await env.DB.prepare(
        'SELECT revoked_at FROM club_president_authorities WHERE id=?',
      )
        .bind('new-authority')
        .first('revoked_at'),
    ).toBeNull();
    expect(
      await env.DB.prepare(
        'SELECT count(*) FROM change_approvals WHERE request_id=?',
      )
        .bind(id)
        .first('count(*)'),
    ).toBe(1);
  }, 30000);
  it('invites a representative without falsely verifying email and grants access only after two approvals', async () => {
    await administrator();
    const firstCookie = cookie;
    const club = await createClub();
    const presidentInvite = await request('/api/representative-invitations', {
      email: 'president@example.invalid',
      clubId: club.id,
      kind: 'PRESIDENT',
    });
    expect(presidentInvite.status).toBe(201);
    const presidentToken = ((await presidentInvite.json()) as { token: string })
      .token;
    cookie = '';
    expect(
      (
        await request('/api/representative-invitations/accept', {
          token: presidentToken,
          name: 'President',
          email: 'president@example.invalid',
          password,
        })
      ).status,
    ).toBe(201);
    const presidentLogin = await request(
      '/api/auth/sign-in/email',
      { email: 'president@example.invalid', password },
      { 'cf-connecting-ip': '192.0.2.248' },
    );
    expect(presidentLogin.status).toBe(200);
    saveCookies(presidentLogin);
    expect(await (await request('/api/me')).json()).toMatchObject({
      presidentClubIds: [club.id],
    });
    expect(await (await request(`/api/clubs/${club.id}`)).json()).toMatchObject(
      { president: { name: 'President' } },
    );
    const presidentCookie = cookie;
    expect(
      (
        await request('/api/representative-invitations', {
          email: 'other@example.invalid',
          clubId: 'other-club',
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await request('/api/representative-invitations', {
          email: 'other@example.invalid',
          clubId: club.id,
          kind: 'PRESIDENT',
        })
      ).status,
    ).toBe(403);
    const issued = await request('/api/representative-invitations', {
      email: 'new-rep@example.invalid',
      clubId: club.id,
    });
    expect(issued.status).toBe(201);
    const { token } = (await issued.json()) as { token: string };
    expect(
      await env.DB.prepare(
        'SELECT token_hash FROM representative_invitations',
      ).first('token_hash'),
    ).not.toBe(token);
    cookie = '';
    const details = {
      token,
      name: 'Representante de prueba',
      email: 'new-rep@example.invalid',
      password,
    };
    expect(
      (
        await request('/api/representative-invitations/accept', {
          ...details,
          email: 'wrong@example.invalid',
        })
      ).status,
    ).toBe(400);
    expect(
      (await request('/api/representative-invitations/accept', details)).status,
    ).toBe(201);
    expect(
      (await request('/api/representative-invitations/accept', details)).status,
    ).toBe(400);
    expect(
      await env.DB.prepare('SELECT emailVerified FROM "user" WHERE email=?')
        .bind(details.email)
        .first('emailVerified'),
    ).toBe(0);
    cookie = '';
    const loginResult = await request(
      '/api/auth/sign-in/email',
      {
        email: details.email,
        password,
      },
      { 'cf-connecting-ip': '192.0.2.247' },
    );
    expect(loginResult.status).toBe(200);
    saveCookies(loginResult);
    const repCookie = cookie;
    expect((await request(`/api/clubs/${club.id}`)).status).toBe(404);
    const change = await env.DB.prepare(
      "SELECT id FROM change_requests WHERE kind='REPRESENTATIVE' AND club_id=?",
    )
      .bind(club.id)
      .first<{ id: string }>();
    cookie = firstCookie;
    expect(
      (await request(`/api/changes/${change!.id}/approve`, {})).status,
    ).toBe(200);
    cookie = await secondAdministrator();
    expect(
      (await request(`/api/changes/${change!.id}/approve`, {})).status,
    ).toBe(200);
    cookie = repCookie;
    expect((await request(`/api/clubs/${club.id}`)).status).toBe(200);
    const me = await (await request('/api/me')).json();
    expect(me).toMatchObject({ clubs: [{ id: club.id }] });
    expect(
      (
        await request('/api/representative-invitations', {
          email: 'forbidden@example.invalid',
          clubId: club.id,
        })
      ).status,
    ).toBe(404);
    cookie = presidentCookie;
    const pending = await request('/api/representative-invitations', {
      email: 'pending@example.invalid',
      clubId: club.id,
    });
    expect(pending.status).toBe(201);
    const pendingToken = ((await pending.json()) as { token: string }).token;
    const presidentMembership = await env.DB.prepare(
      'SELECT membership_id FROM club_president_authorities WHERE club_id=?',
    )
      .bind(club.id)
      .first<string>('membership_id');
    cookie = firstCookie;
    const stalePresidentInvite = await request(
      '/api/representative-invitations',
      {
        clubId: club.id,
        email: 'stale-president@example.invalid',
        kind: 'PRESIDENT',
      },
    );
    expect(stalePresidentInvite.status).toBe(201);
    const stalePresidentToken = (
      (await stalePresidentInvite.json()) as { token: string }
    ).token;
    expect(
      (
        await request(
          `/api/clubs/${club.id}/representatives/${presidentMembership}`,
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(200);
    cookie = presidentCookie;
    expect(
      (
        await request('/api/representative-invitations', {
          email: 'blocked@example.invalid',
          clubId: club.id,
        })
      ).status,
    ).toBe(404);
    cookie = '';
    expect(
      (
        await request(
          '/api/representative-invitations/accept',
          {
            token: stalePresidentToken,
            name: 'Stale President',
            email: 'stale-president@example.invalid',
            password,
          },
          { 'cf-connecting-ip': '192.0.2.244' },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request('/api/representative-invitations/accept', {
          token: pendingToken,
          name: 'Pending',
          email: 'pending@example.invalid',
          password,
        })
      ).status,
    ).toBe(400);
  }, 45000);

  it('rejects expired invitations and invitations from administrators who lose authority', async () => {
    await administrator();
    const adminCookie = cookie;
    const club = await createClub();
    const first = await request('/api/representative-invitations', {
      email: 'expired@example.invalid',
      clubId: club.id,
      kind: 'PRESIDENT',
    });
    const { token } = (await first.json()) as { token: string };
    await env.DB.prepare(
      "UPDATE representative_invitations SET expires_at='2000-01-01T00:00:00.000Z'",
    ).run();
    cookie = '';
    expect(
      (
        await request('/api/representative-invitations/accept', {
          token,
          name: 'Test',
          email: 'expired@example.invalid',
          password,
        })
      ).status,
    ).toBe(400);
    cookie = adminCookie;
    const next = await request('/api/representative-invitations', {
      email: 'revoked@example.invalid',
      clubId: club.id,
      kind: 'PRESIDENT',
    });
    const revokedToken = ((await next.json()) as { token: string }).token;
    await createDb(env.DB)
      .update(globalRoleAssignments)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(globalRoleAssignments.userId, 'club-admin'));
    cookie = '';
    expect(
      (
        await request('/api/representative-invitations/accept', {
          token: revokedToken,
          name: 'Test',
          email: 'revoked@example.invalid',
          password,
        })
      ).status,
    ).toBe(400);
    expect(
      await env.DB.prepare('SELECT count(*) AS n FROM "user" WHERE email=?')
        .bind('revoked@example.invalid')
        .first('n'),
    ).toBe(0);
  }, 30000);
  it('revokes only the selected club membership atomically and invalidates the existing session', async () => {
    await administrator();
    const adminCookie = cookie;
    const clubA = await createClub();
    const clubB = await createDb(env.DB)
      .insert(clubs)
      .values({
        id: 'club-b',
        name: 'Club B',
        slug: 'club-b',
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    await seedUser('representative');
    const now = new Date().toISOString();
    await createDb(env.DB)
      .insert(clubMemberships)
      .values([
        {
          id: 'member-a',
          userId: 'representative',
          clubId: clubA.id,
          createdAt: now,
        },
        {
          id: 'member-b',
          userId: 'representative',
          clubId: clubB.id,
          createdAt: now,
        },
      ]);
    await login('representative');
    const repCookie = cookie;
    expect((await request(`/api/clubs/${clubA.id}`)).status).toBe(200);
    expect(
      (
        await request(
          `/api/clubs/${clubA.id}/representatives/member-a`,
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(403);
    cookie = adminCookie;
    expect(
      (
        await request(
          `/api/clubs/${clubA.id}/representatives/member-a`,
          undefined,
          { origin: 'https://untrusted.invalid' },
          'DELETE',
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `/api/clubs/${clubB.id}/representatives/member-a`,
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(404);
    await env.DB.prepare(
      "CREATE TRIGGER fail_revoke_audit BEFORE INSERT ON audit_logs WHEN NEW.action='MEMBERSHIP_REVOKED' BEGIN SELECT RAISE(ABORT,'audit failure'); END",
    ).run();
    try {
      expect(
        (
          await request(
            `/api/clubs/${clubA.id}/representatives/member-a`,
            undefined,
            {},
            'DELETE',
          )
        ).status,
      ).toBe(500);
      expect(
        await env.DB.prepare(
          'SELECT revoked_at FROM club_memberships WHERE id=?',
        )
          .bind('member-a')
          .first('revoked_at'),
      ).toBeNull();
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_revoke_audit').run();
    }
    expect(
      (
        await request(
          `/api/clubs/${clubA.id}/representatives/member-a`,
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/clubs/${clubA.id}/representatives/member-a`,
          undefined,
          {},
          'DELETE',
        )
      ).status,
    ).toBe(404);
    expect(
      await env.DB.prepare(
        "SELECT count(*) AS n FROM audit_logs WHERE action='MEMBERSHIP_REVOKED' AND resource_id=?",
      )
        .bind(clubA.id)
        .first('n'),
    ).toBe(1);
    cookie = repCookie;
    expect((await request(`/api/clubs/${clubA.id}`)).status).toBe(404);
    expect((await request(`/api/clubs/${clubB.id}`)).status).toBe(200);
  }, 30000);
  it('requires two distinct active league administrators for club and all person assignments', async () => {
    await administrator();
    const firstCookie = cookie;
    await seedUser('second-admin', true);
    await login('second-admin');
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    expect(verified.status).toBe(200);
    saveCookies(verified);
    const secondCookie = cookie;
    await seedUser('representative');

    async function submit(body: Record<string, unknown>) {
      const response = await request('/api/changes', body);
      expect(response.status, await response.clone().text()).toBe(201);
      return ((await response.json()) as { id: string }).id;
    }
    async function approveTwice(id: string) {
      cookie = firstCookie;
      expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(
        200,
      );
      expect((await request(`/api/changes/${id}/approve`, {})).status).toBe(
        409,
      );
      cookie = secondCookie;
      const response = await request(`/api/changes/${id}/approve`, {});
      expect(response.status, await response.clone().text()).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'APPLIED' });
    }
    cookie = firstCookie;
    const clubRequest = await submit({ kind: 'CLUB', details });
    expect(await createDb(env.DB).select().from(clubs)).toHaveLength(0);
    await approveTwice(clubRequest);
    const club = (await createDb(env.DB).select().from(clubs))[0]!;
    expect(club.name).toBe(details.name);
    for (const body of [
      { kind: 'PRESIDENT', clubId: club.id, name: 'President One' },
      {
        kind: 'REPRESENTATIVE',
        clubId: club.id,
        email: 'representative@example.invalid',
      },
      { kind: 'TECHNICAL_DIRECTOR', clubId: club.id, name: 'Coach One' },
      { kind: 'PLAYER', clubId: club.id, firstName: 'Player', lastName: 'One' },
    ]) {
      cookie = firstCookie;
      const id = await submit(body);
      await approveTwice(id);
    }
    const detail = await (await request(`/api/clubs/${club.id}`)).json();
    expect(detail).toMatchObject({
      president: { name: 'President One' },
      representatives: [{ name: 'Fixture representative' }],
      technicalDirectors: [{ name: 'Coach One' }],
      players: [{ name: 'Player One' }],
    });
    await login('representative');
    expect(
      (await request(`/api/changes/${clubRequest}/approve`, {})).status,
    ).toBe(403);
    expect(
      (await request(`/api/changes/${clubRequest}/reject`, {})).status,
    ).toBe(403);
    expect(
      (
        await request('/api/changes', {
          kind: 'PRESIDENT',
          clubId: 'not-my-club',
          name: 'Attack',
        })
      ).status,
    ).toBe(404);
    const replacement = await submit({
      kind: 'PRESIDENT',
      clubId: club.id,
      name: 'President Two',
    });
    const stale = await submit({
      kind: 'PRESIDENT',
      clubId: club.id,
      name: 'Stale President',
    });
    expect(await (await request(`/api/clubs/${club.id}`)).json()).toMatchObject(
      { president: { name: 'President One' } },
    );
    await approveTwice(replacement);
    expect(await (await request(`/api/clubs/${club.id}`)).json()).toMatchObject(
      { president: { name: 'President Two' } },
    );
    cookie = firstCookie;
    expect((await request(`/api/changes/${stale}/approve`, {})).status).toBe(
      200,
    );
    cookie = secondCookie;
    expect((await request(`/api/changes/${stale}/approve`, {})).status).toBe(
      409,
    );
    expect(
      await env.DB.prepare(
        'SELECT count(*) AS n FROM change_approvals WHERE request_id=?',
      )
        .bind(stale)
        .first('n'),
    ).toBe(1);
    expect((await request(`/api/changes/${stale}/reject`, {})).status).toBe(
      200,
    );
    expect((await request(`/api/changes/${stale}/approve`, {})).status).toBe(
      409,
    );
  });
  it('does not disclose representative account existence and hides target data from club representatives', async () => {
    await administrator();
    const adminCookie = cookie;
    const club = await createClub();
    await seedUser('requesting-representative');
    await seedUser('existing-target');
    await createDb(env.DB).insert(clubMemberships).values({
      id: 'requester-membership',
      userId: 'requesting-representative',
      clubId: club.id,
      createdAt: new Date().toISOString(),
    });
    await env.DB.prepare(
      `INSERT INTO club_president_authorities (id,membership_id,club_id,user_id,created_at) VALUES (?,?,?,?,?)`,
    )
      .bind(
        'requester-president',
        'requester-membership',
        club.id,
        'requesting-representative',
        new Date().toISOString(),
      )
      .run();
    await login('requesting-representative');

    const existing = await request('/api/changes', {
      kind: 'REPRESENTATIVE',
      clubId: club.id,
      email: 'existing-target@example.invalid',
    });
    const missing = await request('/api/changes', {
      kind: 'REPRESENTATIVE',
      clubId: club.id,
      email: 'missing-target@example.invalid',
    });
    expect(existing.status).toBe(201);
    expect(missing.status).toBe(201);
    const existingId = ((await existing.json()) as { id: string }).id;
    const missingId = ((await missing.json()) as { id: string }).id;
    const stored = await env.DB.prepare(
      'SELECT id, payload_json AS payloadJson FROM change_requests WHERE id IN (?, ?) ORDER BY id',
    )
      .bind(existingId, missingId)
      .all<{ id: string; payloadJson: string }>();
    for (const row of stored.results) {
      expect(JSON.parse(row.payloadJson)).toMatchObject({
        email: expect.stringMatching(/@example\.invalid$/),
      });
      expect(JSON.parse(row.payloadJson)).not.toHaveProperty('userId');
      expect(JSON.parse(row.payloadJson)).not.toHaveProperty('name');
    }

    const representativeItems = (await (
      await request('/api/changes')
    ).json()) as { items: { id: string; payload: Record<string, unknown> }[] };
    for (const id of [existingId, missingId]) {
      const item = representativeItems.items.find((entry) => entry.id === id)!;
      expect(item.payload).not.toHaveProperty('email');
      expect(item.payload).not.toHaveProperty('name');
      expect(item.payload).not.toHaveProperty('userId');
    }

    cookie = adminCookie;
    const adminItems = (await (await request('/api/changes')).json()) as {
      items: { id: string; payload: Record<string, unknown> }[];
    };
    expect(
      adminItems.items.find((entry) => entry.id === existingId)?.payload.email,
    ).toBe('existing-target@example.invalid');
    expect(
      adminItems.items.find((entry) => entry.id === missingId)?.payload.email,
    ).toBe('missing-target@example.invalid');
  });
  it('resolves representative accounts at application, rechecks availability and preserves legacy requests', async () => {
    await administrator();
    const firstAdminCookie = cookie;
    const secondAdminCookie = await secondAdministrator();
    const club = await createClub();
    await seedUser('deferred-target');

    cookie = firstAdminCookie;
    const response = await request('/api/changes', {
      kind: 'REPRESENTATIVE',
      clubId: club.id,
      email: 'deferred-target@example.invalid',
    });
    expect(response.status).toBe(201);
    const requestId = ((await response.json()) as { id: string }).id;
    const storedPayload = await env.DB.prepare(
      'SELECT payload_json FROM change_requests WHERE id=?',
    )
      .bind(requestId)
      .first<string>('payload_json');
    expect(JSON.parse(storedPayload!)).toMatchObject({
      email: 'deferred-target@example.invalid',
    });

    expect(
      (await request(`/api/changes/${requestId}/approve`, {})).status,
    ).toBe(200);
    await env.DB.prepare('UPDATE "user" SET status=? WHERE id=?')
      .bind('SUSPENDED', 'deferred-target')
      .run();
    cookie = secondAdminCookie;
    expect(
      (await request(`/api/changes/${requestId}/approve`, {})).status,
    ).toBe(409);
    expect(
      await env.DB.prepare(
        'SELECT count(*) FROM change_approvals WHERE request_id=?',
      )
        .bind(requestId)
        .first('count(*)'),
    ).toBe(1);
    expect(
      await env.DB.prepare(
        'SELECT count(*) FROM club_memberships WHERE user_id=? AND club_id=?',
      )
        .bind('deferred-target', club.id)
        .first('count(*)'),
    ).toBe(0);

    await env.DB.prepare(
      'UPDATE "user" SET status=?, "emailVerified"=0 WHERE id=?',
    )
      .bind('ACTIVE', 'deferred-target')
      .run();
    expect(
      (await request(`/api/changes/${requestId}/approve`, {})).status,
    ).toBe(409);
    await env.DB.prepare('UPDATE "user" SET "emailVerified"=1 WHERE id=?')
      .bind('deferred-target')
      .run();
    expect(
      (await request(`/api/changes/${requestId}/approve`, {})).status,
    ).toBe(200);
    expect(
      await env.DB.prepare(
        'SELECT count(*) FROM club_memberships WHERE user_id=? AND club_id=?',
      )
        .bind('deferred-target', club.id)
        .first('count(*)'),
    ).toBe(1);
    const audit = await env.DB.prepare(
      "SELECT metadata_json FROM audit_logs WHERE action='CHANGE_APPLIED' AND resource_id=?",
    )
      .bind(requestId)
      .first<string>('metadata_json');
    expect(JSON.parse(audit!)).toMatchObject({
      kind: 'REPRESENTATIVE',
      clubId: club.id,
    });
    expect(audit).not.toContain('deferred-target@example.invalid');

    await seedUser('legacy-target');
    const legacyId = crypto.randomUUID();
    const legacyEntityId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO change_requests (id, kind, club_id, requester_id, payload_json, status, created_at) VALUES (?, 'REPRESENTATIVE', ?, ?, ?, 'PENDING', ?)",
    )
      .bind(
        legacyId,
        club.id,
        'club-admin',
        JSON.stringify({
          entityId: legacyEntityId,
          userId: 'legacy-target',
          name: 'Legacy Fixture',
          email: 'legacy-target@example.invalid',
        }),
        now,
      )
      .run();
    cookie = firstAdminCookie;
    expect((await request(`/api/changes/${legacyId}/approve`, {})).status).toBe(
      200,
    );
    cookie = secondAdminCookie;
    expect((await request(`/api/changes/${legacyId}/approve`, {})).status).toBe(
      200,
    );
    expect(
      await env.DB.prepare(
        'SELECT count(*) FROM club_memberships WHERE user_id=? AND club_id=?',
      )
        .bind('legacy-target', club.id)
        .first('count(*)'),
    ).toBe(1);
    const legacyAudit = await env.DB.prepare(
      "SELECT metadata_json FROM audit_logs WHERE action='CHANGE_APPLIED' AND resource_id=?",
    )
      .bind(legacyId)
      .first<string>('metadata_json');
    expect(legacyAudit).not.toContain('legacy-target@example.invalid');
    await login('legacy-target');
    const legacyItems = (await (await request('/api/changes')).json()) as {
      items: { id: string; payload: Record<string, unknown> }[];
    };
    const legacyItem = legacyItems.items.find(
      (entry) => entry.id === legacyId,
    )!;
    expect(legacyItem.payload).not.toHaveProperty('email');
    expect(legacyItem.payload).not.toHaveProperty('name');
    expect(legacyItem.payload).not.toHaveProperty('userId');
  });
  it('guards all club routes and hides memberships in me until admin MFA is verified', async () => {
    expect((await request('/api/clubs')).status).toBe(401);
    await seedUser('club-admin', true);
    await createDb(env.DB).insert(clubs).values({
      id: 'private',
      name: 'Private club',
      slug: 'private',
      createdAt: new Date().toISOString(),
    });
    await createDb(env.DB).insert(clubMemberships).values({
      id: 'private-membership',
      userId: 'club-admin',
      clubId: 'private',
      createdAt: new Date().toISOString(),
    });
    await login('club-admin');
    expect(await (await request('/api/me')).json()).toMatchObject({
      mfaRequired: true,
      clubs: [],
    });
    expect((await request('/api/clubs')).status).toBe(403);
    expect((await request('/api/clubs/private')).status).toBe(403);
    expect((await request('/api/clubs', details)).status).toBe(403);
    expect(
      (
        await request(
          '/api/clubs/private',
          { name: 'Changed', version: 1 },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(403);
    const enabled = await request('/api/auth/two-factor/enable', { password });
    expect(enabled.status).toBe(200);
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    expect(verified.status).toBe(200);
    saveCookies(verified);
    expect(await (await request('/api/me')).json()).toMatchObject({
      mfaRequired: false,
      clubs: [{ id: 'private', name: 'Private club' }],
    });
    expect((await request('/api/clubs/private')).status).toBe(200);
  });
  it('requires a request for club creation and checks the origin', async () => {
    await administrator();
    expect((await request('/api/clubs', details)).status).toBe(403);
    env.AUTH_BASE_URL = origin + '/';
    try {
      expect(
        (await request('/api/changes', { kind: 'CLUB', details })).status,
      ).toBe(201);
      expect(await createDb(env.DB).select().from(clubs)).toHaveLength(0);
      expect(
        (
          await request(
            '/api/changes',
            { kind: 'CLUB', details },
            { origin: 'https://untrusted.invalid' },
          )
        ).status,
      ).toBe(403);
    } finally {
      env.AUTH_BASE_URL = origin + '/';
    }
  });
  it('normalizes the origin for updates without allowing cross-origin or originless writes', async () => {
    await administrator();
    const club = await createClub();
    env.AUTH_BASE_URL = `${origin}/`;
    try {
      for (const untrustedOrigin of ['', 'https://untrusted.invalid']) {
        expect(
          (
            await request(
              `/api/clubs/${club.id}`,
              { name: 'Forbidden change', version: 1 },
              { origin: untrustedOrigin },
              'PATCH',
            )
          ).status,
        ).toBe(403);
      }
      expect(
        await (await request(`/api/clubs/${club.id}`)).json(),
      ).toMatchObject({ name: details.name, version: 1 });
      expect(
        await env.DB.prepare('SELECT count(*) FROM audit_logs').first(
          'count(*)',
        ),
      ).toBe(1);
      const updated = await request(
        `/api/clubs/${club.id}`,
        { name: 'Allowed change', version: 1 },
        {},
        'PATCH',
      );
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({
        name: 'Allowed change',
        version: 2,
      });
      expect(
        await env.DB.prepare('SELECT count(*) FROM audit_logs').first(
          'count(*)',
        ),
      ).toBe(2);
    } finally {
      env.AUTH_BASE_URL = origin;
    }
  });
  it('updates and changes status with atomic audit and rejects stale concurrent writes', async () => {
    await administrator();
    const club = await createClub();
    const responses = await Promise.all([
      request(
        `/api/clubs/${club.id}`,
        { name: 'First change', version: 1 },
        {},
        'PATCH',
      ),
      request(
        `/api/clubs/${club.id}`,
        { name: 'Second change', version: 1 },
        {},
        'PATCH',
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(
      await env.DB.prepare('SELECT count(*) FROM audit_logs').first('count(*)'),
    ).toBe(2);
    expect(
      (
        await request(
          `/api/clubs/${club.id}`,
          { status: 'INACTIVE', version: 2 },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect(await (await request(`/api/clubs/${club.id}`)).json()).toMatchObject(
      { status: 'INACTIVE', version: 3 },
    );
    expect(await (await request('/api/clubs')).json()).toMatchObject({
      total: 0,
    });
    expect(
      await (await request('/api/clubs?status=INACTIVE')).json(),
    ).toMatchObject({ total: 1 });
    expect(
      (
        await request(
          `/api/clubs/${club.id}`,
          { status: 'ACTIVE', version: 3 },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(200);
    const audit = await env.DB.prepare(
      'SELECT action FROM audit_logs ORDER BY rowid',
    ).all();
    expect(audit.results.map((r) => r.action)).toEqual([
      'CLUB_CREATED',
      'CLUB_UPDATED',
      'CLUB_DEACTIVATED',
      'CLUB_REACTIVATED',
    ]);
  });
  it('filters representative lists, totals, search and detail by live memberships and club status', async () => {
    await seedUser('representative');
    const db = createDb(env.DB);
    for (const id of ['a', 'b', 'c'])
      await db.insert(clubs).values({
        id,
        name: `Club ${id}`,
        slug: `club-${id}`,
        createdAt: new Date().toISOString(),
      });
    for (const id of ['a', 'b'])
      await db.insert(clubMemberships).values({
        id,
        userId: 'representative',
        clubId: id,
        createdAt: new Date().toISOString(),
      });
    await login('representative');
    expect(
      await (await request('/api/clubs?pageSize=1&sort=name_desc')).json(),
    ).toMatchObject({ total: 2, items: [{ id: 'b' }] });
    expect(
      await (
        await request('/api/clubs?pageSize=1&page=2&sort=name_desc')
      ).json(),
    ).toMatchObject({ total: 2, items: [{ id: 'a' }] });
    expect(
      await (await request('/api/clubs?q=Club%20c&status=ALL')).json(),
    ).toMatchObject({ total: 0, items: [] });
    expect(await (await request('/api/clubs?q=%25')).json()).toMatchObject({
      total: 0,
    });
    expect((await request('/api/clubs/c')).status).toBe(404);
    expect((await request('/api/clubs', details)).status).toBe(403);
    expect(
      (
        await request(
          '/api/clubs/a',
          { name: 'Attack', version: 1 },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(403);
    expect((await request('/api/clubs?pageSize=1000')).status).toBe(400);
    expect((await request('/api/clubs?sort=malicious')).status).toBe(400);
    await db
      .update(clubMemberships)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(clubMemberships.id, 'a'));
    await db.update(clubs).set({ status: 'INACTIVE' }).where(eq(clubs.id, 'b'));
    expect(await (await request('/api/clubs?status=ALL')).json()).toMatchObject(
      { total: 0, items: [] },
    );
    expect((await request('/api/clubs/a')).status).toBe(404);
    expect((await request('/api/clubs/b')).status).toBe(404);
  });
  it('rolls back club writes when audit fails and rolls back audit on slug conflicts', async () => {
    await administrator();
    await env.DB.prepare(
      `CREATE TRIGGER fail_club_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'test failure'); END`,
    ).run();
    try {
      expect(
        (await request('/api/changes', { kind: 'CLUB', details })).status,
      ).toBe(500);
      expect(await createDb(env.DB).select().from(clubs)).toHaveLength(0);
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_club_audit').run();
    }
    const club = await createClub();
    await createDb(env.DB).insert(clubs).values({
      id: 'other',
      name: 'Other',
      slug: 'other-club',
      createdAt: new Date().toISOString(),
    });
    await env.DB.prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json) VALUES ('other-audit', 'club-admin', 'CLUB_CREATED', 'CLUB', 'other', ?, '{}')",
    )
      .bind(new Date().toISOString())
      .run();
    expect(
      (
        await request(
          `/api/clubs/${club.id}`,
          { slug: 'other-club', version: 1 },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(409);
    expect(
      await env.DB.prepare('SELECT count(*) FROM audit_logs').first('count(*)'),
    ).toBe(2);
    expect(await (await request(`/api/clubs/${club.id}`)).json()).toMatchObject(
      { version: 1, slug: details.slug },
    );
  });
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
    await seedUser('representative');
    const db = createDb(env.DB);
    await db.insert(clubs).values({
      id: 'a',
      name: 'Club A',
      slug: 'a',
      createdAt: new Date().toISOString(),
    });
    await db.insert(clubMemberships).values({
      id: 'first',
      userId: 'representative',
      clubId: 'a',
      createdAt: new Date().toISOString(),
    });
    await expect(
      db.insert(clubMemberships).values({
        id: 'duplicate',
        userId: 'representative',
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
    await seedUser('representative');
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
        userId: 'representative',
        clubId,
        createdAt: new Date().toISOString(),
      });
    const signedIn = await login('representative');
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
    await seedUser('representative');
    await login('representative');
    const oldCookie = cookie;
    expect((await request('/api/auth/sign-out', {})).status).toBe(200);
    cookie = oldCookie;
    expect((await request('/api/me')).status).toBe(401);
    await login('representative');
    await createDb(env.DB)
      .update(session)
      .set({ expiresAt: new Date(0) });
    expect((await request('/api/me')).status).toBe(401);
    await login('representative');
    await createDb(env.DB).update(user).set({ status: 'SUSPENDED' });
    expect((await request('/api/me')).status).toBe(401);
    cookie = '';
    const denied = await request('/api/auth/sign-in/email', {
      email: 'representative@example.invalid',
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

describe('season management', () => {
  it('allows MFA admins to create, activate and close seasons atomically while preserving history', async () => {
    expect((await request('/api/seasons')).status).toBe(401);
    await seedUser('season-admin', true);
    await login('season-admin');
    const payload = {
      name: 'Temporada 2027',
      year: 2027,
      startDate: '2027-03-01',
      endDate: '2027-12-01',
    };
    expect((await request('/api/seasons', payload)).status).toBe(403);
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    expect(verified.status).toBe(200);
    saveCookies(verified);
    expect(
      (await request('/api/seasons', { ...payload, startDate: '2027-02-30' }))
        .status,
    ).toBe(400);
    expect(
      (await request('/api/seasons', { ...payload, endDate: '2026-01-01' }))
        .status,
    ).toBe(400);
    expect(
      (
        await request('/api/seasons', payload, {
          origin: 'https://other.invalid',
        })
      ).status,
    ).toBe(403);
    const created = await request('/api/seasons', payload);
    expect(created.status).toBe(201);
    const season = (await created.json()) as { id: string; status: string };
    expect(season.status).toBe('DRAFT');
    expect(
      (
        await request(
          `/api/seasons/${season.id}/status`,
          { from: 'DRAFT', to: 'CLOSED' },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(400);
    const competing = await Promise.all([
      request(
        `/api/seasons/${season.id}/status`,
        { from: 'DRAFT', to: 'ACTIVE' },
        {},
        'PATCH',
      ),
      request(
        `/api/seasons/${season.id}/status`,
        { from: 'DRAFT', to: 'ACTIVE' },
        {},
        'PATCH',
      ),
    ]);
    expect(competing.map((r) => r.status).sort()).toEqual([200, 409]);
    const parallel = await request('/api/seasons', {
      ...payload,
      name: 'Otra temporada',
    });
    expect(parallel.status).toBe(201);
    const other = (await parallel.json()) as { id: string };
    expect(
      (
        await request(
          `/api/seasons/${other.id}/status`,
          { from: 'DRAFT', to: 'ACTIVE' },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect(
      await (await request('/api/seasons?status=ACTIVE')).json(),
    ).toMatchObject({ total: 2 });
    expect(
      (
        await request(
          `/api/seasons/${season.id}/status`,
          { from: 'ACTIVE', to: 'CLOSED' },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/api/seasons/${season.id}/status`,
          { from: 'ACTIVE', to: 'CLOSED' },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(409);
    expect(
      await (await request('/api/seasons?status=CLOSED')).json(),
    ).toMatchObject({ total: 1, items: [{ id: season.id, status: 'CLOSED' }] });
    expect(
      (
        await env.DB.prepare(
          "SELECT action FROM audit_logs WHERE resource_type='SEASON' AND resource_id=? ORDER BY rowid",
        )
          .bind(season.id)
          .all()
      ).results.map((r) => r.action),
    ).toEqual(['SEASON_CREATED', 'SEASON_ACTIVATED', 'SEASON_CLOSED']);
    await seedUser('season-representative');
    await login('season-representative');
    expect((await request('/api/seasons')).status).toBe(200);
    expect((await request('/api/seasons', payload)).status).toBe(403);
    expect(
      (
        await request(
          `/api/seasons/${season.id}/status`,
          { from: 'ACTIVE', to: 'CLOSED' },
          {},
          'PATCH',
        )
      ).status,
    ).toBe(403);
  });
  it('rolls back season creation if auditing fails', async () => {
    await seedUser('season-admin', true);
    await login('season-admin');
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    saveCookies(verified);
    await env.DB.prepare(
      "CREATE TRIGGER fail_season_audit BEFORE INSERT ON audit_logs WHEN NEW.action='SEASON_CREATED' BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    ).run();
    try {
      expect(
        (
          await request('/api/seasons', {
            name: 'Temp',
            year: 2027,
            startDate: '2027-01-01',
            endDate: '2027-12-31',
          })
        ).status,
      ).toBe(500);
      expect(
        await env.DB.prepare('SELECT count(*) AS n FROM seasons').first('n'),
      ).toBe(0);
    } finally {
      await env.DB.prepare('DROP TRIGGER fail_season_audit').run();
    }
  });
});

describe('audit trail', () => {
  it('requires a league administrator with MFA and exposes only the filtered summary', async () => {
    expect((await request('/api/audit-logs')).status).toBe(401);
    await seedUser('audit-admin', true);
    await login('audit-admin');
    expect((await request('/api/audit-logs')).status).toBe(403);
    const enabled = await request('/api/auth/two-factor/enable', { password });
    const { totpURI } = (await enabled.json()) as { totpURI: string };
    const verified = await request('/api/auth/two-factor/verify-totp', {
      code: totp(totpURI),
    });
    saveCookies(verified);
    const adminCookie = cookie;
    const db = createDb(env.DB);
    await db.insert(clubs).values({
      id: 'audit-club',
      name: 'Club auditado',
      slug: 'audit-club',
      createdAt: '2027-01-01T00:00:00.000Z',
    });
    await env.DB.prepare(
      `INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json) VALUES
      ('log-one', 'audit-admin', 'CLUB_UPDATED', 'CLUB', 'audit-club', '2027-01-01T23:59:59.000Z', '{"before":{"name":"Original","secret":"DO_NOT_RETURN"},"after":{"name":"Nuevo","secret":"ALSO_PRIVATE"}}'),
      ('log-two', 'audit-admin', 'SEASON_CREATED', 'SEASON', 'missing', '2027-01-02T00:00:00.000Z', '{"name":"PRIVATE"}')`,
    ).run();
    const filtered = await request(
      '/api/audit-logs?resourceType=CLUB&from=2027-01-01&to=2027-01-01&pageSize=1',
    );
    expect(filtered.status).toBe(200);
    const body = await filtered.json();
    expect(body).toMatchObject({
      total: 1,
      items: [
        {
          id: 'log-one',
          actorName: 'Fixture audit-admin',
          resourceName: 'Club auditado',
          action: 'CLUB_UPDATED',
          changes: [{ field: 'name', before: 'Original', after: 'Nuevo' }],
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('DO_NOT_RETURN');
    expect(JSON.stringify(body)).not.toContain('metadata');
    expect(
      await (await request('/api/audit-logs?page=2&pageSize=1')).json(),
    ).toMatchObject({ total: 2, items: [{ id: 'log-one' }] });
    expect((await request('/api/audit-logs?resourceType=invalid')).status).toBe(
      400,
    );
    expect((await request('/api/audit-logs?from=2027-02-30')).status).toBe(400);
    expect(
      (await request('/api/audit-logs?from=2027-01-02&to=2027-01-01')).status,
    ).toBe(400);
    await seedUser('audit-representative');
    await login('audit-representative');
    expect((await request('/api/audit-logs')).status).toBe(403);
    cookie = adminCookie;
    await db
      .update(globalRoleAssignments)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(globalRoleAssignments.id, 'role-audit-admin'));
    expect((await request('/api/audit-logs')).status).toBe(403);
  });
});
