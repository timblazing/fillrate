import "server-only";
import { parseContract, type RunSettings, type ScenarioDocument, type Snapshot } from "@fillrate/contracts";
import type { Store } from "@fillrate/db";
import { validateScenario } from "@fillrate/db/scenarios";
import { assertSnapshotBinding, preflightChecks } from "@fillrate/db/preflight";
import type { Binding, TravelSnapshot } from "@fillrate/db/travel";
import { admission, assertOwnVersion, type Principal } from "./access";
import { ApiError } from "./errors";
import { assertWarmStartSource, normalizeWarmStart, warmStartError } from "./warm-start";

/** Runs on bundled examples plus the caller's own scenarios. */
export function visibleRuns(store: Store, who: Principal) {
  // Matrix builds are listed in the scenario matrix panel and lab runs on /labs, not as pipeline runs.
  return store.listRuns(50, who.ownerId).filter(run => run.kind !== "travel_snapshot" && run.kind !== "lab");
}
export async function boundedJson(request: Request, limit = 10 * 1024 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_body", "A JSON body is required.");
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new ApiError(413, "body_too_large", `Request exceeds ${limit / 1024 / 1024} MiB.`); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
/** Store and preflight errors about a travel snapshot, as 4xx responses that name what is wrong. */
export function travelError(error: unknown) {
  if (!(error instanceof Error)) return error;
  const [code, ...detail] = error.message.split(": ");
  if (!/^travel_snapshot_[a-z_]+$/.test(code)) return error;
  const binding = (error as Error & { binding?: Binding }).binding;
  const places = binding ? [...binding.moved, ...binding.missing].slice(0, 20).map(id => `location:${id}`) : [];
  return new ApiError(code === "travel_snapshot_not_found" ? 404 : 422, code, detail.join(": ") || "The selected travel snapshot cannot be used.", ["settings.travel_snapshot_id", ...places]);
}

/**
 * The directed travel snapshot the settings select, or undefined for estimated travel. It must exist and
 * describe the scenario's current stop coordinates: an edit after the snapshot was taken is refused here,
 * before anything is queued (spec §7). Preflight then reads legs from the same matrix the worker will use.
 */
export function selectedTravel(store: Store, document: ScenarioDocument, settings: RunSettings, ownerId: string, loaded: Map<string, TravelSnapshot> = new Map()) {
  if (!settings.travel_snapshot_id) return undefined;
  try {
    // Another owner's snapshot reads as missing: a content hash is not an access token.
    if (!loaded.has(settings.travel_snapshot_id) && !store.ownsTravelSnapshot(settings.travel_snapshot_id, ownerId)) throw new Error("travel_snapshot_not_found: no stored travel snapshot has this identity");
    const snapshot = loaded.get(settings.travel_snapshot_id) ?? store.travelSnapshot(settings.travel_snapshot_id);
    loaded.set(settings.travel_snapshot_id, snapshot);
    assertSnapshotBinding(document, settings.excluded_line_ids ?? [], snapshot);
    return snapshot;
  } catch (error) { throw travelError(error); }
}

export function createScenarioRun(store: Store, who: Principal, versionId: string, rawSettings: unknown, key: string) {
  const ownerId = assertOwnVersion(store, who, versionId);
  if (!key || key.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).", ["Idempotency-Key"]);
  const document = validateScenario(store.versionDocument(versionId).document);
  const settings = parseContract("RunSettings", rawSettings);
  // Stored settings name the source explicitly; null and absent both mean a cold start.
  if (settings.warm_start) settings.warm_start = normalizeWarmStart(settings.warm_start);
  else delete settings.warm_start;
  assertWarmStartSource(store, who, settings);
  const findings = preflightChecks(document, settings, selectedTravel(store, document, settings, ownerId));
  const blockers = findings.filter(x => x.action === "block");
  if (blockers.length) throw new ApiError(422, "preflight_blocked", "Resolve blocking checks, exclude affected lines, or change the check to a warning.", blockers.flatMap(x => x.line_ids));
  try { return store.enqueue(versionId, {schema_version: 1, document: settings} as unknown as Snapshot, key, Date.now(), 3, "pipeline", { ownerId, admission: admission(who) }); }
  catch (error) { throw warmStartError(travelError(error)); }
}
