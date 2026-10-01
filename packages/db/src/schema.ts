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
// M2 design review answers (both rounds exported to docs/reviews). The /dev/review pages were removed after round
// two; the table is kept so deployed answers are not dropped. Not part of the product model.
export const designReviews = sqliteTable("design_reviews", {
  id: text().primaryKey(), reviewer: text().notNull(), answers: text().notNull(),
  submittedAt: integer(), createdAt: integer().notNull(), updatedAt: integer().notNull(),
}, t => [index("reviews_by_update").on(t.updatedAt)]);

// Durable M3 cluster tasks. A coordinator lease owns each attempt; restart resumes
// completed tasks only within this run, never treating another run as a replicate.
export const clusterJobs = sqliteTable("cluster_jobs", {
  id: text().primaryKey(), runId: text().notNull().references(() => runs.id),
  clusterId: text().notNull(), inputHash: text().notNull(),
  status: text().notNull().default("queued"), attempt: integer().notNull().default(0),
  maxAttempts: integer().notNull().default(3), coordinatorToken: text(),
  result: text(), startedAt: integer(), endedAt: integer(), error: text(),
}, t => [uniqueIndex("run_cluster").on(t.runId, t.clusterId)]);
export const stageCache = sqliteTable("stage_cache", {
  inputHash: text().primaryKey(), artifactHash: text().notNull().references(() => artifacts.hash),
  manifest: text().notNull(), runId: text().notNull().references(() => runs.id),
});
export const scenarioSources = sqliteTable("scenario_sources", {
  versionId: text().primaryKey().references(() => versions.id),
  source: text().notNull(), metadata: text().notNull(),
});
export const scenarioSaves = sqliteTable("scenario_saves", {
  idempotencyKey: text().primaryKey(), requestHash: text().notNull(),
  scenarioId: text().notNull().references(() => scenarios.id),
  versionId: text().notNull().references(() => versions.id), createdAt: integer().notNull(),
});
