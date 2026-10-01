CREATE TABLE `geocode_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`dataset` text NOT NULL,
	`address` text NOT NULL,
	`result` text NOT NULL,
	`responseRef` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`responseRef`) REFERENCES `artifacts`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `geocode_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`versionId` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`options` text NOT NULL,
	`author` text NOT NULL,
	`metadata` text NOT NULL,
	`progress` text,
	`report` text,
	`resultVersionId` text,
	`branched` integer DEFAULT false NOT NULL,
	`error` text,
	`idempotencyKey` text NOT NULL,
	`requestHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`versionId`) REFERENCES `scenario_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resultVersionId`) REFERENCES `scenario_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `geocode_jobs_idempotencyKey_unique` ON `geocode_jobs` (`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `geocode_jobs_by_date` ON `geocode_jobs` (`createdAt`);