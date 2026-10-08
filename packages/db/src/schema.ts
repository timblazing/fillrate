import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, blob, uniqueIndex, index, check, primaryKey, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

// Owners: "operator" is the single account-free dataset every caller works in; "examples" are the bundled
// synthetic scenarios. Rows from older hosted databases may carry other owner values and are simply not listed.
export const scenarios = sqliteTable("scenarios", {
  id: text().primaryKey(), name: text().notNull(), createdAt: integer().notNull(),
  ownerId: text().notNull().default("operator"),
}, t => [index("scenarios_by_owner").on(t.ownerId)]);
export const versions = sqliteTable("scenario_versions", {
  id: text().primaryKey(), scenarioId: text().notNull().references(() => scenarios.id),
  revision: integer().notNull(), schemaVersion: integer().notNull().default(1),
  parentVersionId: text().references((): AnySQLiteColumn => versions.id), document: text().notNull(), author: text().notNull(), createdAt: integer().notNull(),
}, t => [uniqueIndex("scenario_revision").on(t.scenarioId, t.revision)]);
export const runs = sqliteTable("runs", {
  id: text().primaryKey(), versionId: text().notNull().references(() => versions.id),
  settings: text().notNull(), status: text().notNull().default("queued"),
  idempotencyKey: text().notNull().unique(), requestHash: text().notNull(), createdAt: integer().notNull(),
  // "pipeline" runs the fulfillment pipeline; "explorer" is a clustering-only k explorer job (M4).
  kind: text().notNull().default("pipeline"),
  // Who submitted it (cancel). Reads follow the scenario's owner.
  ownerId: text().notNull().default("operator"),
}, t => [index("run_status_date").on(t.status, t.createdAt), index("runs_by_owner").on(t.ownerId, t.status)]);
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
// Stage reuse is scoped by the scenario's owner, so one account's cache never answers another's lookup.
export const stageCache = sqliteTable("stage_cache", {
  scope: text().notNull(), inputHash: text().notNull(), artifactHash: text().notNull().references(() => artifacts.hash),
  manifest: text().notNull(), runId: text().notNull().references(() => runs.id),
}, t => [primaryKey({ columns: [t.scope, t.inputHash] }), index("stage_cache_by_run").on(t.runId)]);
export const scenarioSources = sqliteTable("scenario_sources", {
  versionId: text().primaryKey().references(() => versions.id),
  source: text().notNull(), metadata: text().notNull(),
});
export const scenarioSaves = sqliteTable("scenario_saves", {
  idempotencyKey: text().primaryKey(), requestHash: text().notNull(),
  scenarioId: text().notNull().references(() => scenarios.id),
  versionId: text().notNull().references(() => versions.id), createdAt: integer().notNull(),
});

// M4 bounded sweeps: one experiment expands into at most MAX_SWEEP_RUNS ordinary runs. The comparison
// vector and ranking order are saved with it and included in exports.
export const experiments = sqliteTable("experiments", {
  id: text().primaryKey(), versionId: text().notNull().references(() => versions.id),
  name: text().notNull(), spec: text().notNull(), comparison: text().notNull(),
  idempotencyKey: text().notNull().unique(), requestHash: text().notNull(), createdAt: integer().notNull(),
  ownerId: text().notNull().default("operator"),
}, t => [index("experiments_by_date").on(t.createdAt)]);
export const experimentRuns = sqliteTable("experiment_runs", {
  id: text().primaryKey(), experimentId: text().notNull().references(() => experiments.id),
  runId: text().notNull().unique().references(() => runs.id), position: integer().notNull(), varied: text().notNull(),
}, t => [uniqueIndex("experiment_position").on(t.experimentId, t.position)]);

// M5 geocoding (spec §6). Census results are cached by normalized address, provider, benchmark and
// request options; `responseRef` points at the raw provider response stored in `artifacts`.
export const geocodeCache = sqliteTable("geocode_cache", {
  key: text().primaryKey(), provider: text().notNull(), dataset: text().notNull(), address: text().notNull(),
  result: text().notNull(), responseRef: text().references(() => artifacts.hash), createdAt: integer().notNull(),
});
// A geocoding job resolves one saved version's addresses off the request path and saves the result
// as a new version (a branch if the scenario moved on meanwhile).
export const geocodeJobs = sqliteTable("geocode_jobs", {
  id: text().primaryKey(), versionId: text().notNull().references(() => versions.id),
  status: text().notNull().default("queued"), options: text().notNull(), author: text().notNull(), metadata: text().notNull(),
  progress: text(), report: text(), resultVersionId: text().references(() => versions.id), branched: integer({mode: "boolean"}).notNull().default(false),
  error: text(), idempotencyKey: text().notNull().unique(), requestHash: text().notNull(), createdAt: integer().notNull(), updatedAt: integer().notNull(),
  ownerId: text().notNull().default("operator"),
}, t => [index("geocode_jobs_by_date").on(t.createdAt)]);

// M6 directed travel snapshots (spec §7): immutable, stored by content hash (`id` = sha256 of the canonical
// document, verified on every read). Run settings name one by id; triggers forbid update and delete.
export const travelSnapshots = sqliteTable("travel_snapshots", {
  id: text().primaryKey(), compressed: blob({mode: "buffer"}).notNull(), byteLength: integer().notNull(),
  nodeCount: integer().notNull(), provider: text().notNull(), providerVersion: text().notNull(),
  datasetRevision: text().notNull(), profile: text().notNull(), createdAt: integer().notNull(),
});
// A snapshot is stored once by content hash; each owner that uploaded it holds a link, and reads need one.
export const travelSnapshotOwners = sqliteTable("travel_snapshot_owners", {
  snapshotId: text().notNull().references(() => travelSnapshots.id), ownerId: text().notNull(), createdAt: integer().notNull(),
}, t => [primaryKey({ columns: [t.snapshotId, t.ownerId] }), index("snapshot_owner").on(t.ownerId)]);

// Valhalla road geometry for one inspected truck (spec §4, §7), cached apart from run results. `key` is a
// content hash of run, truck, snapshot identity and deployment identity; the payload is a content-addressed
// artifact. Rows go with their run and are never read without the run's read check.
export const routeGeometry = sqliteTable("route_geometry", {
  key: text().primaryKey(), runId: text().notNull().references(() => runs.id), truckId: text().notNull(),
  snapshotId: text().notNull(), deployment: text().notNull(), artifactHash: text().notNull().references(() => artifacts.hash),
  createdAt: integer().notNull(),
}, t => [index("route_geometry_by_run").on(t.runId)]);
