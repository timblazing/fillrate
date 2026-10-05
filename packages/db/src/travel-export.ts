// Downloads of stored directed travel snapshots (spec §7, M7): the canonical JSON whose sha256 is the identity,
// a long-form CSV, and a run's matrix with the node binding it used. Raw provider values are never altered in the
// JSON; the CSV states meters and seconds, converted exactly as the worker converts them.
import { canonical } from "./canonical";
import { roundHalfEven, snapshotIdentity, type TravelSnapshot } from "./travel";

export const MATRIX_EXPORT_VERSION = 1;
/** Run matrix exports refuse anything larger (413). Stored snapshots are already bounded lower. */
export const MAX_EXPORT_NODES = 2_000;

const METERS: Record<TravelSnapshot["distance_units"], number> = { meters: 1, kilometers: 1000, miles: 1_609.344 };
const SECONDS: Record<TravelSnapshot["duration_units"], number> = { seconds: 1, minutes: 60 };

/** The exact bytes that were hashed: `sha256(snapshotCanonicalJson(s)) === snapshotIdentity(s)`. */
export const snapshotCanonicalJson = (snapshot: TravelSnapshot) => canonical(snapshot);

const cell = (value: string) => (/[",\n\r]/.test(value) || /^[=+\-@]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

/**
 * One row per directed pair in snapshot node order (diagonal included). Distances are integer meters (nearest,
 * ties to even, the value a run uses); durations are seconds. A missing edge is two empty cells, never zero.
 */
export function snapshotCsv(snapshot: TravelSnapshot) {
  const meters = METERS[snapshot.distance_units], seconds = SECONDS[snapshot.duration_units];
  const ids = snapshot.nodes.map(n => cell(n.id));
  const rows = ["from_id,to_id,distance_m,duration_s"];
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
    const d = snapshot.distances[i][j], t = snapshot.durations[i][j];
    rows.push(`${ids[i]},${ids[j]},${d === null ? "" : roundHalfEven(d * meters)},${t === null ? "" : t * seconds}`);
  }
  return rows.join("\r\n") + "\r\n";
}

export type BindingInput = { id: string; label?: string; lat: number | null; lon: number | null };

/** The snapshot a run used, with how each scenario node (depot first, then located stops by ID) maps onto it. */
export function runMatrixJson(runId: string, snapshot: TravelSnapshot, depot: BindingInput, locations: BindingInput[]) {
  const index = new Map(snapshot.nodes.map((n, i) => [n.id, i]));
  const bind = (role: "depot" | "stop", node: BindingInput) => {
    const at = index.get(node.id);
    const have = at === undefined ? null : snapshot.nodes[at];
    return {
      id: node.id, role, label: node.label ?? node.id, lat: node.lat, lon: node.lon, snapshot_index: at ?? null,
      in_snapshot: at !== undefined, coordinates_match: have !== null && have.lat === node.lat && have.lon === node.lon,
    };
  };
  const stops = locations.filter(l => l.lat !== null && l.lon !== null && l.id !== depot.id).sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    schema_version: MATRIX_EXPORT_VERSION, kind: "fillrate.run-matrix", run_id: runId,
    snapshot_id: snapshotIdentity(snapshot),
    units: { distance: snapshot.distance_units, duration: snapshot.duration_units, note: "Raw provider values as stored; a run rounds distances to integer meters (nearest, ties to even)." },
    binding: [bind("depot", depot), ...stops.map(s => bind("stop", s))],
    snapshot,
  };
}
