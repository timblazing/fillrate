-- Direct solves: a run is one call to the optimizer service, so leased jobs, attempts, events, cluster tasks,
-- the stage cache and idempotency keys go away. A run keeps its output in `runs.result`; runs made before this
-- migration keep their `run_artifacts` rows, which are still read (they are not rewritten here).
DROP TRIGGER immutable_run_input;--> statement-breakpoint
ALTER TABLE `runs` ADD `result` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `error` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `finishedAt` integer;--> statement-breakpoint
UPDATE `runs` SET `error` = (SELECT e.`payload` FROM `job_events` e JOIN `jobs` j ON j.`id` = e.`jobId` WHERE j.`runId` = `runs`.`id` AND e.`kind` = 'failed' ORDER BY e.`attempt` DESC, e.`sequence` DESC LIMIT 1) WHERE `status` = 'failed';--> statement-breakpoint
UPDATE `runs` SET `status` = 'running' WHERE `status` = 'claimed';--> statement-breakpoint
DROP TABLE `job_attempts`;--> statement-breakpoint
DROP TABLE `cluster_jobs`;--> statement-breakpoint
DROP TABLE `job_events`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
DROP TABLE `scenario_saves`;--> statement-breakpoint
DROP TABLE `stage_cache`;--> statement-breakpoint
DROP INDEX `experiments_idempotencyKey_unique`;--> statement-breakpoint
ALTER TABLE `experiments` DROP COLUMN `idempotencyKey`;--> statement-breakpoint
ALTER TABLE `experiments` DROP COLUMN `requestHash`;--> statement-breakpoint
DROP INDEX `geocode_jobs_idempotencyKey_unique`;--> statement-breakpoint
ALTER TABLE `geocode_jobs` DROP COLUMN `idempotencyKey`;--> statement-breakpoint
ALTER TABLE `geocode_jobs` DROP COLUMN `requestHash`;--> statement-breakpoint
DROP INDEX `runs_idempotencyKey_unique`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `idempotencyKey`;--> statement-breakpoint
ALTER TABLE `runs` DROP COLUMN `requestHash`;--> statement-breakpoint
CREATE TRIGGER immutable_run_input BEFORE UPDATE OF versionId, settings ON runs
BEGIN SELECT RAISE(ABORT, 'run inputs are immutable'); END;
