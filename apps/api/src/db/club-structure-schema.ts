import { sql } from 'drizzle-orm';
import {
  check,
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { clubs } from './access-schema';

// Institutional positions are independent from authentication memberships.
// Representatives obtain access through clubMemberships (CLUB_REPRESENTATIVE).
export const clubOfficials = sqliteTable(
  'club_officials',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id),
    name: text('name').notNull(),
    position: text('position', {
      enum: ['PRESIDENT', 'TECHNICAL_DIRECTOR'],
    }).notNull(),
    createdAt: text('created_at').notNull(),
    endedAt: text('ended_at'),
  },
  (t) => [
    check(
      'club_official_position_check',
      sql`${t.position} IN ('PRESIDENT', 'TECHNICAL_DIRECTOR')`,
    ),
    uniqueIndex('one_current_president_per_club')
      .on(t.clubId)
      .where(sql`${t.position} = 'PRESIDENT' AND ${t.endedAt} IS NULL`),
    index('club_official_club_idx').on(t.clubId),
  ],
);

// Player identity survives club changes. No login, DNI, health data or documents.
export const players = sqliteTable('players', {
  id: text('id').primaryKey(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  createdAt: text('created_at').notNull(),
});

// A directory link is not a registration, eligibility approval or guardian consent.
export const clubPlayers = sqliteTable(
  'club_players',
  {
    id: text('id').primaryKey(),
    clubId: text('club_id')
      .notNull()
      .references(() => clubs.id),
    playerId: text('player_id')
      .notNull()
      .references(() => players.id),
    createdAt: text('created_at').notNull(),
    endedAt: text('ended_at'),
  },
  (t) => [
    uniqueIndex('active_club_player_unique')
      .on(t.clubId, t.playerId)
      .where(sql`${t.endedAt} IS NULL`),
    index('club_player_player_idx').on(t.playerId),
  ],
);
