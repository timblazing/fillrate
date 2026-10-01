CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `travel_snapshot_owners` (
	`snapshotId` text NOT NULL,
	`ownerId` text NOT NULL,
	`createdAt` integer NOT NULL,
	PRIMARY KEY(`snapshotId`, `ownerId`),
	FOREIGN KEY (`snapshotId`) REFERENCES `travel_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `snapshot_owner` ON `travel_snapshot_owners` (`ownerId`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_stage_cache` (
	`scope` text NOT NULL,
	`inputHash` text NOT NULL,
	`artifactHash` text NOT NULL,
	`manifest` text NOT NULL,
	`runId` text NOT NULL,
	PRIMARY KEY(`scope`, `inputHash`),
	FOREIGN KEY (`artifactHash`) REFERENCES `artifacts`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_stage_cache`("scope", "inputHash", "artifactHash", "manifest", "runId") SELECT CASE WHEN EXISTS (SELECT 1 FROM scenario_sources ss JOIN runs r ON r.versionId=ss.versionId WHERE r.id=stage_cache.runId) THEN 'operator' ELSE 'examples' END, "inputHash", "artifactHash", "manifest", "runId" FROM `stage_cache`;--> statement-breakpoint
DROP TABLE `stage_cache`;--> statement-breakpoint
ALTER TABLE `__new_stage_cache` RENAME TO `stage_cache`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `stage_cache_by_run` ON `stage_cache` (`runId`);--> statement-breakpoint
ALTER TABLE `experiments` ADD `ownerId` text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
ALTER TABLE `geocode_jobs` ADD `ownerId` text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `ownerId` text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
CREATE INDEX `runs_by_owner` ON `runs` (`ownerId`,`status`);--> statement-breakpoint
ALTER TABLE `scenarios` ADD `ownerId` text DEFAULT 'operator' NOT NULL;--> statement-breakpoint
CREATE INDEX `scenarios_by_owner` ON `scenarios` (`ownerId`);--> statement-breakpoint
UPDATE `scenarios` SET `ownerId`='examples' WHERE `id` NOT IN (SELECT v.scenarioId FROM scenario_versions v JOIN scenario_sources ss ON ss.versionId=v.id);--> statement-breakpoint
UPDATE `runs` SET `ownerId`='public' WHERE `versionId` IN (SELECT v.id FROM scenario_versions v JOIN scenarios sc ON sc.id=v.scenarioId WHERE sc.ownerId='examples');--> statement-breakpoint
UPDATE `experiments` SET `ownerId`='public' WHERE `versionId` IN (SELECT v.id FROM scenario_versions v JOIN scenarios sc ON sc.id=v.scenarioId WHERE sc.ownerId='examples');--> statement-breakpoint
INSERT INTO `travel_snapshot_owners` (`snapshotId`, `ownerId`, `createdAt`) SELECT `id`, 'operator', `createdAt` FROM `travel_snapshots`;--> statement-breakpoint
DROP TRIGGER undeletable_travel_snapshot;--> statement-breakpoint
CREATE TRIGGER undeletable_travel_snapshot BEFORE DELETE ON travel_snapshots WHEN EXISTS (SELECT 1 FROM travel_snapshot_owners WHERE snapshotId=OLD.id)
BEGIN SELECT RAISE(ABORT, 'travel snapshots with an owner cannot be deleted'); END;
