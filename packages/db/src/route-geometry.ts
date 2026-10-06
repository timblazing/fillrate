// Road geometry for one inspected truck (spec §4, §7, §10, §13). The web server decides eligibility (a hard
// rule: only a run on a Valhalla snapshot whose recorded identity equals this deployment's), builds the
// request from the truck's physical stop sequence exactly as validated, and posts it with the snapshot to the
// optimizer's loopback FastAPI `/route-geometry`, which re-checks everything and talks to Valhalla. Python never
// opens SQLite. The result is cached beside, never inside, the run's results.
import type { GeometryLeg, RouteGeometryRequest, RouteGeometryResponse, RunSummary } from "@fillrate/contracts";
import { canonical } from "./canonical";
import { contentHash, type Store } from "./index";
import type { TravelSnapshot } from "./travel";

export const GEOMETRY_VERSION = "fillrate-route-geometry/1";
export type GeometryReason = "estimated_travel" | "imported_matrix" | "provider_context_mismatch" | "valhalla_not_configured";

export class GeometryError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly reason?: GeometryReason) { super(message); }
}

/** This deployment's Valhalla identity as `ValhallaConfig.from_env` reads it (never includes the endpoint). */
export function deploymentIdentity(env: Record<string, string | undefined> = process.env) {
  const need = ["VALHALLA_URL", "VALHALLA_VERSION", "VALHALLA_DATASET_REVISION", "VALHALLA_GRAPH_CONFIG_HASH", "VALHALLA_COSTING_OPTIONS"];
  if (!need.every(n => env[n]?.trim())) return null;
  let options: unknown;
  try { options = JSON.parse(env.VALHALLA_COSTING_OPTIONS!); } catch { return null; }
  if (!options || typeof options !== "object" || Array.isArray(options)) return null;
  return {
    provider: "valhalla", version: env.VALHALLA_VERSION!, dataset_revision: env.VALHALLA_DATASET_REVISION!,
    graph_config_hash: env.VALHALLA_GRAPH_CONFIG_HASH!, costing: "truck", costing_options: options,
  };
}

type Meta = { provider: string; version: string; dataset: string; profile: string; options: Record<string, unknown> };
const metas = new Map<string, Meta>();
/** Snapshots are immutable by content hash, so their identity fields are memoized. */
function snapshotMeta(store: Store, id: string): Meta {
  let meta = metas.get(id);
  if (!meta) {
    const s = store.travelSnapshot(id) as TravelSnapshot & { options?: Record<string, unknown> };
    meta = { provider: s.provider, version: s.provider_version, dataset: s.dataset_revision, profile: s.profile, options: (s.options ?? {}) as Record<string, unknown> };
    metas.set(id, meta);
    if (metas.size > 200) metas.delete(metas.keys().next().value!);
  }
  return meta;
}

export type Eligibility =
  | { eligible: true; snapshotId: string; deployment: string; identity: NonNullable<ReturnType<typeof deploymentIdentity>> }
  | { eligible: false; reason: GeometryReason; message: string };

const REFUSALS: Record<GeometryReason, string> = {
  estimated_travel: "This run used estimated travel (straight line × circuity), so there is no road geometry.",
  imported_matrix: "This run used an imported matrix, not Valhalla, so there is no road geometry.",
  provider_context_mismatch: "This server's Valhalla differs from the one that built the run's matrix (version, dataset, graph or costing), so its roads would not describe the same legs.",
  valhalla_not_configured: "Valhalla is not configured on this server, so road geometry cannot be fetched.",
};

/** Hard context rule (requirement 1). Never fetches or draws geometry for estimated or imported runs. */
export function geometryEligibility(store: Store, summary: RunSummary, env: Record<string, string | undefined> = process.env): Eligibility {
  const no = (reason: GeometryReason): Eligibility => ({ eligible: false, reason, message: REFUSALS[reason] });
  const travel = summary.travel;
  const snapshotId = travel?.mode === "snapshot" ? travel.snapshot_id : null;
  if (!travel || !snapshotId) return no("estimated_travel");
  if (travel.provider === "haversine") return no("estimated_travel");
  if (travel.provider !== "valhalla") return no("imported_matrix");
  const meta = snapshotMeta(store, snapshotId);
  if (meta.provider !== "valhalla") return no(meta.provider === "haversine" ? "estimated_travel" : "imported_matrix");
  const identity = deploymentIdentity(env);
  if (!identity) return no("valhalla_not_configured");
  const same = identity.version === meta.version && identity.dataset_revision === meta.dataset && identity.costing === meta.profile
    && identity.graph_config_hash === meta.options.graph_config_hash && canonical(identity.costing_options) === canonical(meta.options.costing_options ?? null);
  if (!same) return no("provider_context_mismatch");
  return { eligible: true, snapshotId, deployment: contentHash(canonical(identity)), identity };
}

/** Cache key: run, truck, snapshot identity and deployment identity, content-addressed. */
export const geometryKey = (runId: string, truckId: string, snapshotId: string, deployment: string) =>
  contentHash(canonical({ v: GEOMETRY_VERSION, run: runId, truck: truckId, snapshot: snapshotId, deployment }));

/**
 * The truck's physical stops exactly as validated: the depot, then each visit's location in `sequence` order.
 * Open routes have no return leg, and a stop is never reordered, merged or dropped.
 */
export function geometryRequest(store: Store, summary: RunSummary, truckId: string, snapshotId: string): RouteGeometryRequest {
  const truck = summary.trucks.find(t => t.id === truckId);
  if (!truck) throw new GeometryError(404, "truck_not_found", "No truck with this ID in the run.");
  const places = new Map(summary.locations.map(l => [l.id, l]));
  const stops = [{ id: summary.depot.id, lat: summary.depot.lat, lon: summary.depot.lon }];
  for (const visit of [...truck.visits].sort((a, b) => a.sequence - b.sequence)) {
    const place = places.get(visit.location_id);
    if (place?.lat == null || place.lon == null) throw new GeometryError(409, "stop_without_coordinates", `Stop ${visit.location_id} has no coordinates, so this truck's roads cannot be drawn.`);
    stops.push({ id: visit.location_id, lat: place.lat, lon: place.lon });
  }
  if (stops.length < 2) throw new GeometryError(409, "truck_without_stops", "This truck has no stops.");
  return { schema_version: 1, snapshot_id: snapshotId, snapshot: store.travelSnapshot(snapshotId) as unknown as Record<string, unknown>, truck_id: truckId, stops };
}

/** Posts to the optimizer's `/route-geometry` with the worker bearer token and a bounded wait. */
export async function callRouteGeometry(baseUrl: string, token: string, request: RouteGeometryRequest, timeoutMs = 120_000): Promise<RouteGeometryResponse> {
  let response: Response;
  try {
    response = await fetch(new URL("/route-geometry", baseUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new GeometryError(503, "geometry_service_unavailable", timedOut ? "The optimizer did not answer in time." : "The optimizer service is not running, so road geometry cannot be fetched right now.");
  }
  const body = await response.json().catch(() => null) as { detail?: { code?: string; reason?: GeometryReason; message?: string } } | RouteGeometryResponse | null;
  if (response.ok && body) return body as RouteGeometryResponse;
  const detail = (body as { detail?: unknown } | null)?.detail as { code?: string; reason?: GeometryReason; message?: string } | undefined;
  if (response.status === 409 && detail?.reason) throw new GeometryError(409, "geometry_unavailable", detail.message ?? REFUSALS[detail.reason], detail.reason);
  if (response.status === 502) throw new GeometryError(502, detail?.code ?? "provider_unavailable", detail?.message ?? "Valhalla did not answer.");
  if (response.status === 422 && detail?.code) throw new GeometryError(409, detail.code, detail.message ?? "The optimizer refused this request.");
  throw new GeometryError(503, "geometry_service_unavailable", `The optimizer answered HTTP ${response.status}.`);
}

export type { GeometryLeg, RouteGeometryResponse };
