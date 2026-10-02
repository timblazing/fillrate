CREATE TABLE `access_requests` (
	`user_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL CHECK (`status` IN ('pending','approved','denied','revoked')),
	`note` text CHECK (`note` IS NULL OR length(`note`) <= 500),
	`requested_at` integer NOT NULL,
	`decided_at` integer,
	`decided_by` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `access_requests_status_requested` ON `access_requests` (`status`,`requested_at`);--> statement-breakpoint
CREATE TABLE `admin_events` (
	`id` text PRIMARY KEY NOT NULL,
	`admin_id` text NOT NULL,
	`user_id` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `access_requests` (`user_id`,`status`,`note`,`requested_at`,`decided_at`,`decided_by`,`updated_at`)
SELECT `id`, 'approved', NULL, cast(strftime('%s','now') as integer)*1000, NULL, NULL, cast(strftime('%s','now') as integer)*1000 FROM `user`;
