import "server-only";
import { timingSafeEqual } from "node:crypto";
import { parseContract, type Snapshot } from "@fillrate/contracts";
import type { Store } from "@fillrate/db";
import { validateScenario } from "@fillrate/db/scenarios";
import { preflightChecks } from "@fillrate/db/preflight";
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
export async function boundedJson(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "empty_body", "A JSON body is required.");
  let size = 0; const chunks: Uint8Array[] = [];
  for (;;) {
    const {done, value} = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 10 * 1024 * 1024) { await reader.cancel(); throw new ApiError(413, "body_too_large", "Request exceeds 10 MiB."); }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function createScenarioRun(store: Store, versionId: string, rawSettings: unknown, key: string) {
  const source = store.sqlite.prepare("SELECT 1 FROM scenario_sources WHERE versionId=?").get(versionId);
  if (!source) throw new ApiError(404, "version_not_found", "No saved imported scenario version.");
  const document = validateScenario(store.versionDocument(versionId).document);
  const settings = parseContract("RunSettings", rawSettings);
  assertQueueRoom(store, 1);
  const findings = preflightChecks(document, settings);
  const blockers = findings.filter(x => x.action === "block");
  if (blockers.length) throw new ApiError(422, "preflight_blocked", "Resolve blocking checks, exclude affected lines, or change the check to a warning.", blockers.flatMap(x => x.line_ids));
  return store.enqueue(versionId, {schema_version: 1, document: settings} as unknown as Snapshot, key);
}
