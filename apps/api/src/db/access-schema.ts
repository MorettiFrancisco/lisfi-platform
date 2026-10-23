import { sql } from 'drizzle-orm';
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth-schema';

export const clubs = sqliteTable(
  'clubs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    status: text('status', { enum: ['ACTIVE', 'INACTIVE'] })
      .notNull()
      .default('ACTIVE'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    check('club_status_check', sql`${t.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const clubMemberships = sqliteTable(
  'club_memberships',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id),
    role: text('role', { enum: ['CLUB_DELEGATE'] })
      .notNull()
      .default('CLUB_DELEGATE'),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [
    check('membership_role_check', sql`${t.role} = 'CLUB_DELEGATE'`),
    uniqueIndex('active_membership_unique')
      .on(t.userId, t.clubId, t.role)
      .where(sql`${t.revokedAt} IS NULL`),
    index('membership_club_idx').on(t.clubId),
  ],
);

export const globalRoleAssignments = sqliteTable(
  'global_role_assignments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    role: text('role', { enum: ['LEAGUE_ADMIN'] }).notNull(),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [
    check('global_role_check', sql`${t.role} = 'LEAGUE_ADMIN'`),
    uniqueIndex('active_global_role_unique')
      .on(t.userId, t.role)
      .where(sql`${t.revokedAt} IS NULL`),
  ],
);
