import "server-only";
import type { Store } from "@fillrate/db";
import { createTravelSnapshotJob } from "@fillrate/db/travel-job";
import { assertOwnVersion } from "./access";
import { ApiError } from "./errors";
import { travelError } from "./scenarios";

export function createTravelJob(store: Store, versionId: unknown, idempotencyKey: string) {
  const ownerId = assertOwnVersion(store, versionId);
  if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an idempotencyKey (1–200 characters).", ["idempotencyKey"]);
  try { return createTravelSnapshotJob(store, versionId as string, idempotencyKey, { ownerId }); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith("valhalla_not_configured")) throw new ApiError(409, "valhalla_not_configured", "Valhalla road matrices are not configured on this server.");
    if (error instanceof Error && error.message === "idempotency_conflict") throw new ApiError(409, "idempotency_conflict", "This idempotency key was already used for a different request.");
    throw travelError(error);
  }
}
