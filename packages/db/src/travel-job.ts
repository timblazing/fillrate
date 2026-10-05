// Durable Valhalla travel-snapshot jobs (spec §7, M6). The job is a run of kind "travel_snapshot" on a
// scenario version; the worker builds the matrix from deployment configuration only and stores it through
// the lease-checked `store_snapshot` transport call. No live Valhalla is implied by anything here.
import type { Snapshot } from "@fillrate/contracts";
import type { Admission, Store } from "./index";

/** The deployment metadata the worker's `ValhallaConfig.from_env` requires. */
export const VALHALLA_ENV = ["VALHALLA_URL", "VALHALLA_VERSION", "VALHALLA_DATASET_REVISION", "VALHALLA_GRAPH_CONFIG_HASH", "VALHALLA_COSTING_OPTIONS"] as const;

export function valhallaConfigured(env: Record<string, string | undefined> = process.env) {
  return VALHALLA_ENV.every(name => Boolean(env[name]?.trim()));
}

/**
 * Queues one snapshot build for `versionId` (which `ownerId` must own). Refused with `valhalla_not_configured`
 * before anything is enqueued. Admission is charged in the enqueue transaction like any run; a replay of the
 * same key and version returns the same run without a second charge.
 */
export function createTravelSnapshotJob(store: Store, versionId: string, idempotencyKey: string, options: { ownerId: string; admission?: Admission; env?: Record<string, string | undefined>; now?: number }) {
  if (!valhallaConfigured(options.env)) throw new Error("valhalla_not_configured: Valhalla is not configured on this server.");
  const settings = { schema_version: 1, document: { schema_version: 1, kind: "travel_snapshot", version_id: versionId } } as unknown as Snapshot;
  return store.enqueue(versionId, settings, idempotencyKey, options.now ?? Date.now(), 3, "travel_snapshot", { ownerId: options.ownerId, admission: options.admission });
}
