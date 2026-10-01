CREATE TABLE `scenario_saves` (
	`idempotencyKey` text PRIMARY KEY NOT NULL,
	`requestHash` text NOT NULL,
	`scenarioId` text NOT NULL,
	`versionId` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`scenarioId`) REFERENCES `scenarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`versionId`) REFERENCES `scenario_versions`(`id`) ON UPDATE no action ON DELETE no action
);
