import "server-only"
import type { RunSettings } from "@fillrate/contracts"
import type { Store } from "@fillrate/db"

import { assertRunRead, type Principal } from "./access"
import { ApiError } from "./errors"

const FIELD = ["settings.warm_start.run_id"]
const BASELINE_FIELD = ["settings.warm_start.baseline_id"]

/**
 * A run's `warm_start` source (spec §10, M6) must be a succeeded pipeline run the caller can read: their own or a
 * bundled example's. Another owner's run is missing, never forbidden. The store checks the same rule again in the
 * queuing transaction and when the worker asks for the plan.
 */
export function assertWarmStartSource(store: Store, who: Principal, settings: RunSettings) {
  const source = settings.warm_start
  if (!source) return
  if (source.kind === "manual_baseline") {
    // Baselines are strictly the saver's own; they are never public, even on bundled examples.
    const baseline = who.ownerId && source.baseline_id ? store.baseline(source.baseline_id, who.ownerId) : null
    if (!baseline) throw new ApiError(404, "warm_start_source_not_found", "No saved baseline of yours has this ID.", BASELINE_FIELD)
    if (!baseline.valid) throw new ApiError(409, "warm_start_baseline_invalid", "This baseline did not pass the validator when it was saved, so it cannot start a solve.", BASELINE_FIELD)
    return
  }
  if (!source.run_id) throw new ApiError(404, "warm_start_source_not_found", "No run you can read has this ID.", FIELD)
  let view
  try {
    view = assertRunRead(store, who, source.run_id)
  } catch {
    throw new ApiError(404, "warm_start_source_not_found", "No run you can read has this ID.", FIELD)
  }
  if (view.kind !== "pipeline" || view.status !== "succeeded") throw new ApiError(409, "warm_start_source_not_ready", "Warm starts need a succeeded pipeline run with results.", FIELD)
}

/** Store refusals about a warm-start source as 4xx responses. */
export function warmStartError(error: unknown) {
  if (!(error instanceof Error)) return error
  const [code, ...detail] = error.message.split(": ")
  if (code === "warm_start_source_not_found") return new ApiError(404, code, detail.join(": ") || "No run you can read has this ID.", FIELD)
  if (code === "warm_start_source_not_ready") return new ApiError(409, code, detail.join(": "), FIELD)
  if (code === "warm_start_baseline_invalid") return new ApiError(409, code, detail.join(": "), BASELINE_FIELD)
  return error
}

/** The settings' warm start with its kind spelled out; absent and null both mean a cold start. */
export function normalizeWarmStart(source: RunSettings["warm_start"]): RunSettings["warm_start"] {
  if (!source) return null
  return source.kind === "manual_baseline" ? { kind: "manual_baseline", baseline_id: source.baseline_id } : { kind: "run", run_id: source.run_id }
}

/** `warm_start` as a run override: `{run_id}` or `{kind: "run", run_id}`, `{kind: "manual_baseline", baseline_id}`, or null. */
export function parseWarmStart(value: unknown): RunSettings["warm_start"] {
  if (value === null) return null
  const bad = () => new ApiError(400, "invalid_settings", "warm_start must be {run_id}, {kind: \"manual_baseline\", baseline_id}, or null.", ["settings.warm_start"])
  const input = value as { kind?: unknown; run_id?: unknown; baseline_id?: unknown }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw bad()
  const id = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 200
  if (input.kind === "manual_baseline") {
    if (!id(input.baseline_id) || Object.keys(input).some(k => k !== "kind" && k !== "baseline_id")) throw bad()
    return { kind: "manual_baseline", baseline_id: input.baseline_id as string }
  }
  if ((input.kind !== undefined && input.kind !== "run") || !id(input.run_id) || Object.keys(input).some(k => k !== "kind" && k !== "run_id")) throw bad()
  return { kind: "run", run_id: input.run_id as string }
}
