// M5 geocoding (spec §6): Census batch and one-line address geocoding, a ZIP/ZCTA approximate
// fallback from the bundled Gazetteer lookup, a shared cache, and durable geocoding jobs that save
// their result as a new scenario version. Coordinates the user supplied win unless they ask to
// re-geocode; a failed lookup never replaces a coordinate, and nothing is ever placed at (0, 0).
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import type { ScenarioDocument } from "@fillrate/contracts";
import { canonical } from "./canonical";
import { csvRecords } from "./imports";
import { contentHash, OPERATOR, type Store } from "./index";
import { saveScenario, scenarioVersion, type ScenarioMetadata } from "./scenarios";

export const CENSUS_BENCHMARK = "Public_AR_Current";
/** Census batch requests accept at most 10,000 addresses. */
export const CENSUS_BATCH_LIMIT = 10_000;
export const ZCTA_DATASET = "zcta-gazetteer-2024";

type Location = ScenarioDocument["locations"][number];
type GeocodeMatch = NonNullable<Location["geocode"]>;
type Fetch = typeof fetch;

export type GeocodeConfig = {
  /** Census geocoder base URL (…/geocoder), or null when address geocoding is turned off. */
  census: { url: string; batchSize: number; timeoutMs: number } | null;
  /** Path to the ZCTA lookup; the fallback is unavailable when it is null or missing. */
  zctaPath: string | null;
  fetch?: Fetch;
  now?: () => Date;
};

/** Environment: FILLRATE_GEOCODER=off, CENSUS_GEOCODER_URL, GEOCODE_BATCH_SIZE, ZCTA_LOOKUP_PATH. */
export function geocodeConfig(env: Record<string, string | undefined>, defaultZctaPath: string): GeocodeConfig {
  const batch = Math.min(CENSUS_BATCH_LIMIT, Math.max(1, Number(env.GEOCODE_BATCH_SIZE ?? 1000) || 1000));
  const census = env.FILLRATE_GEOCODER === "off" ? null : { url: (env.CENSUS_GEOCODER_URL ?? "https://geocoding.geo.census.gov/geocoder").replace(/\/$/, ""), batchSize: batch, timeoutMs: 15 * 60_000 };
  const zctaPath = env.ZCTA_LOOKUP_PATH ?? defaultZctaPath;
  return { census, zctaPath: zctaPath && existsSync(zctaPath) ? zctaPath : null };
}

export type GeocodeCapabilities = { census: { benchmark: string; batch_limit: number } | null; zcta: { dataset: string } | null };
export const geocodeCapabilities = (config: GeocodeConfig): GeocodeCapabilities => ({
  census: config.census ? { benchmark: CENSUS_BENCHMARK, batch_limit: config.census.batchSize } : null,
  zcta: config.zctaPath ? { dataset: ZCTA_DATASET } : null,
});

// ---- Addresses and the ZCTA lookup ------------------------------------------------------------------

/** Cache identity for an address: Unicode-normalized, whitespace collapsed, upper case. */
export const normalizeAddress = (address: string) => address.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();

/**
 * The trailing 5-digit ZIP (or ZIP+4) of a one-line US address, optionally followed by the country.
 * Only the end of the address counts, so a 5-digit house number is never read as a ZIP.
 */
export function zipFromAddress(address: string): string | null {
  const m = /(?:^|[\s,])(\d{5})(?:-\d{4})?\s*(?:,?\s*(?:USA|US|U\.S\.A?\.?|UNITED STATES(?: OF AMERICA)?))?\s*$/i.exec(address.trim());
  return m ? m[1] : null;
}

const zctaLookups = new Map<string, Map<string, [number, number]>>();
/** The bundled lookup written by `python -m fillrate_optimizer.zcta`, checked against its dataset name. */
export function loadZcta(path: string) {
  let points = zctaLookups.get(path);
  if (points) return points;
  const lines = readFileSync(path, "utf8").split("\n");
  if (!lines[0]?.startsWith(`# ${ZCTA_DATASET} `) || lines[1] !== "zcta\tlat\tlon") throw new Error(`ZCTA lookup ${path} is not ${ZCTA_DATASET}.`);
  points = new Map();
  for (const line of lines.slice(2)) {
    if (!line) continue;
    const [code, lat, lon] = line.split("\t");
    points.set(code, [Number(lat), Number(lon)]);
  }
  zctaLookups.set(path, points);
  return points;
}

// ---- Census ----------------------------------------------------------------------------------------

/** One cached Census answer. `match` null means Census returned no match (or a tie). */
type CensusResult = { match: "exact" | "non_exact" | null; status: string; lat: number | null; lon: number | null; matched_address: string | null };

// Answers are cached per owner (spec §14): another account's lookups never show up as cache hits. The
// operator / local dataset keeps the unprefixed keys it had before hosted accounts.
const cacheKey = (address: string, mode: "batch" | "oneline", scope: string) => {
  const key = createHash("sha256").update(canonical({ address, provider: "census", benchmark: CENSUS_BENCHMARK, mode })).digest("hex");
  return scope === "operator" ? key : `${scope}|${key}`;
};

function storeRaw(store: Store, text: string) {
  const bytes = Buffer.from(text, "utf8"), hash = contentHash(bytes);
  store.sqlite.prepare("INSERT OR IGNORE INTO artifacts (hash, compressed, byteLength) VALUES (?,?,?)").run(hash, gzipSync(bytes), bytes.length);
  return hash;
}

function cached(store: Store, address: string, mode: "batch" | "oneline", scope: string) {
  const row = store.sqlite.prepare("SELECT result, responseRef, createdAt FROM geocode_cache WHERE key=?").get(cacheKey(address, mode, scope)) as { result: string; responseRef: string | null; createdAt: number } | undefined;
  return row ? { ...(JSON.parse(row.result) as CensusResult), responseRef: row.responseRef, at: row.createdAt } : null;
}

function remember(store: Store, address: string, mode: "batch" | "oneline", result: CensusResult, responseRef: string, at: number, scope: string) {
  store.sqlite.prepare("INSERT OR REPLACE INTO geocode_cache (key, provider, dataset, address, result, responseRef, createdAt) VALUES (?,?,?,?,?,?,?)")
    .run(cacheKey(address, mode, scope), "census", CENSUS_BENCHMARK, address, canonical(result), responseRef, at);
}

/** Batch response rows: id, input, Match|No_Match|Tie, Exact|Non_Exact, matched address, "lon,lat", TIGER id, side. */
export function parseCensusBatch(text: string): Map<string, CensusResult> {
  const out = new Map<string, CensusResult>();
  for (const { cells } of csvRecords(text, Infinity)) {
    const [id, , status = "", type = "", matched = "", point = ""] = cells.map(c => c.trim());
    const [lon, lat] = point.split(",").map(Number);
    const ok = status === "Match" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
    out.set(id, ok
      ? { match: type === "Exact" ? "exact" : "non_exact", status, lat, lon, matched_address: matched || null }
      : { match: null, status: status || "No_Match", lat: null, lon: null, matched_address: null });
  }
  return out;
}

const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;

async function censusBatch(config: GeocodeConfig, addresses: string[]) {
  const census = config.census!;
  // The full one-line address goes in the street field; Census parses it (city/state/ZIP left blank).
  const body = addresses.map((a, i) => `${i},${quote(a)},,,`).join("\n") + "\n";
  const form = new FormData();
  form.append("addressFile", new Blob([body], { type: "text/csv" }), "addresses.csv");
  form.append("benchmark", CENSUS_BENCHMARK);
  const response = await (config.fetch ?? fetch)(`${census.url}/locations/addressbatch`, { method: "POST", body: form, signal: AbortSignal.timeout(census.timeoutMs) });
  if (!response.ok) throw new Error(`The Census batch geocoder returned HTTP ${response.status}.`);
  const text = await response.text();
  const parsed = parseCensusBatch(text);
  if (![...parsed.keys()].every(id => /^\d+$/.test(id) && Number(id) < addresses.length)) throw new Error("The Census batch geocoder returned an unexpected response.");
  return { text, results: addresses.map((_, i) => parsed.get(String(i)) ?? { match: null, status: "Missing", lat: null, lon: null, matched_address: null }) };
}

/** One manual address (spec §6: single entries use the one-line endpoint). Cached like batch results. */
export async function geocodeOneLine(store: Store, config: GeocodeConfig, address: string, fallback: "zcta" | "off" = "zcta", scope = "operator") {
  const normalized = normalizeAddress(address);
  if (!normalized || normalized.length > 500) throw new Error("Enter an address of 1–500 characters.");
  const now = (config.now ?? (() => new Date()))();
  let hit = config.census ? cached(store, normalized, "oneline", scope) : null;
  if (config.census && !hit) {
    const url = `${config.census.url}/locations/onelineaddress?${new URLSearchParams({ address: normalized, benchmark: CENSUS_BENCHMARK, format: "json" })}`;
    const response = await (config.fetch ?? fetch)(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`The Census geocoder returned HTTP ${response.status}.`);
    const text = await response.text();
    const matches = (JSON.parse(text) as { result?: { addressMatches?: { coordinates?: { x?: number; y?: number }; matchedAddress?: string }[] } }).result?.addressMatches ?? [];
    const first = matches.length === 1 ? matches[0] : null;
    const lat = first?.coordinates?.y, lon = first?.coordinates?.x;
    // The one-line endpoint does not report exact vs non-exact; more than one match is a tie.
    const result: CensusResult = typeof lat === "number" && typeof lon === "number"
      ? { match: "non_exact", status: "Match", lat, lon, matched_address: first?.matchedAddress ?? null }
      : { match: null, status: matches.length > 1 ? "Tie" : "No_Match", lat: null, lon: null, matched_address: null };
    const ref = storeRaw(store, text);
    remember(store, normalized, "oneline", result, ref, now.getTime(), scope);
    hit = { ...result, responseRef: ref, at: now.getTime() };
  }
  if (hit && hit.lat !== null && hit.lon !== null) {
    return { lat: hit.lat, lon: hit.lon, coordinate_source: "census" as const, geocode: censusMatch(hit, null) };
  }
  const approximate = fallback === "zcta" ? zctaPoint(config, address, now) : null;
  return approximate ?? { lat: null, lon: null, coordinate_source: "unresolved" as const, geocode: null, status: hit?.status ?? "Unavailable" };
}

function censusMatch(hit: CensusResult & { responseRef: string | null; at: number }, matchType: GeocodeMatch["match_type"] | undefined): GeocodeMatch {
  return { provider: "census", dataset: CENSUS_BENCHMARK, match_type: matchType === undefined ? hit.match : matchType, matched_address: hit.matched_address, zcta: null, response_ref: hit.responseRef, resolved_at: new Date(hit.at).toISOString() };
}

function zctaPoint(config: GeocodeConfig, address: string, now: Date) {
  if (!config.zctaPath) return null;
  const zip = zipFromAddress(address);
  const point = zip ? loadZcta(config.zctaPath).get(zip) : undefined;
  if (!zip || !point) return null;
  const geocode: GeocodeMatch = { provider: "zcta", dataset: ZCTA_DATASET, match_type: null, matched_address: null, zcta: zip, response_ref: null, resolved_at: now.toISOString() };
  return { lat: point[0], lon: point[1], coordinate_source: "zcta" as const, geocode };
}

// ---- Resolving a scenario ----------------------------------------------------------------------------

export type GeocodeOptions = {
  /** ZIP/ZCTA approximate fallback for addresses Census cannot match (default on, with a review warning). */
  fallback: "zcta" | "off";
  /** Also re-geocode locations whose coordinates were imported or geocoded before. Manual placements are kept. */
  regeocode: boolean;
};
export type GeocodeReport = {
  targets: number; addresses: number; cached: number; requested: number; batches: number;
  census_exact: number; census_non_exact: number; zcta: number; unresolved: number;
  /** Of the unresolved: no ZIP at the end of the address, or a ZIP with no ZCTA (PO-box-only or unique ZIPs). */
  no_zip: number; zip_without_zcta: number;
  /** Re-geocoding found nothing, so the earlier coordinate was kept. */
  kept: number;
  census: "used" | "off"; fallback_dataset: string | null;
};
export type GeocodeProgress = { done: number; total: number };

export function parseGeocodeOptions(input: unknown): GeocodeOptions {
  const v = (input ?? {}) as Partial<GeocodeOptions>;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error("invalid_geocode_options");
  const fallback = v.fallback ?? "zcta", regeocode = v.regeocode ?? false;
  if ((fallback !== "zcta" && fallback !== "off") || typeof regeocode !== "boolean" || Object.keys(v).some(k => k !== "fallback" && k !== "regeocode")) throw new Error("invalid_geocode_options");
  return { fallback, regeocode };
}

/**
 * Resolves a document's addresses. Census first (cached, then batched in chunks of at most 10,000),
 * then the ZCTA fallback when allowed. A location that moves keeps its first coordinate in `original`.
 */
export async function geocodeDocument(store: Store, config: GeocodeConfig, doc: ScenarioDocument, options: GeocodeOptions, onProgress: (p: GeocodeProgress) => void = () => {}, scope = "operator") {
  const now = (config.now ?? (() => new Date()))();
  const out = structuredClone(doc);
  const targets = out.locations.filter(l => l.address?.trim() && (l.coordinate_source === "unresolved" || (options.regeocode && l.coordinate_source !== "manual")));
  const addresses = [...new Set(targets.map(l => normalizeAddress(l.address!)))];
  const report: GeocodeReport = { targets: targets.length, addresses: addresses.length, cached: 0, requested: 0, batches: 0, census_exact: 0, census_non_exact: 0, zcta: 0, unresolved: 0, no_zip: 0, zip_without_zcta: 0, kept: 0, census: config.census ? "used" : "off", fallback_dataset: options.fallback === "zcta" && config.zctaPath ? ZCTA_DATASET : null };
  const results = new Map<string, CensusResult & { responseRef: string | null; at: number }>();
  if (config.census) {
    const misses: string[] = [];
    for (const a of addresses) { const hit = cached(store, a, "batch", scope); if (hit) { results.set(a, hit); report.cached++; } else misses.push(a); }
    onProgress({ done: report.cached, total: addresses.length });
    for (let i = 0; i < misses.length; i += config.census.batchSize) {
      const chunk = misses.slice(i, i + config.census.batchSize);
      const { text, results: answers } = await censusBatch(config, chunk);
      const ref = storeRaw(store, text), at = Date.now();
      store.sqlite.transaction(() => chunk.forEach((a, j) => remember(store, a, "batch", answers[j], ref, at, scope)))();
      chunk.forEach((a, j) => results.set(a, { ...answers[j], responseRef: ref, at }));
      report.requested += chunk.length; report.batches++;
      onProgress({ done: report.cached + report.requested, total: addresses.length });
    }
  }
  for (const loc of targets) {
    const hit = results.get(normalizeAddress(loc.address!));
    const next = hit && hit.lat !== null && hit.lon !== null
      ? { lat: hit.lat, lon: hit.lon, coordinate_source: "census" as const, geocode: censusMatch(hit, undefined) }
      : options.fallback === "zcta" ? zctaPoint(config, loc.address!, now) : null;
    if (!next) {
      if (loc.coordinate_source === "unresolved") {
        report.unresolved++;
        const zip = zipFromAddress(loc.address!);
        if (!zip) report.no_zip++;
        else if (config.zctaPath && options.fallback === "zcta") report.zip_without_zcta++;
      } else report.kept++;
      continue;
    }
    if (next.coordinate_source === "census") report[next.geocode.match_type === "exact" ? "census_exact" : "census_non_exact"]++;
    else report.zcta++;
    if (loc.coordinate_source !== "unresolved" && !loc.original) loc.original = { lat: loc.lat, lon: loc.lon, coordinate_source: loc.coordinate_source, geocode: loc.geocode ?? null };
    Object.assign(loc, next);
  }
  return { document: out, report };
}

// ---- Durable jobs ----------------------------------------------------------------------------------

export type GeocodeJob = {
  id: string; versionId: string; status: "queued" | "running" | "succeeded" | "failed";
  options: GeocodeOptions; progress: GeocodeProgress | null; report: GeocodeReport | null;
  resultVersionId: string | null; resultScenarioId: string | null; branched: boolean; error: string | null; createdAt: number; updatedAt: number;
};

export function createGeocodeJob(store: Store, input: { versionId: string; options: unknown; author: string; metadata: ScenarioMetadata; ownerId?: string }) {
  const ownerId = input.ownerId ?? OPERATOR;
  if (!input.author?.trim() || input.author.length > 100) throw new Error("invalid_author");
  const options = parseGeocodeOptions(input.options);
  return store.sqlite.transaction(() => {
    if (!store.sqlite.prepare("SELECT 1 FROM scenario_sources WHERE versionId=?").get(input.versionId) || store.versionOwner(input.versionId) !== ownerId) throw new Error("version_not_found");
    const id = randomUUID(), now = Date.now();
    store.sqlite.prepare("INSERT INTO geocode_jobs (id, versionId, status, options, author, metadata, createdAt, updatedAt, ownerId) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, input.versionId, "queued", canonical(options), input.author.trim(), canonical(input.metadata), now, now, ownerId);
    return { id, created: true };
  }).immediate();
}

/** One owner's job; another owner's ID reads as missing. */
export function geocodeJob(store: Store, id: string, ownerId = OPERATOR): GeocodeJob | null {
  const row = store.sqlite.prepare("SELECT j.*, v.scenarioId AS resultScenarioId FROM geocode_jobs j LEFT JOIN scenario_versions v ON v.id=j.resultVersionId WHERE j.id=?").get(id) as Record<string, unknown> | undefined;
  if (!row || row.ownerId !== ownerId) return null;
  const json = <T>(v: unknown) => (typeof v === "string" ? JSON.parse(v) as T : null);
  return { id: row.id as string, versionId: row.versionId as string, status: row.status as GeocodeJob["status"], options: json<GeocodeOptions>(row.options)!, progress: json(row.progress), report: json(row.report), resultVersionId: (row.resultVersionId as string) ?? null, resultScenarioId: (row.resultScenarioId as string) ?? null, branched: Boolean(row.branched), error: (row.error as string) ?? null, createdAt: row.createdAt as number, updatedAt: row.updatedAt as number };
}

/** A server restart interrupts in-process jobs. Matches already received stay cached for the retry. */
export function failInterruptedGeocodeJobs(store: Store) {
  return store.sqlite.prepare("UPDATE geocode_jobs SET status='failed', error=?, updatedAt=? WHERE status IN ('queued','running')")
    .run("The server restarted before geocoding finished. Start it again; matches already received are cached.", Date.now()).changes;
}

/**
 * Runs one queued job to completion. The result is saved as the next version of the scenario, or as
 * a branch from the geocoded version if someone saved a newer version meanwhile (never an overwrite).
 */
export async function runGeocodeJob(store: Store, config: GeocodeConfig, id: string) {
  const claim = store.sqlite.prepare("UPDATE geocode_jobs SET status='running', updatedAt=? WHERE id=? AND status='queued'").run(Date.now(), id);
  const row = store.sqlite.prepare("SELECT versionId, options, author, metadata, ownerId FROM geocode_jobs WHERE id=?").get(id) as { versionId: string; options: string; author: string; metadata: string; ownerId: string };
  if (!claim.changes) return geocodeJob(store, id, row?.ownerId);
  const set = (sql: string, ...args: unknown[]) => store.sqlite.prepare(`UPDATE geocode_jobs SET ${sql}, updatedAt=? WHERE id=? AND status='running'`).run(...args, Date.now(), id);
  try {
    const scenarioId = (store.sqlite.prepare("SELECT scenarioId FROM scenario_versions WHERE id=?").get(row.versionId) as { scenarioId: string }).scenarioId;
    const version = scenarioVersion(store, scenarioId, row.versionId, row.ownerId);
    const options = JSON.parse(row.options) as GeocodeOptions;
    const { document, report } = await geocodeDocument(store, config, version.document, options, p => set("progress=?", canonical(p)), row.ownerId);
    if ((store.sqlite.prepare("SELECT status FROM geocode_jobs WHERE id=?").get(id) as { status: string }).status === "cancelled") return geocodeJob(store, id, row.ownerId);
    const prior = (version.source ?? {}) as { geocoding?: unknown[] };
    const source = { ...prior, geocoding: [...(Array.isArray(prior.geocoding) ? prior.geocoding : []), { job: id, options, report }] };
    const save = (branch: boolean) => saveScenario(store, { document, author: row.author, metadata: JSON.parse(row.metadata), source, scenarioId, expectedVersionId: row.versionId, branch, ownerId: row.ownerId });
    let branch = false, saved: ReturnType<typeof save>;
    try { saved = save(false); }
    catch (error) { if ((error as Error).message !== "version_conflict") throw error; branch = true; saved = save(true); }
    set("status='succeeded', report=?, resultVersionId=?, branched=?", canonical(report), saved.versionId, branch ? 1 : 0);
  } catch (error) {
    set("status='failed', error=?", error instanceof Error ? error.message : String(error));
  }
  return geocodeJob(store, id, row.ownerId);
}
