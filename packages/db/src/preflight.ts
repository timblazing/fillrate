import type { ScenarioDocument } from "@fillrate/contracts";
import { bindingMessage, bindNodes, effectiveMeters, reachableFromDepot, stopNodes, type TravelSnapshot } from "./travel";

/** Submission policy, mirrored in fillrate_optimizer/preflight.py. */
export type PreflightCheck = "missing_coordinates" | "far_from_depot" | "oversize_stop" | "far_via_stop" | "approximate_coordinates";
/** Never block (round two: a far stop reachable through another stop warns). */
const WARN_ONLY = new Set<PreflightCheck>(["far_via_stop"]);
export type PreflightFinding = { check: PreflightCheck; action: "block" | "warn"; location_ids: string[]; line_ids: string[]; message: string };
export type PreflightSettings = {
  trailer_capacity?: number;
  travel_circuity?: number;
  max_leg_m?: number;
  /** Identity of the selected directed travel snapshot; the caller must then pass that snapshot. */
  travel_snapshot_id?: string | null;
  excluded_line_ids?: string[];
  preflight?: Partial<Record<Exclude<PreflightCheck, "far_via_stop">, "block" | "warn">>;
};
/** The trailer capacity stops are checked against (mirrors RunSettings.trailer_capacity). */
export const largestCapacity = (settings: Pick<PreflightSettings, "trailer_capacity">) => settings.trailer_capacity ?? 5300;
const EARTH_RADIUS_M = 6_371_008.8;
const FIVE_HUNDRED_MILES_M = 804_672;
const rad = (degrees: number) => degrees * Math.PI / 180;
function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
const DEFAULT_POLICY = { missing_coordinates: "block", far_from_depot: "block", oversize_stop: "warn", approximate_coordinates: "warn" } as const;
/** Locations reachable from the depot through a chain of drives each within the leg limit. */
function reachableViaStops(depot: { lat: number; lon: number }, points: Map<string, { lat: number; lon: number }>, maxLeg: number, circuity: number) {
  const seen = new Set<string>();
  const frontier = [depot];
  while (frontier.length) {
    const from = frontier.pop()!;
    for (const [id, to] of points) if (!seen.has(id) && Math.round(distanceM(from, to) * circuity) <= maxLeg) { seen.add(id); frontier.push(to); }
  }
  return seen;
}
/**
 * Stops that carry demand and have coordinates: what a travel snapshot must describe for this run
 * (the pipeline's allocated stops are a subset). The same set preflight.py checks.
 */
export function demandStops(scenario: ScenarioDocument, excludedLineIds: Iterable<string> = []) {
  const excluded = new Set(excludedLineIds);
  const locations = new Map(scenario.locations.map(x => [x.id, x]));
  const stops = new Map<string, { lat: number; lon: number }>();
  for (const order of scenario.orders) {
    const loc = locations.get(order.location_id);
    if (!loc || loc.lat === null || loc.lon === null || loc.coordinate_source === "unresolved") continue;
    if (order.lines.some(x => x.ordered_pieces > 0 && !excluded.has(x.id))) stops.set(loc.id, { lat: loc.lat, lon: loc.lon });
  }
  return stops;
}

function farStops(scenario: ScenarioDocument, points: Map<string, { lat: number; lon: number }>, maxLeg: number, circuity: number, snapshot?: TravelSnapshot) {
  if (!snapshot) {
    const far = new Set([...points].filter(([, to]) => Math.round(distanceM(scenario.depot, to) * circuity) > maxLeg).map(([id]) => id));
    return { far, chained: far.size ? reachableViaStops(scenario.depot, points, maxLeg, circuity) : new Set<string>() };
  }
  const nodes = stopNodes(scenario.depot, points);
  const meters = effectiveMeters(snapshot, nodes);
  const far = new Set(nodes.slice(1).filter((_, j) => !(meters[0][j + 1] >= 0 && meters[0][j + 1] <= maxLeg)).map(n => n.id));
  return { far, chained: new Set([...reachableFromDepot(meters, maxLeg)].filter(i => i > 0).map(i => nodes[i].id)) };
}

/**
 * Rejects a run whose scenario no longer matches the travel snapshot it selected: a stop the snapshot
 * lacks, or one whose coordinates were edited after the snapshot was taken (spec §7: coordinate edits
 * invalidate the matrix). Throws `travel_snapshot_stale` (or `travel_snapshot_nodes` for an ID clash).
 */
export function assertSnapshotBinding(scenario: ScenarioDocument, excludedLineIds: Iterable<string>, snapshot: TravelSnapshot) {
  const binding = bindNodes(snapshot, stopNodes(scenario.depot, demandStops(scenario, excludedLineIds)));
  if (binding.missing.length || binding.moved.length) throw Object.assign(new Error(`travel_snapshot_stale: ${bindingMessage(binding)}`), { binding });
}

/**
 * Policy checks for a submission. With a selected travel snapshot, "far" means the depot → stop leg is
 * missing or over the limit in that directed matrix, and "via stop" means a chain of allowed directed legs
 * reaches it; without one, legs are haversine × circuity (preflight.py mirrors both).
 */
export function preflightChecks(scenario: ScenarioDocument, settings: PreflightSettings = {}, snapshot?: TravelSnapshot): PreflightFinding[] {
  if (Boolean(settings.travel_snapshot_id) !== Boolean(snapshot)) throw new Error("travel_snapshot_required: the selected travel snapshot must be loaded for preflight");
  const locations = new Map(scenario.locations.map(x => [x.id, x]));
  const products = new Map(scenario.products.map(x => [x.id, x]));
  const allIds = new Set(scenario.orders.flatMap(x => x.lines.map(y => y.id)));
  const excluded = new Set(settings.excluded_line_ids ?? []);
  const unknown = [...excluded].filter(x => !allIds.has(x)).sort();
  if (unknown.length) throw new Error(`Unknown excluded line IDs: ${unknown.join(", ")}`);
  const found = new Map<PreflightCheck, Map<string, string[]>>();
  const grouped = new Map<string, { ids: string[]; load: number }>();
  const locatedLines = new Map<string, string[]>();
  const points = new Map<string, { lat: number; lon: number }>();
  const circuity = settings.travel_circuity ?? 1.2;
  const maxLeg = settings.max_leg_m ?? FIVE_HUNDRED_MILES_M;
  const add = (check: PreflightCheck, location: string, line: string) => {
    if (!found.has(check)) found.set(check, new Map());
    const at = found.get(check)!;
    at.set(location, [...(at.get(location) ?? []), line]);
  };
  for (const order of scenario.orders) {
    const loc = locations.get(order.location_id);
    if (!loc) throw new Error(`Unknown location: ${order.location_id}`);
    const active = order.lines.filter(x => x.ordered_pieces > 0 && !excluded.has(x.id));
    if (!active.length) continue;
    const missing = loc.lat === null || loc.lon === null || loc.coordinate_source === "unresolved";
    if (!missing) points.set(loc.id, { lat: loc.lat!, lon: loc.lon! });
    for (const line of active) {
      if (missing) add("missing_coordinates", loc.id, line.id);
      if (!missing) locatedLines.set(loc.id, [...(locatedLines.get(loc.id) ?? []), line.id]);
      if (!missing && loc.coordinate_source === "zcta") add("approximate_coordinates", loc.id, line.id);
      const product = products.get(line.product_id);
      if (!product) throw new Error(`Unknown product: ${line.product_id}`);
      const groupKey = JSON.stringify([loc.id, order.customer_id ?? order.id]);
      const group = grouped.get(groupKey) ?? { ids: [], load: 0 };
      group.ids.push(line.id);
      group.load += line.ordered_pieces * (line.linear_feet_per_piece ?? product.linear_feet_per_piece);
      grouped.set(groupKey, group);
    }
  }
  const { far, chained } = farStops(scenario, points, maxLeg, circuity, snapshot);
  for (const id of [...far].sort()) for (const lineId of locatedLines.get(id) ?? []) add(chained.has(id) ? "far_via_stop" : "far_from_depot", id, lineId);
  for (const [key, group] of grouped) if (group.load > largestCapacity(settings)) {
    const [id] = JSON.parse(key) as [string, string];
    for (const lineId of group.ids) add("oversize_stop", id, lineId);
  }
  return (["missing_coordinates", "far_from_depot", "oversize_stop", "far_via_stop", "approximate_coordinates"] as const).flatMap(check => {
    const hits = found.get(check);
    if (!hits?.size) return [];
    const line_ids = [...hits.values()].flat().sort();
    const location_ids = [...hits.keys()].sort();
    return [{ check, action: WARN_ONLY.has(check) ? "warn" as const : (settings.preflight?.[check as keyof typeof DEFAULT_POLICY] ?? DEFAULT_POLICY[check as keyof typeof DEFAULT_POLICY]), location_ids, line_ids, message: `${check}: ${line_ids.length} line(s) at ${location_ids.length} location(s).` }];
  });
}
