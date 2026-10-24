import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { hashPassword } from 'better-auth/crypto';
import { bootstrapRequestSchema } from '@lisfi/shared';
import type { Bindings } from '../../env';
import { createAuth } from './auth';

export const bootstrapRoutes = new Hono<{ Bindings: Bindings }>();

async function matchesToken(actual: string, expected: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(expected),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(expected),
  );
  return crypto.subtle.verify('HMAC', key, signature, encoder.encode(actual));
}

async function alreadyInitialized(db: D1Database) {
  return !!(await db
    .prepare(
      `SELECT 1 FROM initial_admin_bootstrap
    UNION ALL SELECT 1 FROM global_role_assignments LIMIT 1`,
    )
    .first());
}

bootstrapRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});
bootstrapRoutes.post(
  '/bootstrap',
  bodyLimit({
    maxSize: 8192,
    onError: (c) => c.json({ error: 'Request too large' }, 413),
  }),
  async (c) => {
    const {
      BOOTSTRAP_TOKEN: token,
      BOOTSTRAP_EXPIRES_AT: expiration,
      DB,
    } = c.env;
    const expiresAt = Date.parse(expiration ?? '');
    // Disabled unless explicitly configured with an expiring, independent capability.
    if (
      !token ||
      !/^[a-f0-9]{64}$/.test(token) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    )
      return c.json({ error: 'Bootstrap unavailable' }, 404);
    try {
      createAuth(c.env);
    } catch {
      return c.json({ error: 'Authentication unavailable' }, 503);
    }
    if (c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin)
      return c.json({ error: 'Forbidden origin' }, 403);

    // One persistent row per source, with an atomic counter (including failed tokens).
    const now = Date.now();
    const key = `bootstrap:${c.req.header('cf-connecting-ip') ?? 'local'}`;
    const attempts = await DB.prepare(
      `INSERT INTO "rateLimit" (id, key, count, lastRequest)
    VALUES (?, ?, 1, ?) ON CONFLICT(key) DO UPDATE SET
    count = CASE WHEN lastRequest <= ? THEN 1 ELSE count + 1 END,
    lastRequest = CASE WHEN lastRequest <= ? THEN excluded.lastRequest ELSE lastRequest END
    RETURNING count`,
    )
      .bind(crypto.randomUUID(), key, now, now - 60000, now - 60000)
      .first<{ count: number }>();
    if (!attempts || attempts.count > 5) {
      c.header('Retry-After', '60');
      return c.json({ error: 'Too many attempts' }, 429);
    }
    const submittedToken = c.req.header('x-bootstrap-token') ?? '';
    if (
      submittedToken.length > 128 ||
      !(await matchesToken(submittedToken, token))
    )
      return c.json({ error: 'Invalid bootstrap credentials' }, 403);
    if (await alreadyInitialized(DB))
      return c.json({ error: 'Bootstrap closed' }, 409);
    const parsed = bootstrapRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json({ error: 'Invalid account details' }, 400);

    const { name, email, password } = parsed.data;
    const userId = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    try {
      await DB.batch([
        // CHECK(id = 1) rejects existing roles, including revoked ones. The singleton
        // primary key serializes competing requests. All four writes roll back together.
        DB.prepare(
          `INSERT INTO initial_admin_bootstrap (id, user_id, created_at)
        VALUES (CASE WHEN EXISTS (SELECT 1 FROM global_role_assignments) THEN 0 ELSE 1 END, ?, ?)`,
        ).bind(userId, new Date(now).toISOString()),
        DB.prepare(
          `INSERT INTO "user" (id, name, email, emailVerified, createdAt, updatedAt, twoFactorEnabled, status)
        VALUES (?, ?, ?, 0, ?, ?, 0, 'ACTIVE')`,
        ).bind(userId, name, email, now, now),
        DB.prepare(
          `INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt)
        VALUES (?, ?, 'credential', ?, ?, ?, ?)`,
        ).bind(crypto.randomUUID(), userId, userId, passwordHash, now, now),
        DB.prepare(
          `INSERT INTO global_role_assignments (id, user_id, role, created_at)
        VALUES (?, ?, 'LEAGUE_ADMIN', ?)`,
        ).bind(crypto.randomUUID(), userId, new Date(now).toISOString()),
      ]);
    } catch (error) {
      if (await alreadyInitialized(DB))
        return c.json({ error: 'Bootstrap closed' }, 409);
      if (
        await DB.prepare('SELECT 1 FROM "user" WHERE email = ?')
          .bind(email)
          .first()
      )
        return c.json({ error: 'Account already exists' }, 409);
      throw error;
    }
    // No automatic session or fabricated email verification. Login and MFA follow.
    return c.json({ created: true }, 201);
  },
);
