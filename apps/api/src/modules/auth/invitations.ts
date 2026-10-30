import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { hashPassword } from 'better-auth/crypto';
import {
  adminInvitationAcceptSchema,
  adminInvitationRequestSchema,
} from '@lisfi/shared';
import type { Bindings } from '../../env';
import type { ProtectedEnv } from './routes';
import { createAuth } from './auth';

const issuerAllowed = `EXISTS (SELECT 1 FROM initial_admin_bootstrap b
  JOIN global_role_assignments g ON g.user_id=b.user_id AND g.role='LEAGUE_ADMIN' AND g.revoked_at IS NULL
  JOIN "user" u ON u.id=b.user_id AND u.status='ACTIVE' AND u."twoFactorEnabled"=1
  WHERE b.user_id=? AND EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId"=u.id AND t.verified=1))`;
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const digest = async (value: string) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
    ),
  );

export const adminInvitationRoutes = new Hono<ProtectedEnv>();
adminInvitationRoutes.post('/', bodyLimit({ maxSize: 8192 }), async (c) => {
  const actor = c.get('identity');
  if (!actor.isLeagueAdmin || !actor.mfaEnabled)
    return c.json({ error: 'Forbidden' }, 403);
  if (c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin)
    return c.json({ error: 'Forbidden origin' }, 403);
  const parsed = adminInvitationRequestSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: 'Invalid invitation' }, 400);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await digest(token);
  const id = crypto.randomUUID();
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO admin_invitations (id,token_hash,email,invited_by,created_at,expires_at)
      SELECT ?,?,?,?,?,? WHERE ${issuerAllowed}`,
    ).bind(
      id,
      tokenHash,
      parsed.data.email,
      actor.id,
      createdAt,
      expiresAt,
      actor.id,
    ),
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json)
      SELECT ?,?,'ADMIN_INVITED','ADMIN_INVITATION',id,?,'{}' FROM admin_invitations WHERE id=?`,
    ).bind(crypto.randomUUID(), actor.id, createdAt, id),
  ]);
  if (result[0]!.meta.changes !== 1) return c.json({ error: 'Forbidden' }, 403);
  return c.json({ token, expiresAt }, 201);
});

export const adminInvitationAcceptanceRoutes = new Hono<{
  Bindings: Bindings;
}>();
adminInvitationAcceptanceRoutes.post(
  '/admin-invitations/accept',
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
    const rateKey = `admin-invite:${c.req.header('cf-connecting-ip') ?? 'local'}`;
    const attempts = await c.env.DB.prepare(
      `INSERT INTO "rateLimit" (id,key,count,lastRequest) VALUES (?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN lastRequest<=? THEN 1 ELSE count+1 END,
    lastRequest=CASE WHEN lastRequest<=? THEN excluded.lastRequest ELSE lastRequest END RETURNING count`,
    )
      .bind(crypto.randomUUID(), rateKey, nowMs, nowMs - 60000, nowMs - 60000)
      .first<{ count: number }>();
    if (!attempts || attempts.count > 5)
      return c.json({ error: 'Too many attempts' }, 429);
    const parsed = adminInvitationAcceptSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: 'Invalid invitation' }, 400);
    const tokenHash = await digest(parsed.data.token);
    const passwordHash = await hashPassword(parsed.data.password);
    const userId = crypto.randomUUID();
    const now = new Date(nowMs).toISOString();
    try {
      const result = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE admin_invitations SET accepted_at=?, accepted_user_id=?
        WHERE token_hash=? AND email=? AND accepted_at IS NULL AND expires_at>? AND ${issuerAllowed.replaceAll('b.user_id=?', 'b.user_id=admin_invitations.invited_by')}`,
        ).bind(now, userId, tokenHash, parsed.data.email, now),
        c.env.DB.prepare(
          `INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,twoFactorEnabled,status)
        SELECT ?,?,?,0,?,?,0,'ACTIVE' FROM admin_invitations WHERE token_hash=? AND accepted_user_id=?`,
        ).bind(
          userId,
          parsed.data.name,
          parsed.data.email,
          nowMs,
          nowMs,
          tokenHash,
          userId,
        ),
        c.env.DB.prepare(
          `INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt)
        SELECT ?,?,'credential',?,?,?,? FROM admin_invitations WHERE token_hash=? AND accepted_user_id=?`,
        ).bind(
          crypto.randomUUID(),
          userId,
          userId,
          passwordHash,
          nowMs,
          nowMs,
          tokenHash,
          userId,
        ),
        c.env.DB.prepare(
          `INSERT INTO global_role_assignments (id,user_id,role,created_at)
        SELECT ?,?,'LEAGUE_ADMIN',? FROM admin_invitations WHERE token_hash=? AND accepted_user_id=?`,
        ).bind(crypto.randomUUID(), userId, now, tokenHash, userId),
        c.env.DB.prepare(
          `INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json)
        SELECT ?,invited_by,'ADMIN_GRANTED','USER',?,?, '{}' FROM admin_invitations WHERE token_hash=? AND accepted_user_id=?`,
        ).bind(crypto.randomUUID(), userId, now, tokenHash, userId),
      ]);
      if (result[0]!.meta.changes !== 1)
        return c.json({ error: 'Invalid invitation' }, 400);
    } catch {
      return c.json({ error: 'Invalid invitation' }, 400);
    }
    return c.json({ created: true }, 201);
  },
);
