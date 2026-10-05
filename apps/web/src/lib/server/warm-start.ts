import "server-only"
import type { RunSettings } from "@fillrate/contracts"
import type { Store } from "@fillrate/db"

import { assertRunRead, type Principal } from "./access"
import { ApiError } from "./errors"

const FIELD = ["settings.warm_start.run_id"]

/**
 * A run's `warm_start` source (spec §10, M6) must be a succeeded pipeline run the caller can read: their own or a
 * bundled example's. Another owner's run is missing, never forbidden. The store checks the same rule again in the
 * queuing transaction and when the worker asks for the plan.
 */
export function assertWarmStartSource(store: Store, who: Principal, settings: RunSettings) {
  const source = settings.warm_start
  if (!source) return
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
  if (code === "warm_start_source_not_found") return new ApiError(404, code, "No run you can read has this ID.", FIELD)
  if (code === "warm_start_source_not_ready") return new ApiError(409, code, detail.join(": "), FIELD)
  return error
}

/** `warm_start` as a run override: `{run_id}` (kind defaults to "run") or null. */
export function parseWarmStart(value: unknown): RunSettings["warm_start"] {
  if (value === null) return null
  const input = value as { kind?: unknown; run_id?: unknown }
  if (!input || typeof input !== "object" || Array.isArray(input) || (input.kind !== undefined && input.kind !== "run") || typeof input.run_id !== "string" || !input.run_id || input.run_id.length > 200 || Object.keys(input).some(k => k !== "kind" && k !== "run_id"))
    throw new ApiError(400, "invalid_settings", "warm_start must be {run_id} naming a run, or null.", ["settings.warm_start"])
  return { kind: "run", run_id: input.run_id }
}
