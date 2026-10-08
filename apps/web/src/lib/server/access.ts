import "server-only"
import { EXAMPLES_OWNER, OPERATOR, type Store } from "@fillrate/db"

import { ApiError } from "./errors"

// There are no accounts: every caller works in the one "operator" dataset plus the bundled examples. Rows that
// carry any other owner (an older hosted database) are not reachable.
export const OWNER = OPERATOR

function versionOwner(store: Store, versionId: string) {
  try { return store.versionOwner(versionId) } catch { return null }
}

/** A version of the operator dataset or a bundled example. */
export function assertVersionRead(store: Store, versionId: string, notFound = new ApiError(404, "version_not_found", "No saved scenario version with this ID.")) {
  const owner = versionOwner(store, versionId)
  if (owner !== OWNER && owner !== EXAMPLES_OWNER) throw notFound
  return owner
}

/** A saved (imported) version; bundled examples are not editable scenarios. */
export function assertOwnVersion(store: Store, versionId: unknown) {
  if (typeof versionId !== "string" || versionOwner(store, versionId) !== OWNER) throw new ApiError(404, "version_not_found", "No saved imported scenario version.")
  return OWNER
}

export function assertRunRead(store: Store, runId: string) {
  const view = store.runView(runId)
  const missing = new ApiError(404, "run_not_found", "No run with this ID.")
  if (!view) throw missing
  assertVersionRead(store, view.versionId, missing)
  return view
}
