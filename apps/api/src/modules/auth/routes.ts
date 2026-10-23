import { Hono } from 'hono';
import type { MeResponse } from '@lisfi/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { createDb } from '../../db';
import {
  clubs,
  clubMemberships,
  globalRoleAssignments,
  user,
} from '../../db/schema';
import type { Bindings } from '../../env';
import { createAuth } from './auth';

type Auth = ReturnType<typeof createAuth>;
type Identity = {
  id: string;
  name: string;
  isAdmin: boolean;
  mfaEnabled: boolean;
};
export const protectedRoutes = new Hono<{
  Bindings: Bindings;
  Variables: { identity: Identity };
}>();

protectedRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  let auth: Auth;
  try {
    auth = createAuth(c.env);
  } catch {
    return c.json({ error: 'Authentication unavailable' }, 503);
  }
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  const db = createDb(c.env.DB);
  const current = await db
    .select({
      id: user.id,
      name: user.name,
      status: user.status,
      mfaEnabled: user.twoFactorEnabled,
    })
    .from(user)
    .where(eq(user.id, session.user.id))
    .get();
  if (!current || current.status !== 'ACTIVE')
    return c.json({ error: 'Unauthorized' }, 401);
  const role = await db
    .select({ id: globalRoleAssignments.id })
    .from(globalRoleAssignments)
    .where(
      and(
        eq(globalRoleAssignments.userId, current.id),
        isNull(globalRoleAssignments.revokedAt),
      ),
    )
    .get();
  c.set('identity', {
    id: current.id,
    name: current.name,
    isAdmin: !!role,
    mfaEnabled: !!current.mfaEnabled,
  });
  await next();
});

protectedRoutes.get('/me', async (c) => {
  const identity = c.get('identity');
  const memberships = await createDb(c.env.DB)
    .select({ id: clubs.id, name: clubs.name })
    .from(clubMemberships)
    .innerJoin(clubs, eq(clubs.id, clubMemberships.clubId))
    .where(
      and(
        eq(clubMemberships.userId, identity.id),
        isNull(clubMemberships.revokedAt),
        eq(clubs.status, 'ACTIVE'),
      ),
    );
  return c.json({
    user: { id: identity.id, name: identity.name },
    roles: identity.isAdmin ? ['LEAGUE_ADMIN'] : [],
    mfaRequired: identity.isAdmin && !identity.mfaEnabled,
    clubs: memberships,
  } satisfies MeResponse);
});

// Minimal protected read to verify cross-club isolation before adding CRUD.
protectedRoutes.get('/clubs/:id', async (c) => {
  const identity = c.get('identity');
  if (identity.isAdmin && !identity.mfaEnabled)
    return c.json({ error: 'MFA required' }, 403);
  const db = createDb(c.env.DB);
  const selection = { id: clubs.id, name: clubs.name, slug: clubs.slug };
  const club = identity.isAdmin
    ? await db
        .select(selection)
        .from(clubs)
        .where(and(eq(clubs.id, c.req.param('id')), eq(clubs.status, 'ACTIVE')))
        .get()
    : await db
        .select(selection)
        .from(clubs)
        .innerJoin(clubMemberships, eq(clubMemberships.clubId, clubs.id))
        .where(
          and(
            eq(clubs.id, c.req.param('id')),
            eq(clubs.status, 'ACTIVE'),
            eq(clubMemberships.userId, identity.id),
            isNull(clubMemberships.revokedAt),
          ),
        )
        .get();
  if (!club) return c.json({ error: 'Not found' }, 404);
  return c.json(club);
});
