// Immutable directed travel snapshots (spec §7, M6). Mirrors fillrate_optimizer/travel_provider.py:
// the same validation, the same canonical form and identity (sha256 of canonical JSON of the document
// with defaults filled), and the same single rounding (nearest integer, ties to even) to integer meters.
// The Python worker re-validates and re-hashes everything it loads, so these checks are not the only
// line of defense; the cross-language fixtures keep both implementations agreeing.
import { createHash } from "node:crypto";
import { canonical } from "./canonical";

export const MAX_SNAPSHOT_NODES = 1001;
export const MAX_TRAVEL_VALUE = 2 ** 40;
/** Decoded size bound for one stored snapshot (the Python artifact codec uses the same 64 MiB). */
export const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
export const CONVERSION = "nearest-integer-ties-to-even/v1";
const METERS_PER_MILE = 1_609.344;

export type TravelNode = { id: string; lat: number; lon: number };
export type TravelSnapshot = {
  schema_version: 1;
  nodes: TravelNode[];
  provider: "haversine" | "imported" | "valhalla";
  provider_version: string;
  dataset_revision: string;
  profile: string;
  options: Record<string, unknown>;
  distance_units: "meters" | "kilometers" | "miles";
  duration_units: "seconds" | "minutes";
  distances: (number | null)[][];
  durations: (number | null)[][];
  warnings: Record<string, unknown>[];
  conversion: typeof CONVERSION;
};

const fail = (detail: string): never => { throw new Error(`invalid_travel_snapshot: ${detail}`); };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const KEYS = ["schema_version", "nodes", "provider", "provider_version", "dataset_revision", "profile", "options", "distance_units", "duration_units", "distances", "durations", "warnings", "conversion"];

function text(value: unknown, name: string) {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) fail(`${name} must be a string of 1–200 characters`);
  return value as string;
}

/** Validates a snapshot document and returns it with defaults filled in, so its identity is stable. */
export function normalizeSnapshot(input: unknown): TravelSnapshot {
  if (!isObject(input)) return fail("a snapshot must be a JSON object");
  for (const key of Object.keys(input)) if (!KEYS.includes(key)) fail(`unknown field ${key}`);
  if (input.schema_version !== undefined && input.schema_version !== 1) fail("schema_version must be 1");
  if (input.conversion !== undefined && input.conversion !== CONVERSION) fail(`conversion must be ${CONVERSION}`);
  if (!Array.isArray(input.nodes) || input.nodes.length < 1 || input.nodes.length > MAX_SNAPSHOT_NODES) fail(`nodes must list 1–${MAX_SNAPSHOT_NODES} entries`);
  const nodes = (input.nodes as unknown[]).map((raw, i): TravelNode => {
    if (!isObject(raw) || Object.keys(raw).some(k => !["id", "lat", "lon"].includes(k))) return fail(`nodes[${i}] must be {id, lat, lon}`);
    const { lat, lon } = raw;
    if (typeof lat !== "number" || !Number.isFinite(lat) || lat < -90 || lat > 90) fail(`nodes[${i}].lat must be a number from -90 to 90`);
    if (typeof lon !== "number" || !Number.isFinite(lon) || lon < -180 || lon > 180) fail(`nodes[${i}].lon must be a number from -180 to 180`);
    return { id: text(raw.id, `nodes[${i}].id`), lat: lat as number, lon: lon as number };
  });
  if (new Set(nodes.map(n => n.id)).size !== nodes.length) fail("matrix node IDs must be unique");
  if (!["haversine", "imported", "valhalla"].includes(input.provider as string)) fail("provider must be haversine, imported or valhalla");
  if (!["meters", "kilometers", "miles"].includes(input.distance_units as string)) fail("distance_units must be meters, kilometers or miles");
  if (!["seconds", "minutes"].includes(input.duration_units as string)) fail("duration_units must be seconds or minutes");
  if (!isObject(input.options)) fail("options must be an object");
  const warnings = input.warnings ?? [];
  if (!Array.isArray(warnings) || !warnings.every(isObject)) fail("warnings must be a list of objects");
  const n = nodes.length;
  const matrix = (value: unknown, name: string) => {
    if (!Array.isArray(value) || value.length !== n) return fail(`${name} must be ${n}×${n}`);
    for (const [i, row] of (value as unknown[]).entries()) {
      if (!Array.isArray(row) || row.length !== n) fail(`${name} row ${i} must have ${n} entries`);
      for (const [j, cell] of (row as unknown[]).entries()) {
        if (cell === null) continue;
        if (typeof cell !== "number" || !Number.isFinite(cell) || cell < 0 || cell > MAX_TRAVEL_VALUE) fail(`${name}[${i}][${j}] must be null or a number from 0 to 2^40`);
      }
    }
    return value as (number | null)[][];
  };
  const distances = matrix(input.distances, "distances"), durations = matrix(input.durations, "durations");
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const d = distances[i][j], t = durations[i][j];
    if ((d === null) !== (t === null)) fail(`distance and duration reachability must agree at [${i}][${j}]`);
    if (i === j && (d !== 0 || t !== 0)) fail("matrix diagonal must be reachable with zero distance/time");
  }
  const snapshot: TravelSnapshot = {
    schema_version: 1, nodes, provider: input.provider as TravelSnapshot["provider"],
    provider_version: text(input.provider_version, "provider_version"), dataset_revision: text(input.dataset_revision, "dataset_revision"), profile: text(input.profile, "profile"),
    options: input.options as Record<string, unknown>, distance_units: input.distance_units as TravelSnapshot["distance_units"], duration_units: input.duration_units as TravelSnapshot["duration_units"],
    distances, durations, warnings: warnings as Record<string, unknown>[], conversion: CONVERSION,
  };
  try { canonical(snapshot.options); canonical(snapshot.warnings); } catch { fail("options and warnings must be plain JSON with safe numbers"); }
  return snapshot;
}

const identities = new WeakMap<TravelSnapshot, string>();
/** Content hash of the complete snapshot (coordinates, metadata, raw values): its immutable identity. */
export function snapshotIdentity(snapshot: TravelSnapshot) {
  let id = identities.get(snapshot);
  if (!id) { id = createHash("sha256").update(canonical(snapshot)).digest("hex"); identities.set(snapshot, id); }
  return id;
}

/** Records the identity of a snapshot read back from storage (its hash was verified on read). */
export function rememberIdentity(snapshot: TravelSnapshot, id: string) { identities.set(snapshot, id); }

/** Nearest integer, ties to even: Python's `round()`. */
export function roundHalfEven(x: number) {
  const floor = Math.floor(x), diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

export type Binding = { missing: string[]; moved: string[] };
/** Nodes the snapshot lacks, and nodes whose coordinates changed since the snapshot was taken. */
export function bindNodes(snapshot: TravelSnapshot, nodes: TravelNode[]): Binding {
  const known = new Map(snapshot.nodes.map(n => [n.id, n]));
  const missing: string[] = [], moved: string[] = [];
  for (const node of nodes) {
    const have = known.get(node.id);
    if (!have) missing.push(node.id);
    else if (have.lat !== node.lat || have.lon !== node.lon) moved.push(node.id);
  }
  return { missing: missing.sort(), moved: moved.sort() };
}

/** Integer meters between the requested nodes, in their order; -1 is a missing edge, never a large distance. */
export function effectiveMeters(snapshot: TravelSnapshot, nodes: TravelNode[]): number[][] {
  const { missing, moved } = bindNodes(snapshot, nodes);
  if (missing.length || moved.length) throw new Error(`travel_snapshot_stale: ${bindingMessage({ missing, moved })}`);
  const position = new Map(snapshot.nodes.map((n, i) => [n.id, i]));
  const at = nodes.map(n => position.get(n.id)!);
  const scale = snapshot.distance_units === "meters" ? 1 : snapshot.distance_units === "kilometers" ? 1000 : METERS_PER_MILE;
  return at.map(i => at.map(j => { const v = snapshot.distances[i][j]; return v === null ? -1 : roundHalfEven(v * scale); }));
}

export function bindingMessage({ missing, moved }: Binding) {
  const parts: string[] = [];
  if (missing.length) parts.push(`not in the snapshot: ${missing.slice(0, 5).join(", ")}`);
  if (moved.length) parts.push(`coordinates changed since the snapshot: ${moved.slice(0, 5).join(", ")}`);
  return parts.join("; ");
}

/** Depot first, then stops sorted by ID. Depot and stop IDs share one node namespace. */
export function stopNodes(depot: { id: string; lat: number; lon: number }, stops: Map<string, { lat: number; lon: number }>): TravelNode[] {
  if (stops.has(depot.id)) throw new Error(`travel_snapshot_nodes: depot ID "${depot.id}" is also a location ID`);
  return [{ id: depot.id, lat: depot.lat, lon: depot.lon }, ...[...stops.keys()].sort().map(id => ({ id, lat: stops.get(id)!.lat, lon: stops.get(id)!.lon }))];
}

/** Nodes reachable from node 0 over allowed directed legs (0 ≤ leg ≤ limit); -1 is a missing edge. */
export function reachableFromDepot(meters: number[][], maxLeg: number) {
  const seen = new Set([0]), frontier = [0];
  while (frontier.length) {
    const from = frontier.pop()!;
    for (let to = 0; to < meters.length; to++) if (!seen.has(to) && meters[from][to] >= 0 && meters[from][to] <= maxLeg) { seen.add(to); frontier.push(to); }
  }
  return seen;
}
