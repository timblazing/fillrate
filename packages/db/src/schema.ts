import { sqliteTable, text, integer, blob, uniqueIndex, index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

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
// A run is solved by one direct call to the optimizer service. Status: queued, running, succeeded, failed or
// cancelled (older databases also carry interrupted). `result` is the optimizer's JSON, `error` the
// failure as {code, message}.
export const runs = sqliteTable("runs", {
  id: text().primaryKey(), versionId: text().notNull().references(() => versions.id),
  settings: text().notNull(), status: text().notNull().default("queued"), createdAt: integer().notNull(),
  // "pipeline" runs the fulfillment pipeline; "explorer" is a clustering-only k explorer.
  kind: text().notNull().default("pipeline"),
  // Who submitted it (cancel). Reads follow the scenario's owner.
  ownerId: text().notNull().default("operator"),
  result: text(), error: text(), finishedAt: integer(),
}, t => [index("run_status_date").on(t.status, t.createdAt), index("runs_by_owner").on(t.ownerId, t.status)]);
// Content-addressed blobs: geocoder responses, and the stage outputs of runs made before direct solves
// (`run_artifacts` is read-only legacy storage; new runs keep their result in `runs.result`).
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

export const scenarioSources = sqliteTable("scenario_sources", {
  versionId: text().primaryKey().references(() => versions.id),
  source: text().notNull(), metadata: text().notNull(),
});

// M4 bounded sweeps: one experiment expands into at most MAX_SWEEP_RUNS ordinary runs. The comparison
// vector and ranking order are saved with it and included in exports.
export const experiments = sqliteTable("experiments", {
  id: text().primaryKey(), versionId: text().notNull().references(() => versions.id),
  name: text().notNull(), spec: text().notNull(), comparison: text().notNull(),
  createdAt: integer().notNull(),
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
  error: text(), createdAt: integer().notNull(), updatedAt: integer().notNull(),
  ownerId: text().notNull().default("operator"),
}, t => [index("geocode_jobs_by_date").on(t.createdAt)]);
