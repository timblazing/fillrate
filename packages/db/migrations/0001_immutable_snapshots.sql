CREATE TRIGGER immutable_scenario_version BEFORE UPDATE ON scenario_versions
BEGIN SELECT RAISE(ABORT, 'scenario versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_run_input BEFORE UPDATE OF versionId, settings, requestHash, idempotencyKey ON runs
BEGIN SELECT RAISE(ABORT, 'run inputs are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER immutable_run_artifact BEFORE UPDATE ON run_artifacts
BEGIN SELECT RAISE(ABORT, 'artifact references are immutable'); END;
