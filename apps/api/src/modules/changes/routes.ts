import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { changeInputSchema } from '@lisfi/shared';
import type { ProtectedEnv } from '../auth/routes';

export const changeRoutes = new Hono<ProtectedEnv>();
changeRoutes.use(
  '*',
  bodyLimit({
    maxSize: 8192,
    onError: (c) => c.json({ error: 'Request too large' }, 413),
  }),
);
changeRoutes.use('*', async (c, next) => {
  const identity = c.get('identity');
  if (identity.isLeagueAdmin && !identity.mfaEnabled)
    return c.json({ error: 'MFA required' }, 403);
  if (
    c.req.method !== 'GET' &&
    c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin
  )
    return c.json({ error: 'Forbidden origin' }, 403);
  await next();
});

changeRoutes.get('/', async (c) => {
  const identity = c.get('identity');
  const where = identity.isLeagueAdmin
    ? '1=1'
    : `r.club_id IN (SELECT m.club_id FROM club_memberships m JOIN clubs c ON c.id=m.club_id AND c.status='ACTIVE' WHERE m.user_id=? AND m.role='CLUB_REPRESENTATIVE' AND m.revoked_at IS NULL)`;
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.kind, r.club_id AS clubId, r.status, r.created_at AS createdAt, r.payload_json AS payloadJson, c.name AS clubName, u.name AS requesterName,
   (SELECT count(*) FROM change_approvals a JOIN "user" au ON au.id=a.admin_id AND au.status='ACTIVE' AND au."twoFactorEnabled"=1 WHERE a.request_id=r.id AND EXISTS (SELECT 1 FROM global_role_assignments g WHERE g.user_id=a.admin_id AND g.role='LEAGUE_ADMIN' AND g.revoked_at IS NULL) AND EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId"=a.admin_id AND t.verified=1)) AS approvals,
   EXISTS (SELECT 1 FROM change_approvals a WHERE a.request_id=r.id AND a.admin_id=?) AS approvedByMe
   FROM change_requests r LEFT JOIN clubs c ON c.id=r.club_id JOIN "user" u ON u.id=r.requester_id WHERE ${where} ORDER BY r.created_at DESC LIMIT 100`,
  )
    .bind(identity.id, ...(identity.isLeagueAdmin ? [] : [identity.id]))
    .all();
  return c.json({
    items: rows.results.map((row) => ({
      ...row,
      payload: (() => {
        const payload = JSON.parse(String(row.payloadJson)) as Record<
          string,
          unknown
        >;
        if (!identity.isLeagueAdmin && row.kind === 'REPRESENTATIVE') {
          delete payload.email;
          delete payload.name;
          delete payload.userId;
        }
        return payload;
      })(),
      payloadJson: undefined,
    })),
  });
});

changeRoutes.post('/', async (c) => {
  const parsed = changeInputSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: 'Invalid request' }, 400);
  const input = parsed.data;
  const identity = c.get('identity');
  if (input.kind === 'CLUB' && !identity.isLeagueAdmin)
    return c.json({ error: 'Forbidden' }, 403);
  const clubId = input.kind === 'CLUB' ? null : input.clubId;
  if (clubId) {
    const allowed = await c.env.DB.prepare(
      `SELECT 1 FROM clubs c WHERE c.id=? AND c.status='ACTIVE' AND (?=1 OR EXISTS (SELECT 1 FROM club_memberships m WHERE m.club_id=c.id AND m.user_id=? AND m.role='CLUB_REPRESENTATIVE' AND m.revoked_at IS NULL))`,
    )
      .bind(clubId, identity.isLeagueAdmin ? 1 : 0, identity.id)
      .first();
    if (!allowed) return c.json({ error: 'Not found' }, 404);
  }
  let payload: Record<string, unknown> = { entityId: crypto.randomUUID() };
  if (input.kind === 'CLUB') {
    if (
      await c.env.DB.prepare('SELECT 1 FROM clubs WHERE slug=?')
        .bind(input.details.slug)
        .first()
    )
      return c.json({ error: 'Slug already exists' }, 409);
    payload = {
      ...payload,
      ...input.details,
      shortName: input.details.shortName || null,
    };
  } else if (input.kind === 'PRESIDENT') {
    const previous = await c.env.DB.prepare(
      "SELECT id, name FROM club_officials WHERE club_id=? AND position='PRESIDENT' AND ended_at IS NULL",
    )
      .bind(clubId)
      .first<{ id: string; name: string }>();
    payload = {
      ...payload,
      name: input.name,
      previousPresidentId: previous?.id ?? null,
      previousPresidentName: previous?.name ?? null,
    };
  } else if (input.kind === 'REPRESENTATIVE') {
    // Resolve the account only when the second administrator approves. This
    // keeps request responses independent of whether an account exists.
    payload = { ...payload, email: input.email };
  } else if (input.kind === 'PLAYER')
    payload = {
      ...payload,
      firstName: input.firstName,
      lastName: input.lastName,
      linkId: crypto.randomUUID(),
    };
  else payload = { ...payload, name: input.name };
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO change_requests (id, kind, club_id, requester_id, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'PENDING', ?)",
    ).bind(id, input.kind, clubId, identity.id, JSON.stringify(payload), now),
    c.env.DB.prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json) VALUES (?, ?, 'CHANGE_REQUESTED', 'CHANGE_REQUEST', ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      identity.id,
      id,
      now,
      JSON.stringify({ kind: input.kind, clubId }),
    ),
  ]);
  return c.json({ id, status: 'PENDING' }, 201);
});

changeRoutes.post('/:id/approve', async (c) => {
  const identity = c.get('identity');
  if (!identity.isLeagueAdmin || !identity.mfaEnabled)
    return c.json({ error: 'Forbidden' }, 403);
  const now = new Date().toISOString();
  const approvalId = crypto.randomUUID();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO change_approvals (id, request_id, admin_id, created_at)
        SELECT ?, id, ?, ? FROM change_requests WHERE id=? AND status='PENDING' AND EXISTS (SELECT 1 FROM global_role_assignments g JOIN "user" u ON u.id=g.user_id WHERE g.user_id=? AND g.role='LEAGUE_ADMIN' AND g.revoked_at IS NULL AND u.status='ACTIVE' AND u."twoFactorEnabled"=1) AND EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId"=? AND t.verified=1)`,
      ).bind(
        approvalId,
        identity.id,
        now,
        c.req.param('id'),
        identity.id,
        identity.id,
      ),
      c.env.DB.prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json) SELECT ?, ?, 'CHANGE_APPROVED', 'CHANGE_REQUEST', request_id, ?, '{}' FROM change_approvals WHERE id=?",
      ).bind(crypto.randomUUID(), identity.id, now, approvalId),
    ]);
    if (
      !(await c.env.DB.prepare('SELECT 1 FROM change_approvals WHERE id=?')
        .bind(approvalId)
        .first())
    )
      return c.json({ error: 'Request unavailable' }, 409);
  } catch {
    return c.json({ error: 'Approval conflict' }, 409);
  }
  const result = await c.env.DB.prepare(
    'SELECT status FROM change_requests WHERE id=?',
  )
    .bind(c.req.param('id'))
    .first();
  return c.json(result);
});

changeRoutes.post('/:id/reject', async (c) => {
  const identity = c.get('identity');
  if (!identity.isLeagueAdmin || !identity.mfaEnabled)
    return c.json({ error: 'Forbidden' }, 403);
  const id = c.req.param('id');
  const now = new Date().toISOString();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json) SELECT ?, ?, 'CHANGE_REJECTED', 'CHANGE_REQUEST', id, ?, '{}' FROM change_requests WHERE id=? AND status='PENDING'",
    ).bind(crypto.randomUUID(), identity.id, now, id),
    c.env.DB.prepare(
      "UPDATE change_requests SET status='REJECTED', resolved_at=? WHERE id=? AND status='PENDING'",
    ).bind(now, id),
  ]);
  if (result[1]!.meta.changes !== 1)
    return c.json({ error: 'Request unavailable' }, 409);
  return c.json({ status: 'REJECTED' });
});
