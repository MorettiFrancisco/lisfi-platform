import { sql } from 'drizzle-orm';
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { user } from './auth-schema';
import { clubs } from './access-schema';

export const changeRequests = sqliteTable(
  'change_requests',
  {
    id: text('id').primaryKey(),
    kind: text('kind', {
      enum: [
        'CLUB',
        'PRESIDENT',
        'REPRESENTATIVE',
        'TECHNICAL_DIRECTOR',
        'PLAYER',
      ],
    }).notNull(),
    clubId: text('club_id').references(() => clubs.id),
    requesterId: text('requester_id')
      .notNull()
      .references(() => user.id),
    payloadJson: text('payload_json').notNull(),
    status: text('status', { enum: ['PENDING', 'APPLIED', 'REJECTED'] })
      .notNull()
      .default('PENDING'),
    createdAt: text('created_at').notNull(),
    resolvedAt: text('resolved_at'),
  },
  (t) => [
    check(
      'change_kind_check',
      sql`${t.kind} IN ('CLUB', 'PRESIDENT', 'REPRESENTATIVE', 'TECHNICAL_DIRECTOR', 'PLAYER')`,
    ),
    check(
      'change_status_check',
      sql`${t.status} IN ('PENDING', 'APPLIED', 'REJECTED')`,
    ),
    index('change_status_idx').on(t.status, t.createdAt),
  ],
);

export const changeApprovals = sqliteTable(
  'change_approvals',
  {
    id: text('id').primaryKey(),
    requestId: text('request_id')
      .notNull()
      .references(() => changeRequests.id),
    adminId: text('admin_id')
      .notNull()
      .references(() => user.id),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('one_approval_per_admin').on(t.requestId, t.adminId)],
);
