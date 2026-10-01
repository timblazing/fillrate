CREATE TABLE `cluster_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`clusterId` text NOT NULL,
	`inputHash` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`maxAttempts` integer DEFAULT 3 NOT NULL,
	`coordinatorToken` text,
	`result` text,
	`startedAt` integer,
	`endedAt` integer,
	`error` text,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_cluster` ON `cluster_jobs` (`runId`,`clusterId`);--> statement-breakpoint
CREATE TABLE `scenario_sources` (
	`versionId` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`metadata` text NOT NULL,
	FOREIGN KEY (`versionId`) REFERENCES `scenario_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `stage_cache` (
	`inputHash` text PRIMARY KEY NOT NULL,
	`artifactHash` text NOT NULL,
	`manifest` text NOT NULL,
	`runId` text NOT NULL,
	FOREIGN KEY (`artifactHash`) REFERENCES `artifacts`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
