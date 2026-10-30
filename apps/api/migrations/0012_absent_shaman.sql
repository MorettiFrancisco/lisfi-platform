CREATE TABLE `club_president_authorities` (
	`id` text PRIMARY KEY NOT NULL,
	`membership_id` text NOT NULL,
	`club_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`membership_id`) REFERENCES `club_memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `active_club_president_unique` ON `club_president_authorities` (`club_id`) WHERE "club_president_authorities"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE `representative_invitations` ADD `kind` text DEFAULT 'REPRESENTATIVE' NOT NULL;