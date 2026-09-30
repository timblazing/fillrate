CREATE TABLE `artifacts` (
	`hash` text PRIMARY KEY NOT NULL,
	`compressed` blob NOT NULL,
	`byteLength` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`jobId` text NOT NULL,
	`attempt` integer NOT NULL,
	`workerId` text NOT NULL,
	`startedAt` integer NOT NULL,
	`endedAt` integer,
	`reason` text,
	FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_attempt` ON `job_attempts` (`jobId`,`attempt`);--> statement-breakpoint
CREATE TABLE `job_events` (
	`id` text PRIMARY KEY NOT NULL,
	`jobId` text NOT NULL,
	`attempt` integer NOT NULL,
	`sequence` integer NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`requestHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`jobId`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_sequence` ON `job_events` (`jobId`,`attempt`,`sequence`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`maxAttempts` integer DEFAULT 3 NOT NULL,
	`workerId` text,
	`leaseToken` text,
	`leaseExpiresAt` integer,
	`heartbeatAt` integer,
	`cancelRequested` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valid_attempts" CHECK("jobs"."attempt" >= 0 AND "jobs"."maxAttempts" BETWEEN 1 AND 10)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_runId_unique` ON `jobs` (`runId`);--> statement-breakpoint
CREATE INDEX `claimable_jobs` ON `jobs` (`status`,`createdAt`);--> statement-breakpoint
CREATE TABLE `run_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`artifactHash` text NOT NULL,
	`manifest` text NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifactHash`) REFERENCES `artifacts`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `artifacts_by_run` ON `run_artifacts` (`runId`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`versionId` text NOT NULL,
	`settings` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`idempotencyKey` text NOT NULL,
	`requestHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`versionId`) REFERENCES `scenario_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `runs_idempotencyKey_unique` ON `runs` (`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `run_status_date` ON `runs` (`status`,`createdAt`);--> statement-breakpoint
CREATE TABLE `scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenario_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`scenarioId` text NOT NULL,
	`revision` integer NOT NULL,
	`schemaVersion` integer DEFAULT 1 NOT NULL,
	`parentVersionId` text,
	`document` text NOT NULL,
	`author` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`scenarioId`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parentVersionId`) REFERENCES `scenario_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scenario_revision` ON `scenario_versions` (`scenarioId`,`revision`);