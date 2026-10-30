import { Hono } from 'hono';
import type { ProtectedEnv } from './routes';

export const administratorRoutes = new Hono<ProtectedEnv>();
const owner = `EXISTS (SELECT 1 FROM initial_admin_bootstrap b
  JOIN global_role_assignments g ON g.user_id=b.user_id AND g.role='LEAGUE_ADMIN' AND g.revoked_at IS NULL
  JOIN "user" u ON u.id=b.user_id AND u.status='ACTIVE' AND u."twoFactorEnabled"=1
  WHERE b.user_id=? AND EXISTS (SELECT 1 FROM "twoFactor" t WHERE t."userId"=u.id AND t.verified=1))`;

administratorRoutes.use('*', async (c, next) => {
  const actor = c.get('identity');
  if (
    !actor.isLeagueAdmin ||
    !actor.mfaEnabled ||
    !(await c.env.DB.prepare(`SELECT 1 WHERE ${owner}`).bind(actor.id).first())
  )
    return c.json({ error: 'Forbidden' }, 403);
  if (
    c.req.method !== 'GET' &&
    c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin
  )
    return c.json({ error: 'Forbidden origin' }, 403);
  await next();
});
administratorRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT u.id,u.name FROM "user" u JOIN global_role_assignments g ON g.user_id=u.id
    WHERE g.role='LEAGUE_ADMIN' AND g.revoked_at IS NULL AND u.status='ACTIVE' ORDER BY u.name,u.id`,
  ).all();
  return c.json({ items: rows.results });
});
administratorRoutes.delete('/:id', async (c) => {
  const actor = c.get('identity');
  const target = c.req.param('id');
  if (actor.id === target) return c.json({ error: 'Forbidden' }, 403);
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json)
      SELECT ?,?,'ADMIN_REVOKED','USER',user_id,?,'{}' FROM global_role_assignments
      WHERE user_id=? AND role='LEAGUE_ADMIN' AND revoked_at IS NULL AND ${owner}
      AND NOT EXISTS (SELECT 1 FROM initial_admin_bootstrap b WHERE b.user_id=global_role_assignments.user_id)`,
    ).bind(auditId, actor.id, now, target, actor.id),
    c.env.DB.prepare(
      `UPDATE global_role_assignments SET revoked_at=? WHERE user_id=? AND role='LEAGUE_ADMIN'
      AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM audit_logs WHERE id=?)`,
    ).bind(now, target, auditId),
  ]);
  if (result[1]!.meta.changes !== 1)
    return c.json({ error: 'Administrator unavailable' }, 404);
  return c.json({ revoked: true });
});
