import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { hashPassword } from 'better-auth/crypto';
import {
  adminInvitationAcceptSchema,
  existingRepresentativeInvitationAcceptSchema,
  representativeInvitationRequestSchema,
} from '@lisfi/shared';
import type { Bindings } from '../../env';
import type { ProtectedEnv } from './routes';
import { createAuth } from './auth';
import { digest, hex } from './invitations';

const activeAdmin = (
  id: string,
) => `EXISTS (SELECT 1 FROM global_role_assignments g JOIN "user" u ON u.id=g.user_id
  WHERE g.user_id=${id} AND g.role='LEAGUE_ADMIN' AND g.revoked_at IS NULL AND u.status='ACTIVE'
  AND u."twoFactorEnabled"=1 AND EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId"=u.id AND t.verified=1))`;

const activePresident = (id: string, club: string) => `EXISTS (
  SELECT 1 FROM club_president_authorities p
  JOIN club_memberships m ON m.id=p.membership_id AND m.user_id=p.user_id AND m.club_id=p.club_id
  JOIN "user" u ON u.id=p.user_id
  WHERE p.user_id=${id} AND p.club_id=${club} AND p.revoked_at IS NULL
  AND m.revoked_at IS NULL AND u.status='ACTIVE')`;

export const representativeInvitationRoutes = new Hono<ProtectedEnv>();
representativeInvitationRoutes.post(
  '/accept-existing',
  bodyLimit({ maxSize: 8192 }),
  async (c) => {
    const actor = c.get('identity');
    if (actor.isLeagueAdmin && !actor.mfaEnabled)
      return c.json({ error: 'Forbidden' }, 403);
    if (c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin)
      return c.json({ error: 'Forbidden origin' }, 403);
    const input = existingRepresentativeInvitationAcceptSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: 'Invalid invitation' }, 400);
    const nowMs = Date.now();
    const attempts = await c.env.DB.prepare(
      `INSERT INTO "rateLimit" (id,key,count,lastRequest) VALUES (?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN lastRequest<=? THEN 1 ELSE count+1 END,
    lastRequest=CASE WHEN lastRequest<=? THEN excluded.lastRequest ELSE lastRequest END RETURNING count`,
    )
      .bind(
        crypto.randomUUID(),
        `existing-representative-invite:${actor.id}`,
        nowMs,
        nowMs - 60000,
        nowMs - 60000,
      )
      .first<{ count: number }>();
    if (!attempts || attempts.count > 5)
      return c.json({ error: 'Too many attempts' }, 429);
    const tokenHash = await digest(input.data.token);
    const operation = crypto.randomUUID();
    const changeId = crypto.randomUUID();
    const now = new Date(nowMs).toISOString();
    try {
      const result = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE representative_invitations SET accepted_at=?,accepted_user_id=?,acceptance_operation_id=?
        WHERE token_hash=? AND kind='REPRESENTATIVE' AND accepted_at IS NULL AND expires_at>?
        AND ${activePresident('representative_invitations.invited_by', 'representative_invitations.club_id')}
        AND EXISTS (SELECT 1 FROM clubs WHERE id=representative_invitations.club_id AND status='ACTIVE')
        AND EXISTS (SELECT 1 FROM "user" u WHERE u.id=? AND u.status='ACTIVE' AND lower(u.email)=lower(representative_invitations.email))
        AND NOT EXISTS (SELECT 1 FROM club_memberships m WHERE m.user_id=? AND m.club_id=representative_invitations.club_id AND m.role='CLUB_REPRESENTATIVE' AND m.revoked_at IS NULL)`,
        ).bind(now, actor.id, operation, tokenHash, now, actor.id, actor.id),
        c.env.DB.prepare(
          `INSERT INTO change_requests (id,kind,club_id,requester_id,payload_json,status,created_at)
        SELECT ?,'REPRESENTATIVE',club_id,invited_by,json_object('entityId',?,'userId',accepted_user_id,'email',email),'PENDING',?
        FROM representative_invitations WHERE token_hash=? AND acceptance_operation_id=?`,
        ).bind(changeId, crypto.randomUUID(), now, tokenHash, operation),
        c.env.DB.prepare(
          `INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json)
        SELECT ?,accepted_user_id,'REPRESENTATIVE_INVITATION_ACCEPTED','CHANGE_REQUEST',?,?,json_object('invitationId',id)
        FROM representative_invitations WHERE token_hash=? AND acceptance_operation_id=?`,
        ).bind(crypto.randomUUID(), changeId, now, tokenHash, operation),
      ]);
      if (result[0]!.meta.changes !== 1)
        return c.json({ error: 'Invalid invitation' }, 400);
    } catch {
      return c.json({ error: 'Invalid invitation' }, 400);
    }
    return c.json({ requested: true }, 201);
  },
);
representativeInvitationRoutes.post(
  '/',
  bodyLimit({ maxSize: 8192 }),
  async (c) => {
    const actor = c.get('identity');
    if (c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin)
      return c.json({ error: 'Forbidden origin' }, 403);
    const input = representativeInvitationRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: 'Invalid invitation' }, 400);
    if (
      input.data.kind === 'PRESIDENT' &&
      (!actor.isLeagueAdmin || !actor.mfaEnabled)
    )
      return c.json({ error: 'Forbidden' }, 403);
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    const id = crypto.randomUUID();
    const created = new Date();
    const now = created.toISOString();
    const expiresAt = new Date(
      created.getTime() + 60 * 60 * 1000,
    ).toISOString();
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO representative_invitations (id,token_hash,email,club_id,invited_by,created_at,expires_at,kind)
      SELECT ?,?,?,?,?,?,?,? WHERE (CASE WHEN ?='PRESIDENT' THEN ${activeAdmin('?')}
      ELSE ${activePresident('?', '?')} END) AND EXISTS (SELECT 1 FROM clubs WHERE id=? AND status='ACTIVE')`,
      ).bind(
        id,
        await digest(token),
        input.data.email,
        input.data.clubId,
        actor.id,
        now,
        expiresAt,
        input.data.kind,
        input.data.kind,
        actor.id,
        actor.id,
        input.data.clubId,
        input.data.clubId,
      ),
      c.env.DB.prepare(
        `INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json)
      SELECT ?,?,CASE kind WHEN 'PRESIDENT' THEN 'PRESIDENT_INVITED' ELSE 'REPRESENTATIVE_INVITED' END,'CLUB',club_id,?,json_object('invitationId',id) FROM representative_invitations WHERE id=?`,
      ).bind(crypto.randomUUID(), actor.id, now, id),
    ]);
    if (result[0]!.meta.changes !== 1)
      return c.json({ error: 'Club unavailable' }, 404);
    return c.json({ token, expiresAt }, 201);
  },
);

export const representativeInvitationAcceptanceRoutes = new Hono<{
  Bindings: Bindings;
}>();
representativeInvitationAcceptanceRoutes.post(
  '/representative-invitations/accept',
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
    const key = `representative-invite:${c.req.header('cf-connecting-ip') ?? 'local'}`;
    const attempts = await c.env.DB.prepare(
      `INSERT INTO "rateLimit" (id,key,count,lastRequest) VALUES (?,?,1,?)
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN lastRequest<=? THEN 1 ELSE count+1 END,
    lastRequest=CASE WHEN lastRequest<=? THEN excluded.lastRequest ELSE lastRequest END RETURNING count`,
    )
      .bind(crypto.randomUUID(), key, nowMs, nowMs - 60000, nowMs - 60000)
      .first<{ count: number }>();
    if (!attempts || attempts.count > 5)
      return c.json({ error: 'Too many attempts' }, 429);
    const input = adminInvitationAcceptSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: 'Invalid invitation' }, 400);
    const tokenHash = await digest(input.data.token);
    const password = await hashPassword(input.data.password);
    const userId = crypto.randomUUID();
    const changeId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const now = new Date(nowMs).toISOString();
    try {
      const result = await c.env.DB.batch([
        c.env.DB.prepare(
          `UPDATE representative_invitations SET accepted_at=?,accepted_user_id=?
        WHERE token_hash=? AND email=? AND accepted_at IS NULL AND expires_at>?
        AND (CASE WHEN kind='PRESIDENT' THEN ${activeAdmin('representative_invitations.invited_by')}
          ELSE ${activePresident('representative_invitations.invited_by', 'representative_invitations.club_id')} END)
        AND EXISTS (SELECT 1 FROM clubs WHERE id=representative_invitations.club_id AND status='ACTIVE')`,
        ).bind(now, userId, tokenHash, input.data.email, now),
        c.env.DB.prepare(
          `INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt,twoFactorEnabled,status)
        SELECT ?,?,?,0,?,?,0,'ACTIVE' FROM representative_invitations WHERE token_hash=? AND accepted_user_id=?`,
        ).bind(
          userId,
          input.data.name,
          input.data.email,
          nowMs,
          nowMs,
          tokenHash,
          userId,
        ),
        c.env.DB.prepare(
          `INSERT INTO account (id,accountId,providerId,userId,password,createdAt,updatedAt)
        SELECT ?,?,'credential',?,?,?,? FROM representative_invitations WHERE token_hash=? AND accepted_user_id=?`,
        ).bind(
          crypto.randomUUID(),
          userId,
          userId,
          password,
          nowMs,
          nowMs,
          tokenHash,
          userId,
        ),
        c.env.DB.prepare(
          `INSERT INTO club_officials (id,club_id,name,position,created_at)
        SELECT ?,i.club_id,u.name,'PRESIDENT',? FROM representative_invitations i
        JOIN "user" u ON u.id=i.accepted_user_id
        WHERE i.token_hash=? AND i.accepted_user_id=? AND i.kind='PRESIDENT'
        AND NOT EXISTS (SELECT 1 FROM club_officials o WHERE o.club_id=i.club_id AND o.position='PRESIDENT' AND o.ended_at IS NULL)`,
        ).bind(crypto.randomUUID(), now, tokenHash, userId),
        c.env.DB.prepare(
          `INSERT INTO club_memberships (id,user_id,club_id,role,created_at)
        SELECT ?,accepted_user_id,club_id,'CLUB_REPRESENTATIVE',? FROM representative_invitations
        WHERE token_hash=? AND accepted_user_id=? AND kind='PRESIDENT'`,
        ).bind(membershipId, now, tokenHash, userId),
        c.env.DB.prepare(
          `INSERT INTO club_president_authorities (id,membership_id,club_id,user_id,created_at)
        SELECT ?,?,club_id,accepted_user_id,? FROM representative_invitations
        WHERE token_hash=? AND accepted_user_id=? AND kind='PRESIDENT'`,
        ).bind(crypto.randomUUID(), membershipId, now, tokenHash, userId),
        c.env.DB.prepare(
          `INSERT INTO change_requests (id,kind,club_id,requester_id,payload_json,status,created_at)
        SELECT ?,'REPRESENTATIVE',club_id,invited_by,json_object('entityId',?,'userId',?,'email',email),'PENDING',?
        FROM representative_invitations WHERE token_hash=? AND accepted_user_id=? AND kind='REPRESENTATIVE'`,
        ).bind(changeId, membershipId, userId, now, tokenHash, userId),
        c.env.DB.prepare(
          `INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json)
        SELECT ?,accepted_user_id,CASE kind WHEN 'PRESIDENT' THEN 'PRESIDENT_INVITATION_ACCEPTED' ELSE 'REPRESENTATIVE_INVITATION_ACCEPTED' END,
        CASE kind WHEN 'PRESIDENT' THEN 'CLUB' ELSE 'CHANGE_REQUEST' END,CASE kind WHEN 'PRESIDENT' THEN club_id ELSE ? END,?,json_object('invitationId',id)
        FROM representative_invitations WHERE token_hash=? AND accepted_user_id=?`,
        ).bind(crypto.randomUUID(), changeId, now, tokenHash, userId),
      ]);
      if (result[0]!.meta.changes !== 1)
        return c.json({ error: 'Invalid invitation' }, 400);
    } catch {
      return c.json({ error: 'Invalid invitation' }, 400);
    }
    return c.json({ created: true }, 201);
  },
);
