CREATE TABLE `manual_baselines` (
	`id` text PRIMARY KEY NOT NULL,
	`ownerId` text NOT NULL,
	`runId` text NOT NULL,
	`clusterId` text NOT NULL,
	`name` text NOT NULL,
	`plan` text NOT NULL,
	`evaluation` text NOT NULL,
	`valid` integer NOT NULL,
	`idempotencyKey` text NOT NULL,
	`requestHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manual_baselines_idempotencyKey_unique` ON `manual_baselines` (`idempotencyKey`);--> statement-breakpoint
CREATE INDEX `baselines_by_run_owner` ON `manual_baselines` (`runId`,`ownerId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `baselines_by_owner` ON `manual_baselines` (`ownerId`);