CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`created_at` text NOT NULL,
	`metadata_json` text NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_resource_idx` ON `audit_logs` (`resource_type`,`resource_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `clubs` ADD `short_name` text;--> statement-breakpoint
ALTER TABLE `clubs` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `clubs` ADD `version` integer DEFAULT 1 NOT NULL;