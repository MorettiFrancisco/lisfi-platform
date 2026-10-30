import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { hashPassword } from 'better-auth/crypto';
import { recoveryAcceptSchema, recoveryLinkRequestSchema } from '@lisfi/shared';
import type { Bindings } from '../../env';
import type { ProtectedEnv } from './routes';
import { createAuth } from './auth';
import { digest, hex } from './invitations';

// Only the bootstrap administrator can issue recovery links to an administrator.
const authorized = (
  actor: string,
  target: string,
) => `EXISTS (SELECT 1 FROM global_role_assignments g
  JOIN "user" u ON u.id=g.user_id WHERE g.user_id=${actor} AND g.role='LEAGUE_ADMIN'
  AND g.revoked_at IS NULL AND u.status='ACTIVE' AND u."twoFactorEnabled"=1
  AND EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId"=u.id AND t.verified=1))
  AND (NOT EXISTS (SELECT 1 FROM global_role_assignments g WHERE g.user_id=${target}
    AND g.role='LEAGUE_ADMIN' AND g.revoked_at IS NULL)
    OR EXISTS (SELECT 1 FROM initial_admin_bootstrap b WHERE b.user_id=${actor}))`;

export const recoveryRoutes = new Hono<ProtectedEnv>();
recoveryRoutes.post('/', bodyLimit({ maxSize: 8192 }), async (c) => {
  const actor = c.get('identity');
  if (!actor.isLeagueAdmin || !actor.mfaEnabled)
    return c.json({ error: 'Forbidden' }, 403);
  if (c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin)
    return c.json({ error: 'Forbidden origin' }, 403);
  const input = recoveryLinkRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!input.success) return c.json({ error: 'Invalid request' }, 400);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const id = crypto.randomUUID();
  const created = new Date();
  const now = created.toISOString();
  const expiresAt = new Date(created.getTime() + 60 * 60 * 1000).toISOString();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO recovery_links (id,token_hash,user_id,issued_by,created_at,expires_at)
      SELECT ?,?,?,?,?,? WHERE ${authorized('?', '?')}
      AND EXISTS (SELECT 1 FROM "user" u WHERE u.id=? AND u.status='ACTIVE')
      AND 1=(SELECT count(*) FROM account a WHERE a."userId"=? AND a."providerId"='credential')`,
    ).bind(
      id,
      await digest(token),
      input.data.userId,
      actor.id,
      now,
      expiresAt,
      actor.id,
      input.data.userId,
      actor.id,
      input.data.userId,
      input.data.userId,
    ),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json)
      SELECT ?,?,'RECOVERY_LINK_CREATED','USER',user_id,?,json_object('linkId',id) FROM recovery_links WHERE id=?`,
    ).bind(crypto.randomUUID(), actor.id, now, id),
  ]);
  if (result[0]!.meta.changes !== 1)
    return c.json({ error: 'Account unavailable' }, 404);
  return c.json({ token, expiresAt }, 201);
});

export const recoveryAcceptanceRoutes = new Hono<{ Bindings: Bindings }>();
recoveryAcceptanceRoutes.post(
  '/recovery-links/accept',
  bodyLimit({ maxSize: 8192 }),
  async (c) => {
    try {
      createAuth(c.env);
    } catch {
      return c.json({ error: 'Authentication unavailable' }, 503);
    }
    if (c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin)
      return c.json({ error: 'Forbidden origin' }, 403);
    const nowMs = Date.now();
    const rateKey = `recovery:${c.req.header('cf-connecting-ip') ?? 'local'}`;
    const attempts = await c.env.DB.prepare(
      `INSERT INTO "rateLimit" (id,key,count,lastRequest) VALUES (?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN lastRequest<=? THEN 1 ELSE count+1 END,
    lastRequest=CASE WHEN lastRequest<=? THEN excluded.lastRequest ELSE lastRequest END RETURNING count`,
    )
      .bind(crypto.randomUUID(), rateKey, nowMs, nowMs - 60000, nowMs - 60000)
      .first<{ count: number }>();
    if (!attempts || attempts.count > 5)
      return c.json({ error: 'Too many attempts' }, 429);
    const input = recoveryAcceptSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: 'Invalid recovery link' }, 400);
    const hash = await digest(input.data.token);
    const password = await hashPassword(input.data.password);
    const operation = crypto.randomUUID();
    const now = new Date(nowMs).toISOString();
    try {
      const result = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE recovery_links SET used_at=?,operation_id=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?
        AND ${authorized('recovery_links.issued_by', 'recovery_links.user_id')}
        AND EXISTS (SELECT 1 FROM "user" u WHERE u.id=recovery_links.user_id AND u.status='ACTIVE')
        AND 1=(SELECT count(*) FROM account a WHERE a."userId"=recovery_links.user_id AND a."providerId"='credential')`,
        ).bind(now, operation, hash, now),
        c.env.DB.prepare(
          `UPDATE account SET password=?, "updatedAt"=? WHERE "providerId"='credential'
        AND "userId"=(SELECT user_id FROM recovery_links WHERE token_hash=? AND operation_id=?)`,
        ).bind(password, nowMs, hash, operation),
        c.env.DB.prepare(
          `DELETE FROM "session" WHERE "userId"=(SELECT user_id FROM recovery_links WHERE token_hash=? AND operation_id=?)`,
        ).bind(hash, operation),
        c.env.DB.prepare(
          `UPDATE recovery_links SET used_at=?,operation_id=? WHERE used_at IS NULL AND token_hash<>?
        AND user_id=(SELECT user_id FROM recovery_links WHERE token_hash=? AND operation_id=?)`,
        ).bind(now, operation, hash, hash, operation),
        c.env.DB.prepare(
          `INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json)
        SELECT ?,user_id,'PASSWORD_RECOVERED','USER',user_id,?,json_object('linkId',id) FROM recovery_links WHERE token_hash=? AND operation_id=?`,
        ).bind(crypto.randomUUID(), now, hash, operation),
      ]);
      if (result[0]!.meta.changes !== 1 || result[1]!.meta.changes !== 1)
        return c.json({ error: 'Invalid recovery link' }, 400);
    } catch {
      return c.json({ error: 'Invalid recovery link' }, 400);
    }
    return c.json({ changed: true });
  },
);
