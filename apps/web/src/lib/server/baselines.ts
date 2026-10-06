import "server-only"
import type { BaselineRecord, Store } from "@fillrate/db"
import { parsePlan } from "@fillrate/db/evaluate"

import { assertRunRead, requireOwner, workAdmission, type Principal } from "./access"
import { evaluateRunPlan } from "./evaluate"
import { ApiError } from "./errors"

// Saved manual baselines (spec §10, M6). A baseline is a hand-edited plan for one cluster of a succeeded run,
// stored with the evaluator's outcome. It belongs to whoever saved it: reads and deletes are by owner alone, and
// another owner's baseline is missing, never forbidden. Saving never implies solver feasibility; only a baseline
// the evaluator found valid can start a solve (see `warm-start.ts`).

const notFound = () => new ApiError(404, "baseline_not_found", "No saved baseline of yours has this ID.")

function parseName(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 100) throw new ApiError(400, "invalid_name", "Name the baseline (1 to 100 characters).", ["name"])
  return value.trim()
}

/** A baseline as the API shows it; `detail` adds the evaluator's full outcome (trucks) that lists leave out. */
export function baselineView(record: BaselineRecord, detail = false) {
  const { manual, evaluator_version, recorded } = record.evaluation
  return {
    schema_version: 1,
    id: record.id,
    run_id: record.runId,
    cluster_id: record.clusterId,
    name: record.name,
    valid: record.valid,
    created_at: record.createdAt,
    plan: record.plan,
    violations: manual.violations,
    metrics: manual.metrics,
    ...(detail ? { evaluation: { evaluator_version, manual, recorded } } : {}),
  }
}

function storeError(error: unknown): never {
  if (error instanceof Error) {
    if (error.message === "idempotency_conflict") throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used with a different baseline.")
    if (error.message === "run_not_found") throw new ApiError(404, "run_not_found", "No run with this ID.")
    if (error.message === "run_not_finished") throw new ApiError(409, "run_not_finished", "Only a finished run has a recorded problem to baseline against.")
    if (error.message === "baseline_limit") throw new ApiError(409, "baseline_limit", "You have saved the maximum number of baselines. Delete one first.")
    if (error.message === "baseline_in_use") throw new ApiError(409, "baseline_in_use", "A queued or running solve starts from this baseline. Delete it after that run finishes.")
  }
  throw error
}

/** Evaluates a plan through the same evaluator as the Manual plan tab, then saves it with the outcome. Invalid plans are saved, marked invalid. */
export async function saveRunBaseline(store: Store, who: Principal, runId: string, idempotencyKey: string, body: unknown) {
  if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).", ["Idempotency-Key"])
  const ownerId = requireOwner(who)
  const view = assertRunRead(store, who, runId)
  const input = body as { name?: unknown; plan?: unknown } | null
  if (!input || typeof input !== "object") throw new ApiError(400, "invalid_json", "Send {name, plan: {cluster_id, routes}}.")
  const name = parseName(input.name)
  let plan
  try { plan = parsePlan(input.plan) } catch (error) { throw new ApiError(400, "invalid_plan", error instanceof Error ? error.message : "Invalid plan.", ["plan"]) }
  const hash = store.baselineRequestHash(runId, name, plan)
  try {
    // A replayed key answers from the stored baseline, with no evaluation or quota charge.
    const prior = store.baselineReplay(idempotencyKey, ownerId, hash)
    if (prior) return { record: prior, replayed: true }
    const evaluated = await evaluateRunPlan(store, who, runId, view.versionId, plan)
    const evaluation = { evaluator_version: evaluated.evaluator_version, cluster_id: evaluated.cluster_id, manual: evaluated.manual, recorded: evaluated.recorded }
    const record = store.saveBaseline({ runId, ownerId, name, plan, evaluation, idempotencyKey, admission: workAdmission(who, "save") })
    return { record, replayed: false }
  } catch (error) {
    return storeError(error)
  }
}

export function listRunBaselines(store: Store, who: Principal, runId: string) {
  const ownerId = requireOwner(who)
  assertRunRead(store, who, runId)
  return store.listBaselines(runId, ownerId).map(r => baselineView(r))
}

export function readBaseline(store: Store, who: Principal, id: string) {
  const record = who.ownerId ? store.baseline(id, who.ownerId) : null
  if (!record) throw notFound()
  return baselineView(record, true)
}

export function deleteBaseline(store: Store, who: Principal, id: string) {
  const ownerId = requireOwner(who)
  try {
    if (!store.deleteBaseline(id, ownerId)) throw notFound()
  } catch (error) {
    if (error instanceof ApiError) throw error
    storeError(error)
  }
}
