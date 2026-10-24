CREATE TABLE `initial_admin_bootstrap` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "initial_admin_singleton" CHECK("initial_admin_bootstrap"."id" = 1)
);
