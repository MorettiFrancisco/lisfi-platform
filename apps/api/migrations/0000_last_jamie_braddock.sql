CREATE TABLE `seasons` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`year` integer NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "seasons_status_check" CHECK("seasons"."status" IN ('DRAFT', 'ACTIVE', 'CLOSED')),
	CONSTRAINT "seasons_dates_check" CHECK("seasons"."start_date" <= "seasons"."end_date")
);
