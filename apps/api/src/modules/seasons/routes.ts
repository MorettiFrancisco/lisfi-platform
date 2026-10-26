import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  seasonInputSchema,
  seasonQuerySchema,
  seasonTransitionSchema,
  type Season,
} from '@lisfi/shared';
import type { ProtectedEnv } from '../auth/routes';

export const seasonRoutes = new Hono<ProtectedEnv>();
seasonRoutes.use('*', async (c, next) => {
  const identity = c.get('identity');
  if (identity.isLeagueAdmin && !identity.mfaEnabled)
    return c.json({ error: 'MFA required' }, 403);
  if (c.req.method !== 'GET') {
    if (!identity.isLeagueAdmin) return c.json({ error: 'Forbidden' }, 403);
    if (c.req.header('origin') !== new URL(c.env.AUTH_BASE_URL!).origin)
      return c.json({ error: 'Forbidden origin' }, 403);
  }
  await next();
});
seasonRoutes.use(
  '*',
  bodyLimit({
    maxSize: 8192,
    onError: (c) => c.json({ error: 'Request too large' }, 413),
  }),
);
seasonRoutes.get('/', async (c) => {
  const parsed = seasonQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid query' }, 400);
  const { page, pageSize, status } = parsed.data;
  const where = status === 'ALL' ? '' : 'WHERE status = ?';
  const values = status === 'ALL' ? [] : [status];
  const [count, rows] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT count(*) AS total FROM seasons ${where}`).bind(
      ...values,
    ),
    c.env.DB.prepare(
      `SELECT id, name, year, start_date AS startDate, end_date AS endDate, status, created_at AS createdAt FROM seasons ${where} ORDER BY year DESC, start_date DESC, id ASC LIMIT ? OFFSET ?`,
    ).bind(...values, pageSize, (page - 1) * pageSize),
  ]);
  return c.json({
    items: rows!.results,
    total: Number(count!.results[0]!.total),
    page,
    pageSize,
  });
});
seasonRoutes.post('/', async (c) => {
  const parsed = seasonInputSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: 'Invalid season' }, 400);
  const now = new Date().toISOString();
  const season: Season = {
    ...parsed.data,
    id: crypto.randomUUID(),
    status: 'DRAFT',
    createdAt: now,
  };
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO seasons (id, name, year, start_date, end_date, status, created_at) VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)",
    ).bind(
      season.id,
      season.name,
      season.year,
      season.startDate,
      season.endDate,
      now,
    ),
    c.env.DB.prepare(
      "INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json) VALUES (?, ?, 'SEASON_CREATED', 'SEASON', ?, ?, ?)",
    ).bind(
      crypto.randomUUID(),
      c.get('identity').id,
      season.id,
      now,
      JSON.stringify({ after: season }),
    ),
  ]);
  return c.json(season, 201);
});
seasonRoutes.patch('/:id/status', async (c) => {
  const parsed = seasonTransitionSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: 'Invalid transition' }, 400);
  const id = c.req.param('id');
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  const action =
    parsed.data.to === 'ACTIVE' ? 'SEASON_ACTIVATED' : 'SEASON_CLOSED';
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO audit_logs (id,actor_user_id,action,resource_type,resource_id,created_at,metadata_json) SELECT ?, ?, ?, 'SEASON', id, ?, ? FROM seasons WHERE id=? AND status=?",
    ).bind(
      auditId,
      c.get('identity').id,
      action,
      now,
      JSON.stringify(parsed.data),
      id,
      parsed.data.from,
    ),
    c.env.DB.prepare(
      'UPDATE seasons SET status=? WHERE id=? AND status=?',
    ).bind(parsed.data.to, id, parsed.data.from),
  ]);
  const didApply = await c.env.DB.prepare('SELECT 1 FROM audit_logs WHERE id=?')
    .bind(auditId)
    .first();
  if (!didApply) return c.json({ error: 'Season changed or unavailable' }, 409);
  return c.json({ id, status: parsed.data.to });
});
