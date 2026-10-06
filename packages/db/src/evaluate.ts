// Manual plan evaluation (spec §10, §12 `evaluate`). The web server reads one cluster of a completed run
// from its stored, hash-verified artifacts and posts it with the plan to the optimizer's loopback
// FastAPI `/evaluate`, which validates it with the pipeline's own validator. Python never opens SQLite;
// nothing here is persisted, so an evaluation is never a run, a solver result or a saved baseline.
//
// A plan is `{ cluster_id, routes }`: ordered visit IDs per truck, the shape of the solve artifact's `routes`. A run with a
// vehicle-type fleet also needs `vehicle_types`: one type ID per truck, parallel to `routes` (never guessed).
import { inflateSync } from "node:zlib";
import type { ClusterPlan, EvaluateRequest, EvaluateResponse } from "@fillrate/contracts";
import type { Store } from "./index";

export const MAX_PLAN_VISITS = 10_000;
const MAX_TRAVEL_DECODED = 64 * 1024 * 1024;

export class EvaluationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

type Entry = Record<string, unknown> & { cluster_id?: string; id?: string };
type Visit = { visit_id: string; location_id: string; load: number; lines: { line_id: string; pieces: number }[] };

/** The travel stage as the worker stored it: plain JSON, or `zlib-json-v1` once it passes 1 MB (artifact_codec.py). */
export function decodeTravel(payload: unknown): { clusters: Entry[] } {
  const p = payload as { encoding?: string; raw_length?: unknown; data?: unknown };
  if (p?.encoding !== "zlib-json-v1") return payload as { clusters: Entry[] };
  if (Object.keys(p).sort().join() !== "data,encoding,raw_length" || typeof p.data !== "string" || typeof p.raw_length !== "number") throw new Error("travel_artifact_invalid");
  const raw = inflateSync(Buffer.from(p.data, "base64"), { maxOutputLength: MAX_TRAVEL_DECODED });
  if (raw.length !== p.raw_length) throw new Error("travel_artifact_invalid");
  return JSON.parse(raw.toString("utf8"));
}

/** Validates a submitted plan's shape and size; the optimizer re-validates it. */
export function parsePlan(input: unknown): ClusterPlan {
  const bad = (message: string) => new EvaluationError(400, "invalid_plan", message);
  const plan = input as { cluster_id?: unknown; routes?: unknown; vehicle_types?: unknown };
  if (!plan || typeof plan !== "object" || typeof plan.cluster_id !== "string" || !plan.cluster_id || plan.cluster_id.length > 200) throw bad("Send cluster_id, the cluster the plan is for.");
  if (!Array.isArray(plan.routes) || !plan.routes.length) throw bad("Send routes: one list of visit IDs per shipment, in visit order.");
  let total = 0;
  for (const route of plan.routes) {
    if (!Array.isArray(route) || !route.length) throw bad("Every shipment needs at least one visit; remove a shipment by moving its visits.");
    for (const id of route) if (typeof id !== "string" || !id || id.length > 500) throw bad("Visit IDs are non-empty strings.");
    total += route.length;
  }
  if (total > MAX_PLAN_VISITS) throw bad(`A plan may list at most ${MAX_PLAN_VISITS} visits.`);
  if (plan.vehicle_types !== undefined && plan.vehicle_types !== null) {
    if (!Array.isArray(plan.vehicle_types) || plan.vehicle_types.length > MAX_PLAN_VISITS || plan.vehicle_types.some(id => typeof id !== "string" || !id || id.length > 200)) throw bad("vehicle_types lists one non-empty vehicle type ID per shipment.");
    if (plan.vehicle_types.length !== plan.routes.length) throw bad("vehicle_types needs exactly one type per shipment, in the same order as routes.");
    return { cluster_id: plan.cluster_id, routes: plan.routes as string[][], vehicle_types: plan.vehicle_types as string[] };
  }
  return { cluster_id: plan.cluster_id, routes: plan.routes as string[][] };
}

/** The recorded stage payloads of a succeeded pipeline run. */
function stages(store: Store, runId: string) {
  const view = store.runView(runId);
  if (!view || view.kind !== "pipeline") throw new EvaluationError(404, "run_not_found", "No pipeline run with this ID.");
  if (view.status !== "succeeded") throw new EvaluationError(409, "run_not_finished", "Only a finished run has a recorded problem to evaluate against.");
  const read = (stage: string) => {
    const manifest = view.artifacts.find(a => a.stage_type === stage);
    if (!manifest) throw new EvaluationError(409, "artifact_missing", `This run has no ${stage} artifact.`);
    return store.readArtifact(manifest.output_hash) as Record<string, unknown>;
  };
  return { view, read, hash: (stage: string) => view.artifacts.find(a => a.stage_type === stage)?.output_hash ?? null };
}

function clusterEntry(payload: Record<string, unknown>, clusterId: string, key: "id" | "cluster_id") {
  const entry = (payload.clusters as Entry[]).find(c => c[key] === clusterId);
  if (!entry) throw new EvaluationError(404, "cluster_not_found", `This run has no cluster ${clusterId}.`);
  return entry;
}

/**
 * What a manual plan editor needs for one cluster: the problem's visits (with loads and any visits the run
 * could not reach), and the run's optimized routes when the solver returned a candidate.
 */
export function planContext(store: Store, runId: string, clusterId: string) {
  const { read } = stages(store, runId);
  const cluster = clusterEntry(read("clustering"), clusterId, "id");
  const problem = clusterEntry(read("problem"), clusterId, "cluster_id");
  const solve = clusterEntry(read("solve"), clusterId, "cluster_id");
  const members = new Set(cluster.visits as string[]);
  const visits = new Map((read("aggregation").visits as Visit[]).filter(v => members.has(v.visit_id)).map(v => [v.visit_id, v]));
  const describe = (id: string) => ({ visit_id: id, location_id: visits.get(id)!.location_id, load: visits.get(id)!.load });
  return {
    cluster_id: clusterId,
    objective: problem.objective as string,
    visits: (problem.visits as string[]).map(describe),
    blocked: (problem.blocked as { visit_id: string; reason: string }[]).map(b => ({ ...describe(b.visit_id), reason: b.reason })),
    solve_status: solve.status as string,
    reference_routes: solve.status === "solved" ? (solve.routes as string[][]) : null,
    // Fleet runs only: the cluster problem's vehicle types (id, label, capacity, count) and each reference route's type.
    ...(problem.vehicle_types ? {
      vehicle_types: (problem.vehicle_types as { id: string; label: string; capacity: number; count: number | null }[]).map(({ id, label, capacity, count }) => ({ id, label, capacity, count })),
      reference_vehicle_types: solve.status === "solved" ? (solve.vehicle_types as string[]) : null,
    } : {}),
  };
}

/** The `/evaluate` request for one cluster of a run, with its optimized routes as the reference. */
export function evaluationRequest(store: Store, runId: string, plan: ClusterPlan): { request: EvaluateRequest; recorded: Record<string, string | null> } {
  const { view, read, hash } = stages(store, runId);
  const id = plan.cluster_id;
  const cluster = clusterEntry(read("clustering"), id, "id");
  const solve = clusterEntry(read("solve"), id, "cluster_id");
  const members = new Set(cluster.visits as string[]);
  const settings = view.settings.document as EvaluateRequest["settings"];
  const snapshotId = (settings as { travel_snapshot_id?: string | null }).travel_snapshot_id ?? null;
  const request: EvaluateRequest = {
    schema_version: 1,
    scenario: store.versionDocument(view.versionId).document as unknown as EvaluateRequest["scenario"],
    settings,
    cluster,
    problem: clusterEntry(read("problem"), id, "cluster_id"),
    travel: clusterEntry(decodeTravel(read("travel")), id, "cluster_id"),
    visits: (read("aggregation").visits as Visit[]).filter(v => members.has(v.visit_id)),
    // The exact snapshot the run selected; the optimizer re-checks its identity against the settings.
    travel_snapshot: snapshotId ? (store.travelSnapshot(snapshotId) as unknown as Record<string, unknown>) : null,
    plan,
    reference: solve.status === "solved" && (solve.routes as string[][]).length ? { cluster_id: id, routes: solve.routes as string[][], ...(solve.vehicle_types ? { vehicle_types: solve.vehicle_types as string[] } : {}) } : null,
  };
  return { request, recorded: { travel: hash("travel"), problem: hash("problem"), aggregation: hash("aggregation"), travel_snapshot: snapshotId } };
}

/** Posts to the optimizer's `/evaluate` with the worker bearer token and a bounded wait. */
export async function callEvaluator(baseUrl: string, token: string, request: EvaluateRequest, timeoutMs = 30_000): Promise<EvaluateResponse> {
  let response: Response;
  try {
    response = await fetch(new URL("/evaluate", baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new EvaluationError(503, "evaluator_unavailable", timedOut ? "The optimizer did not answer in time." : "The optimizer service is not running, so plans cannot be evaluated right now.");
  }
  const body = await response.json().catch(() => null) as { detail?: unknown } | EvaluateResponse | null;
  if (response.ok && body) return body as EvaluateResponse;
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (response.status === 422 && detail && typeof detail === "object" && !Array.isArray(detail)) {
    const { code, message } = detail as { code?: string; message?: string };
    throw new EvaluationError(422, code ?? "evaluation_refused", message ?? "The optimizer refused this plan.");
  }
  if (response.status === 422) throw new EvaluationError(400, "invalid_plan", "The optimizer rejected the plan's shape.");
  throw new EvaluationError(503, "evaluator_unavailable", `The optimizer answered HTTP ${response.status}.`);
}
