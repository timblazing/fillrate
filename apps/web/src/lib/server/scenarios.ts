import "server-only";
import { timingSafeEqual } from "node:crypto";
import { parseContract, type RunSettings, type ScenarioDocument, type Snapshot } from "@fillrate/contracts";
import type { Store } from "@fillrate/db";
import { validateScenario } from "@fillrate/db/scenarios";
import { assertSnapshotBinding, preflightChecks } from "@fillrate/db/preflight";
import type { Binding, TravelSnapshot } from "@fillrate/db/travel";
import { ApiError, assertQueueRoom } from "./runs";

// One explicitly trusted operator workspace. No anonymous imported-data access.
export function assertScenarioAccess(request: Request) {
  if (process.env.NODE_ENV !== "production") return;
  const expected = process.env.SCENARIO_KEY;
  if (!expected) throw new ApiError(503, "scenarios_disabled", "Scenario access is not enabled on this server.");
  const cookie = request.headers.get("cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith("fillrate_operator="))?.slice("fillrate_operator=".length);
  const key = request.headers.get("x-scenario-key") ?? (cookie ? decodeURIComponent(cookie) : "");
  const a = Buffer.from(key), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new ApiError(403, "forbidden", "A valid scenario key is required.");
}
export function isImportedRun(store: Store, id: string) {
  return Boolean(store.sqlite.prepare("SELECT 1 FROM runs r JOIN scenario_sources s ON s.versionId=r.versionId WHERE r.id=?").get(id));
}
export function assertRunReadAccess(store: Store, id: string, request: Request) {
  if (isImportedRun(store, id)) assertScenarioAccess(request);
}
export function publicRuns(store: Store) {
  return store.listRuns(100).filter(r => !isImportedRun(store, r.id)).slice(0, 50);
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
export function selectedTravel(store: Store, document: ScenarioDocument, settings: RunSettings, loaded: Map<string, TravelSnapshot> = new Map()) {
  if (!settings.travel_snapshot_id) return undefined;
  try {
    const snapshot = loaded.get(settings.travel_snapshot_id) ?? store.travelSnapshot(settings.travel_snapshot_id);
    loaded.set(settings.travel_snapshot_id, snapshot);
    assertSnapshotBinding(document, settings.excluded_line_ids ?? [], snapshot);
    return snapshot;
  } catch (error) { throw travelError(error); }
}

export function createScenarioRun(store: Store, versionId: string, rawSettings: unknown, key: string) {
  const source = store.sqlite.prepare("SELECT 1 FROM scenario_sources WHERE versionId=?").get(versionId);
  if (!source) throw new ApiError(404, "version_not_found", "No saved imported scenario version.");
  const document = validateScenario(store.versionDocument(versionId).document);
  const settings = parseContract("RunSettings", rawSettings);
  assertQueueRoom(store, 1);
  const findings = preflightChecks(document, settings, selectedTravel(store, document, settings));
  const blockers = findings.filter(x => x.action === "block");
  if (blockers.length) throw new ApiError(422, "preflight_blocked", "Resolve blocking checks, exclude affected lines, or change the check to a warning.", blockers.flatMap(x => x.line_ids));
  try { return store.enqueue(versionId, {schema_version: 1, document: settings} as unknown as Snapshot, key); }
  catch (error) { throw travelError(error); }
}
