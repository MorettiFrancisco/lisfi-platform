import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth-schema';

// Durable audit of the one-time initial grant. No cascading FK: deleting a user
// must never reopen bootstrap or erase the original target identifier.
export const initialAdminBootstrap = sqliteTable(
  'initial_admin_bootstrap',
  {
    id: integer('id').primaryKey(),
    userId: text('user_id').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [check('initial_admin_singleton', sql`${t.id} = 1`)],
);

export const adminInvitations = sqliteTable('admin_invitations', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  email: text('email').notNull(),
  invitedBy: text('invited_by')
    .notNull()
    .references(() => user.id),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  acceptedAt: text('accepted_at'),
  acceptedUserId: text('accepted_user_id'),
});

export const representativeInvitations = sqliteTable(
  'representative_invitations',
  {
    id: text('id').primaryKey(),
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    kind: text('kind', { enum: ['PRESIDENT', 'REPRESENTATIVE'] })
      .notNull()
      .default('REPRESENTATIVE'),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id),
    invitedBy: text('invited_by')
      .notNull()
      .references(() => user.id),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    acceptedAt: text('accepted_at'),
    acceptedUserId: text('accepted_user_id'),
  },
);

export const recoveryLinks = sqliteTable('recovery_links', {
  id: text('id').primaryKey(),
  tokenHash: text('token_hash').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id),
  issuedBy: text('issued_by')
    .notNull()
    .references(() => user.id),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
  operationId: text('operation_id'),
});

export const clubs = sqliteTable(
  'clubs',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    slug: text('slug').notNull().unique(),
    status: text('status', { enum: ['ACTIVE', 'INACTIVE'] })
      .notNull()
      .default('ACTIVE'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    check('club_status_check', sql`${t.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id')
      .notNull()
      .references(() => user.id),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    createdAt: text('created_at').notNull(),
    metadataJson: text('metadata_json').notNull(),
  },
  (t) => [
    index('audit_resource_idx').on(t.resourceType, t.resourceId, t.createdAt),
    index('audit_created_idx').on(t.createdAt, t.id),
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
    role: text('role', { enum: ['CLUB_REPRESENTATIVE'] })
      .notNull()
      .default('CLUB_REPRESENTATIVE'),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [
    check('membership_role_check', sql`${t.role} = 'CLUB_REPRESENTATIVE'`),
    uniqueIndex('active_membership_unique')
      .on(t.userId, t.clubId, t.role)
      .where(sql`${t.revokedAt} IS NULL`),
    index('membership_club_idx').on(t.clubId),
  ],
);

export const clubPresidentAuthorities = sqliteTable(
  'club_president_authorities',
  {
    id: text('id').primaryKey(),
    membershipId: text('membership_id')
      .notNull()
      .references(() => clubMemberships.id),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    createdAt: text('created_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [
    uniqueIndex('active_club_president_unique')
      .on(t.clubId)
      .where(sql`${t.revokedAt} IS NULL`),
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
