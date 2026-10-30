import { Hono } from 'hono';
import type { MeResponse } from '@lisfi/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { createDb } from '../../db';
import {
  clubs,
  clubMemberships,
  globalRoleAssignments,
  user,
  twoFactor,
  initialAdminBootstrap,
} from '../../db/schema';
import type { Bindings } from '../../env';
import { createAuth } from './auth';
import { clubRoutes } from '../clubs/routes';
import { changeRoutes } from '../changes/routes';
import { seasonRoutes } from '../seasons/routes';
import { auditRoutes } from '../audit/routes';
import { adminInvitationRoutes } from './invitations';
import { representativeInvitationRoutes } from './representative-invitations';
import { recoveryRoutes } from './recovery';
import { administratorRoutes } from './administrators';

type Auth = ReturnType<typeof createAuth>;
type Identity = {
  id: string;
  name: string;
  isLeagueAdmin: boolean;
  mfaEnabled: boolean;
};
export type ProtectedEnv = {
  Bindings: Bindings;
  Variables: { identity: Identity };
};
export const protectedRoutes = new Hono<ProtectedEnv>();

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
  const verifiedFactor = current.mfaEnabled
    ? await db
        .select({ id: twoFactor.id })
        .from(twoFactor)
        .where(
          and(eq(twoFactor.userId, current.id), eq(twoFactor.verified, true)),
        )
        .get()
    : undefined;
  c.set('identity', {
    id: current.id,
    name: current.name,
    isLeagueAdmin: !!role,
    mfaEnabled: !!verifiedFactor,
  });
  await next();
});

protectedRoutes.get('/me', async (c) => {
  const identity = c.get('identity');
  const memberships =
    identity.isLeagueAdmin && !identity.mfaEnabled
      ? []
      : await createDb(c.env.DB)
          .select({ id: clubs.id, name: clubs.name })
          .from(clubMemberships)
          .innerJoin(clubs, eq(clubs.id, clubMemberships.clubId))
          .where(
            and(
              eq(clubMemberships.userId, identity.id),
              eq(clubMemberships.role, 'CLUB_REPRESENTATIVE'),
              isNull(clubMemberships.revokedAt),
              eq(clubs.status, 'ACTIVE'),
            ),
          );
  const canManageAdmins =
    identity.isLeagueAdmin &&
    identity.mfaEnabled &&
    !!(await createDb(c.env.DB)
      .select({ id: initialAdminBootstrap.id })
      .from(initialAdminBootstrap)
      .where(eq(initialAdminBootstrap.userId, identity.id))
      .get());
  const presidentRows = await c.env.DB.prepare(
    `SELECT p.club_id FROM club_president_authorities p
    JOIN club_memberships m ON m.id=p.membership_id AND m.user_id=p.user_id AND m.club_id=p.club_id
    JOIN clubs c ON c.id=p.club_id
    WHERE p.user_id=? AND p.revoked_at IS NULL AND m.revoked_at IS NULL AND c.status='ACTIVE'`,
  )
    .bind(identity.id)
    .all<{ club_id: string }>();
  return c.json({
    user: { id: identity.id, name: identity.name },
    roles: identity.isLeagueAdmin ? ['LEAGUE_ADMIN'] : [],
    mfaRequired: identity.isLeagueAdmin && !identity.mfaEnabled,
    canManageAdmins,
    presidentClubIds: presidentRows.results.map((row) => row.club_id),
    clubs: memberships,
  } satisfies MeResponse);
});

protectedRoutes.route('/clubs', clubRoutes);
protectedRoutes.route('/changes', changeRoutes);
protectedRoutes.route('/seasons', seasonRoutes);
protectedRoutes.route('/audit-logs', auditRoutes);
protectedRoutes.route('/admin-invitations', adminInvitationRoutes);
protectedRoutes.route('/recovery-links', recoveryRoutes);
protectedRoutes.route('/administrators', administratorRoutes);
protectedRoutes.route(
  '/representative-invitations',
  representativeInvitationRoutes,
);
