import { Hono } from 'hono';
import { auditQuerySchema } from '@lisfi/shared';
import type { ProtectedEnv } from '../auth/routes';

export const auditRoutes = new Hono<ProtectedEnv>();
function safeChanges(action: unknown, raw: unknown) {
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!metadata || typeof metadata !== 'object') return [];
  if (action === 'SEASON_ACTIVATED' || action === 'SEASON_CLOSED') {
    const valid = ['DRAFT', 'ACTIVE', 'CLOSED'];
    return typeof metadata.from === 'string' &&
      valid.includes(metadata.from) &&
      typeof metadata.to === 'string' &&
      valid.includes(metadata.to)
      ? [{ field: 'status', before: metadata.from, after: metadata.to }]
      : [];
  }
  if (
    action !== 'CLUB_UPDATED' &&
    action !== 'CLUB_DEACTIVATED' &&
    action !== 'CLUB_REACTIVATED'
  )
    return [];
  const before = metadata.before as Record<string, unknown> | null;
  const after = metadata.after as Record<string, unknown> | null;
  if (
    !before ||
    !after ||
    typeof before !== 'object' ||
    typeof after !== 'object'
  )
    return [];
  const result: {
    field: string;
    before: string | null;
    after: string | null;
  }[] = [];
  for (const field of ['name', 'shortName', 'slug', 'status']) {
    const old = before[field],
      next = after[field];
    if (
      (old === null || typeof old === 'string') &&
      (next === null || typeof next === 'string') &&
      old !== next
    )
      result.push({
        field,
        before: typeof old === 'string' ? old.slice(0, 120) : null,
        after: typeof next === 'string' ? next.slice(0, 120) : null,
      });
  }
  return result;
}
auditRoutes.use('*', async (c, next) => {
  const identity = c.get('identity');
  if (!identity.isLeagueAdmin || !identity.mfaEnabled)
    return c.json({ error: 'Forbidden' }, 403);
  await next();
});
auditRoutes.get('/', async (c) => {
  const parsed = auditQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid query' }, 400);
  const { page, pageSize, resourceType, from, to } = parsed.data;
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (resourceType !== 'ALL') {
    conditions.push('a.resource_type = ?');
    params.push(resourceType);
  }
  if (from) {
    conditions.push('a.created_at >= ?');
    params.push(`${from}T00:00:00.000Z`);
  }
  if (to) {
    conditions.push('a.created_at < ?');
    const end = new Date(`${to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    params.push(end.toISOString());
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [count, rows] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(
      `SELECT count(*) AS total FROM audit_logs a ${where}`,
    ).bind(...params),
    c.env.DB.prepare(
      `SELECT a.id, u.name AS actorName, a.action, a.resource_type AS resourceType, a.resource_id AS resourceId, a.created_at AS createdAt,
      CASE a.resource_type WHEN 'CLUB' THEN c.name WHEN 'SEASON' THEN s.name WHEN 'CHANGE_REQUEST' THEN COALESCE(rc.name, CASE WHEN r.kind='CLUB' AND json_valid(r.payload_json) THEN json_extract(r.payload_json, '$.name') END) ELSE NULL END AS resourceName,
      r.kind AS requestKind, a.metadata_json AS metadataJson
      FROM audit_logs a JOIN "user" u ON u.id = a.actor_user_id
      LEFT JOIN clubs c ON a.resource_type = 'CLUB' AND c.id = a.resource_id
      LEFT JOIN seasons s ON a.resource_type = 'SEASON' AND s.id = a.resource_id
      LEFT JOIN change_requests r ON a.resource_type = 'CHANGE_REQUEST' AND r.id = a.resource_id
      LEFT JOIN clubs rc ON rc.id = r.club_id
      ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    ).bind(...params, pageSize, (page - 1) * pageSize),
  ]);
  return c.json({
    items: rows!.results.map(({ metadataJson, ...row }) => ({
      ...row,
      changes: safeChanges(row.action, metadataJson),
    })),
    total: Number(count!.results[0]!.total),
    page,
    pageSize,
  });
});
