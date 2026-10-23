import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export * from './auth-schema';
export * from './access-schema';

// No global uniqueness for ACTIVE until LISFI defines competitive contexts.
export const seasons = sqliteTable(
  'seasons',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    year: integer('year').notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    status: text('status', { enum: ['DRAFT', 'ACTIVE', 'CLOSED'] })
      .notNull()
      .default('DRAFT'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    check(
      'seasons_status_check',
      sql`${table.status} IN ('DRAFT', 'ACTIVE', 'CLOSED')`,
    ),
    check('seasons_dates_check', sql`${table.startDate} <= ${table.endDate}`),
  ],
);
