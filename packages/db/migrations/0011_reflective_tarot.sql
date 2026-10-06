CREATE TABLE `route_geometry` (
	`key` text PRIMARY KEY NOT NULL,
	`runId` text NOT NULL,
	`truckId` text NOT NULL,
	`snapshotId` text NOT NULL,
	`deployment` text NOT NULL,
	`artifactHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`runId`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifactHash`) REFERENCES `artifacts`(`hash`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `route_geometry_by_run` ON `route_geometry` (`runId`);