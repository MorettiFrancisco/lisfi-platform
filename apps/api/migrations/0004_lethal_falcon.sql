CREATE TABLE `club_officials` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`name` text NOT NULL,
	`position` text NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "club_official_position_check" CHECK("club_officials"."position" IN ('PRESIDENT', 'TECHNICAL_DIRECTOR'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_current_president_per_club` ON `club_officials` (`club_id`) WHERE "club_officials"."position" = 'PRESIDENT' AND "club_officials"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX `club_official_club_idx` ON `club_officials` (`club_id`);--> statement-breakpoint
CREATE TABLE `club_players` (
	`id` text PRIMARY KEY NOT NULL,
	`club_id` text NOT NULL,
	`player_id` text NOT NULL,
	`created_at` text NOT NULL,
	`ended_at` text,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`player_id`) REFERENCES `players`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `active_club_player_unique` ON `club_players` (`club_id`,`player_id`) WHERE "club_players"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX `club_player_player_idx` ON `club_players` (`player_id`);--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `__new_club_memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`club_id` text NOT NULL,
	`role` text DEFAULT 'CLUB_REPRESENTATIVE' NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "membership_role_check" CHECK("__new_club_memberships"."role" = 'CLUB_REPRESENTATIVE')
);
--> statement-breakpoint
-- Rename the existing role while preserving IDs, clubs, users and revocation history.
INSERT INTO `__new_club_memberships`("id", "user_id", "club_id", "role", "created_at", "revoked_at") SELECT "id", "user_id", "club_id", CASE WHEN "role" = 'CLUB_DELEGATE' THEN 'CLUB_REPRESENTATIVE' ELSE "role" END, "created_at", "revoked_at" FROM `club_memberships`;--> statement-breakpoint
DROP TABLE `club_memberships`;--> statement-breakpoint
ALTER TABLE `__new_club_memberships` RENAME TO `club_memberships`;--> statement-breakpoint
CREATE UNIQUE INDEX `active_membership_unique` ON `club_memberships` (`user_id`,`club_id`,`role`) WHERE "club_memberships"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX `membership_club_idx` ON `club_memberships` (`club_id`);
