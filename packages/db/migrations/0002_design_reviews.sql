CREATE TABLE `design_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`reviewer` text NOT NULL,
	`answers` text NOT NULL,
	`submittedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reviews_by_update` ON `design_reviews` (`updatedAt`);