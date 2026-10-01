CREATE TABLE `experiment_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`experimentId` text NOT NULL,
	`runId` text NOT NULL,
	`position` integer NOT NULL,
	`varied` text NOT NULL,
	FOREIGN KEY (`experimentId`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_runs_runId_unique` ON `experiment_runs` (`runId`);--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_position` ON `experiment_runs` (`experimentId`,`position`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`versionId` text NOT NULL,
	`name` text NOT NULL,
	`spec` text NOT NULL,
	`comparison` text NOT NULL,
	`idempotencyKey` text NOT NULL,
	`requestHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`versionId`) REFERENCES `scenario_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiments_idempotencyKey_unique` ON `experiments` (`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `experiments_by_date` ON `experiments` (`createdAt`);--> statement-breakpoint
CREATE TABLE `rate_events` (
	`id` text PRIMARY KEY NOT NULL,
	`bucket` text NOT NULL,
	`cost` integer NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rate_bucket_time` ON `rate_events` (`bucket`,`at`);--> statement-breakpoint
ALTER TABLE `runs` ADD `kind` text DEFAULT 'pipeline' NOT NULL;