import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { clubUpdateSchema, clubsQuerySchema, type Club } from '@lisfi/shared';
import type { ProtectedEnv } from '../auth/routes';

export const clubRoutes = new Hono<ProtectedEnv>();
const columns = `c.id, c.name, c.short_name AS shortName, c.slug, c.status,
  c.created_at AS createdAt, COALESCE(c.updated_at, c.created_at) AS updatedAt, c.version`;
const membership = `c.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM club_memberships m
  WHERE m.club_id = c.id AND m.user_id = ? AND m.role = 'CLUB_REPRESENTATIVE' AND m.revoked_at IS NULL)`;

clubRoutes.use('*', async (c, next) => {
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
clubRoutes.use(
  '*',
  bodyLimit({
    maxSize: 8192,
    onError: (c) => c.json({ error: 'Request too large' }, 413),
  }),
);

clubRoutes.get('/', async (c) => {
  const query = clubsQuerySchema.safeParse(c.req.query());
  if (!query.success) return c.json({ error: 'Invalid query' }, 400);
  const { page, pageSize, q, status, sort } = query.data;
  const identity = c.get('identity');
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (!identity.isLeagueAdmin) {
    conditions.push(membership);
    values.push(identity.id);
  }
  if (status !== 'ALL') {
    conditions.push('c.status = ?');
    values.push(status);
  }
  if (q) {
    conditions.push(
      "(c.name LIKE ? ESCAPE '\\' OR c.slug LIKE ? ESCAPE '\\' OR c.short_name LIKE ? ESCAPE '\\')",
    );
    const term = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    values.push(term, term, term);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const order = {
    name_asc: 'c.name COLLATE NOCASE ASC',
    name_desc: 'c.name COLLATE NOCASE DESC',
    newest: 'c.created_at DESC',
  }[sort];
  const [count, rows] = await c.env.DB.batch<Record<string, unknown>>([
    c.env.DB.prepare(`SELECT count(*) AS total FROM clubs c ${where}`).bind(
      ...values,
    ),
    c.env.DB.prepare(
      `SELECT ${columns} FROM clubs c ${where} ORDER BY ${order}, c.id ASC LIMIT ? OFFSET ?`,
    ).bind(...values, pageSize, (page - 1) * pageSize),
  ]);
  return c.json({
    items: rows!.results,
    total: Number(count!.results[0]!.total),
    page,
    pageSize,
  });
});

clubRoutes.get('/:id', async (c) => {
  const identity = c.get('identity');
  const club = await c.env.DB.prepare(
    `SELECT ${columns} FROM clubs c WHERE c.id = ? ${identity.isLeagueAdmin ? '' : `AND ${membership}`}`,
  )
    .bind(c.req.param('id'), ...(identity.isLeagueAdmin ? [] : [identity.id]))
    .first<Club>();
  if (!club) return c.json({ error: 'Not found' }, 404);
  // Only fetch the directory after checking this specific club's live access.
  const [officials, representatives, players] = await c.env.DB.batch<{
    id: string;
    name: string;
    position?: string;
  }>([
    c.env.DB.prepare(
      `SELECT id, name, position FROM club_officials WHERE club_id = ? AND ended_at IS NULL ORDER BY name, id`,
    ).bind(club.id),
    c.env.DB.prepare(
      `SELECT u.id, u.name FROM club_memberships m JOIN "user" u ON u.id = m.user_id
      WHERE m.club_id = ? AND m.role = 'CLUB_REPRESENTATIVE' AND m.revoked_at IS NULL AND u.status = 'ACTIVE' ORDER BY u.name, u.id`,
    ).bind(club.id),
    c.env.DB.prepare(
      `SELECT p.id, p.first_name || ' ' || p.last_name AS name FROM club_players cp JOIN players p ON p.id = cp.player_id
      WHERE cp.club_id = ? AND cp.ended_at IS NULL ORDER BY p.last_name, p.first_name, p.id`,
    ).bind(club.id),
  ]);
  const president = officials!.results.find(
    (person) => person.position === 'PRESIDENT',
  );
  return c.json({
    ...club,
    president: president ? { id: president.id, name: president.name } : null,
    representatives: representatives!.results,
    technicalDirectors: officials!.results
      .filter((person) => person.position === 'TECHNICAL_DIRECTOR')
      .map(({ id, name }) => ({ id, name })),
    players: players!.results,
  });
});

clubRoutes.post('/', async (c) => {
  return c.json({ error: 'Club creation requires approval' }, 403);
});

clubRoutes.patch('/:id', async (c) => {
  const parsed = clubUpdateSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) return c.json({ error: 'Invalid club details' }, 400);
  const old = await c.env.DB.prepare(
    `SELECT ${columns} FROM clubs c WHERE c.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<Club>();
  if (!old) return c.json({ error: 'Not found' }, 404);
  if (old.version !== parsed.data.version)
    return c.json({ error: 'Club was modified' }, 409);
  const next: Club = {
    ...old,
    name: parsed.data.name ?? old.name,
    slug: parsed.data.slug ?? old.slug,
    shortName:
      parsed.data.shortName === undefined
        ? old.shortName
        : parsed.data.shortName,
    status: parsed.data.status ?? old.status,
    updatedAt: new Date().toISOString(),
    version: old.version + 1,
  };
  next.shortName ||= null;
  const action =
    next.status !== old.status
      ? next.status === 'ACTIVE'
        ? 'CLUB_REACTIVATED'
        : 'CLUB_DEACTIVATED'
      : 'CLUB_UPDATED';
  try {
    // Both statements share the version guard in one transaction. A stale writer
    // changes neither the audit history nor the club; a failing write rolls back both.
    const result = await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO audit_logs (id, actor_user_id, action, resource_type, resource_id, created_at, metadata_json)
        SELECT ?, ?, ?, 'CLUB', id, ?, ? FROM clubs WHERE id = ? AND version = ?`,
      ).bind(
        crypto.randomUUID(),
        c.get('identity').id,
        action,
        next.updatedAt,
        JSON.stringify({ before: old, after: next }),
        old.id,
        old.version,
      ),
      c.env.DB.prepare(
        `UPDATE clubs SET name = ?, short_name = ?, slug = ?, status = ?, updated_at = ?, version = version + 1 WHERE id = ? AND version = ?`,
      ).bind(
        next.name,
        next.shortName,
        next.slug,
        next.status,
        next.updatedAt,
        old.id,
        old.version,
      ),
    ]);
    if (result[1]!.meta.changes !== 1)
      return c.json({ error: 'Club was modified' }, 409);
  } catch (error) {
    if (
      await c.env.DB.prepare('SELECT 1 FROM clubs WHERE slug = ? AND id <> ?')
        .bind(next.slug, old.id)
        .first()
    )
      return c.json({ error: 'Slug already exists' }, 409);
    throw error;
  }
  return c.json(next);
});
