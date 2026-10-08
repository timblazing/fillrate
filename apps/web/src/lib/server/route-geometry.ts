import "server-only";
import type { Store } from "@fillrate/db";
import { callRouteGeometry, geometryEligibility, geometryKey, geometryRequest, GeometryError, type Eligibility, type RouteGeometryResponse } from "@fillrate/db/route-geometry";

import { workerToken } from "./database";
import { ApiError } from "./errors";
import { runDetail } from "./runs";

// Road geometry for inspected trucks (spec §4, §7). Display only: the plan was optimized on the recorded matrix.
const optimizerUrl = () => process.env.OPTIMIZER_URL ?? `http://127.0.0.1:${process.env.OPTIMIZER_PORT ?? 8000}`;

function asApiError(error: unknown): never {
  if (error instanceof GeometryError) {
    throw new ApiError(error.status, error.code, error.message, [], 0, error.reason ? { reason: error.reason } : {});
  }
  throw error;
}

function summaryOf(store: Store, runId: string) {
  const detail = runDetail(store, runId);
  if (detail.kind !== "pipeline" || detail.status !== "succeeded" || !detail.summary) throw new ApiError(409, "run_not_succeeded", "Only succeeded pipeline runs have routes to draw.");
  return detail.summary;
}

/** Eligibility plus the trucks whose geometry is cached; the page reads this without fetching anything. */
export function geometryStatus(store: Store, runId: string) {
  const summary = summaryOf(store, runId);
  const eligibility: Eligibility = geometryEligibility(store, summary);
  if (!eligibility.eligible) return { schema_version: 1, eligible: false as const, reason: eligibility.reason, message: eligibility.message, fetched_trucks: [] as string[] };
  return {
    schema_version: 1, eligible: true as const, reason: null, message: null,
    provider: eligibility.identity, snapshot_id: eligibility.snapshotId,
    fetched_trucks: store.routeGeometryTrucks(runId, eligibility.deployment),
  };
}

function eligibleOrRefuse(store: Store, runId: string) {
  const summary = summaryOf(store, runId);
  const eligibility = geometryEligibility(store, summary);
  if (!eligibility.eligible) throw new ApiError(409, "geometry_unavailable", eligibility.message, [], 0, { reason: eligibility.reason });
  return { summary, eligibility };
}

/** The cached geometry for one truck, or 404 `geometry_not_fetched`. */
export function cachedGeometry(store: Store, runId: string, truckId: unknown) {
  if (typeof truckId !== "string" || !truckId) throw new ApiError(400, "invalid_truck", "Send ?truck=<truck id>.", ["truck"]);
  const { summary, eligibility } = eligibleOrRefuse(store, runId);
  if (!summary.trucks.some(t => t.id === truckId)) throw new ApiError(404, "truck_not_found", "No truck with this ID in the run.", ["truck"]);
  const found = store.routeGeometry(geometryKey(runId, truckId, eligibility.snapshotId, eligibility.deployment));
  if (!found) throw new ApiError(404, "geometry_not_fetched", "Road geometry has not been fetched for this truck.");
  return found as RouteGeometryResponse;
}

/** Geometry for every truck of a run that has it cached, keyed by truck id; empty when ineligible. */
export function cachedGeometries(store: Store, runId: string): Map<string, RouteGeometryResponse> {
  const out = new Map<string, RouteGeometryResponse>();
  const summary = summaryOf(store, runId);
  const eligibility = geometryEligibility(store, summary);
  if (!eligibility.eligible) return out;
  for (const truckId of store.routeGeometryTrucks(runId, eligibility.deployment)) {
    const found = store.routeGeometry(geometryKey(runId, truckId, eligibility.snapshotId, eligibility.deployment));
    if (found) out.set(truckId, found as RouteGeometryResponse);
  }
  return out;
}

const inflight = new Map<string, Promise<RouteGeometryResponse>>();

/**
 * Fetches (or returns the cached) geometry for one truck. A concurrent request for the same key shares one fetch.
 */
export async function fetchGeometry(store: Store, runId: string, truckId: unknown) {
  if (typeof truckId !== "string" || !truckId) throw new ApiError(400, "invalid_truck", "Send { truck: <truck id> }.", ["truck"]);
  const { summary, eligibility } = eligibleOrRefuse(store, runId);
  if (!summary.trucks.some(t => t.id === truckId)) throw new ApiError(404, "truck_not_found", "No truck with this ID in the run.", ["truck"]);
  const key = geometryKey(runId, truckId, eligibility.snapshotId, eligibility.deployment);
  const cached = store.routeGeometry(key);
  if (cached) return { geometry: cached as RouteGeometryResponse, cached: true };
  const running = inflight.get(key);
  if (running) return { geometry: await running, cached: true };
  const work = Promise.resolve().then(async () => {
    try {
      const request = geometryRequest(store, summary, truckId, eligibility.snapshotId);
      const result = await callRouteGeometry(optimizerUrl(), workerToken(), request);
      store.saveRouteGeometry({ key, runId, truckId, snapshotId: eligibility.snapshotId, deployment: eligibility.deployment }, result);
      return result;
    } catch (error) {
      return asApiError(error);
    } finally {
      inflight.delete(key);
    }
  });
  inflight.set(key, work);
  return { geometry: await work, cached: false };
}
