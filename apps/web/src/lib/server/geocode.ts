import "server-only";
import { join } from "node:path";
import { createGeocodeJob, failInterruptedGeocodeJobs, geocodeCapabilities, geocodeConfig, geocodeJob, geocodeOneLine, runGeocodeJob, type GeocodeConfig } from "@fillrate/db/geocode";
import { validateMetadata } from "@fillrate/db/scenarios";
import { initializeDatabase } from "./database";
import { ApiError } from "./runs";

// Geocoding runs in the web process, off the request path: a POST queues a job and returns at once,
// and jobs run one at a time. Census needs no key (spec §14). ZCTA_LOOKUP_PATH defaults to the
// lookup that `python -m fillrate_optimizer.zcta` writes to data/ (the image bundles its own).
const state = globalThis as typeof globalThis & { fillrateGeocode?: { config: GeocodeConfig; queue: Promise<unknown> } };
function geocoder() {
  if (!state.fillrateGeocode) {
    const store = initializeDatabase();
    failInterruptedGeocodeJobs(store);
    state.fillrateGeocode = { config: geocodeConfig(process.env, join(process.cwd(), "../../data/zcta-gazetteer-2024.tsv")), queue: Promise.resolve() };
  }
  return state.fillrateGeocode;
}

export const capabilities = () => geocodeCapabilities(geocoder().config);

export function startGeocodeJob(body: { versionId?: unknown; options?: unknown; author?: unknown; metadata?: unknown }, idempotencyKey: string) {
  const g = geocoder(), store = initializeDatabase();
  const caps = geocodeCapabilities(g.config);
  if (!caps.census && !caps.zcta) throw new ApiError(503, "geocoding_unavailable", "Geocoding is turned off on this server and no ZIP lookup is installed.");
  if (typeof body.versionId !== "string") throw new ApiError(400, "invalid_request", "Send the versionId to geocode.", ["versionId"]);
  let job: { id: string; created: boolean };
  try { job = createGeocodeJob(store, { versionId: body.versionId, options: body.options, author: String(body.author ?? ""), metadata: validateMetadata(body.metadata as never), idempotencyKey }); }
  catch (error) {
    const code = error instanceof Error ? error.message : "error";
    if (code === "version_not_found") throw new ApiError(404, code, "No saved imported scenario version.");
    if (code === "idempotency_conflict") throw new ApiError(409, code, "This Idempotency-Key was already used for a different request.");
    if (code === "invalid_author") throw new ApiError(400, code, "Enter a display name (1–100 characters).", ["author"]);
    if (code === "invalid_geocode_options") throw new ApiError(400, code, "Options are fallback (zcta | off) and regeocode (boolean).", ["options"]);
    if (code === "invalid_idempotency_key") throw new ApiError(400, code, "Send an Idempotency-Key header (1–200 characters).");
    throw new ApiError(400, "invalid_request", "Check the version, author and metadata.");
  }
  if (job.created) g.queue = g.queue.then(() => runGeocodeJob(store, g.config, job.id)).catch(() => {});
  return geocodeJob(store, job.id)!;
}

export function readGeocodeJob(id: string) {
  const job = geocodeJob(initializeDatabase(), id);
  if (!job) throw new ApiError(404, "job_not_found", "No geocoding job with this ID.");
  return job;
}

export async function geocodeAddress(body: { address?: unknown; fallback?: unknown }) {
  const g = geocoder();
  if (typeof body.address !== "string") throw new ApiError(400, "invalid_request", "Send an address.", ["address"]);
  const fallback = body.fallback === "off" ? "off" : "zcta";
  try { return await geocodeOneLine(initializeDatabase(), g.config, body.address, fallback); }
  catch (error) { throw new ApiError(502, "geocoder_error", error instanceof Error ? error.message : "The geocoder did not answer."); }
}
