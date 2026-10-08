import "server-only";
import { parseContract, type Snapshot } from "@fillrate/contracts";
import type { Store } from "@fillrate/db";
import { validateScenario } from "@fillrate/db/scenarios";
import { preflightChecks } from "@fillrate/db/preflight";
import { assertOwnVersion, OWNER } from "./access";
import { ApiError } from "./errors";
import { launchRun } from "./runs";

/** Runs on bundled examples plus saved scenarios. */
export function visibleRuns(store: Store) {
  // Matrix-build jobs from older versions are not runs anymore.
  return store.listRuns(50, OWNER).filter(run => (run.kind as string) !== "travel_snapshot");
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
export function createScenarioRun(store: Store, versionId: string, rawSettings: unknown) {
  const ownerId = assertOwnVersion(store, versionId);
  const document = validateScenario(store.versionDocument(versionId).document);
  const settings = parseContract("RunSettings", rawSettings);
  const findings = preflightChecks(document, settings);
  const blockers = findings.filter(x => x.action === "block");
  if (blockers.length) throw new ApiError(422, "preflight_blocked", "Resolve blocking checks, exclude affected lines, or change the check to a warning.", blockers.flatMap(x => x.line_ids));
  return launchRun(store, versionId, {schema_version: 1, document: settings} as unknown as Snapshot, "pipeline", ownerId);
}
