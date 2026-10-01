CREATE TABLE `travel_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`compressed` blob NOT NULL,
	`byteLength` integer NOT NULL,
	`nodeCount` integer NOT NULL,
	`provider` text NOT NULL,
	`providerVersion` text NOT NULL,
	`datasetRevision` text NOT NULL,
	`profile` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER immutable_travel_snapshot BEFORE UPDATE ON travel_snapshots
BEGIN SELECT RAISE(ABORT, 'travel snapshots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER undeletable_travel_snapshot BEFORE DELETE ON travel_snapshots
BEGIN SELECT RAISE(ABORT, 'travel snapshots cannot be deleted'); END;
