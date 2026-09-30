import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, blob, uniqueIndex, index, check, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const scenarios = sqliteTable("scenarios", {
  id: text().primaryKey(), name: text().notNull(), createdAt: integer().notNull(),
});
export const versions = sqliteTable("scenario_versions", {
  id: text().primaryKey(), scenarioId: text().notNull().references(() => scenarios.id),
  revision: integer().notNull(), schemaVersion: integer().notNull().default(1),
  parentVersionId: text().references((): AnySQLiteColumn => versions.id), document: text().notNull(), author: text().notNull(), createdAt: integer().notNull(),
}, t => [uniqueIndex("scenario_revision").on(t.scenarioId, t.revision)]);
export const runs = sqliteTable("runs", {
  id: text().primaryKey(), versionId: text().notNull().references(() => versions.id),
  settings: text().notNull(), status: text().notNull().default("queued"),
  idempotencyKey: text().notNull().unique(), requestHash: text().notNull(), createdAt: integer().notNull(),
}, t => [index("run_status_date").on(t.status, t.createdAt)]);
export const jobs = sqliteTable("jobs", {
  id: text().primaryKey(), runId: text().notNull().unique().references(() => runs.id),
  status: text().notNull().default("queued"), attempt: integer().notNull().default(0),
  maxAttempts: integer().notNull().default(3), workerId: text(), leaseToken: text(),
  leaseExpiresAt: integer(), heartbeatAt: integer(), cancelRequested: integer({mode: "boolean"}).notNull().default(false),
  createdAt: integer().notNull(),
}, t => [index("claimable_jobs").on(t.status, t.createdAt), check("valid_attempts", sql`${t.attempt} >= 0 AND ${t.maxAttempts} BETWEEN 1 AND 10`)]);
export const attempts = sqliteTable("job_attempts", {
  id: text().primaryKey(), jobId: text().notNull().references(() => jobs.id),
  attempt: integer().notNull(), workerId: text().notNull(), startedAt: integer().notNull(),
  endedAt: integer(), reason: text(),
}, t => [uniqueIndex("job_attempt").on(t.jobId, t.attempt)]);
export const events = sqliteTable("job_events", {
  id: text().primaryKey(), jobId: text().notNull().references(() => jobs.id),
  attempt: integer().notNull(), sequence: integer().notNull(), kind: text().notNull(),
  payload: text().notNull(), requestHash: text().notNull(), createdAt: integer().notNull(),
}, t => [uniqueIndex("event_sequence").on(t.jobId, t.attempt, t.sequence)]);
export const artifacts = sqliteTable("artifacts", {
  hash: text().primaryKey(), compressed: blob({mode: "buffer"}).notNull(), byteLength: integer().notNull(),
});
export const runArtifacts = sqliteTable("run_artifacts", {
  id: text().primaryKey(), runId: text().notNull().references(() => runs.id),
  artifactHash: text().notNull().references(() => artifacts.hash), manifest: text().notNull(),
}, t => [index("artifacts_by_run").on(t.runId)]);
