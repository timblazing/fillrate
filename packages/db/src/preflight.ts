import type { ScenarioDocument } from "@fillrate/contracts";

/** Submission policy, mirrored in fillrate_optimizer/preflight.py. */
export type PreflightCheck = "missing_coordinates" | "far_from_depot" | "oversize_stop" | "far_via_stop" | "approximate_coordinates";
/** Never block (round two: a far stop reachable through another stop warns). */
const WARN_ONLY = new Set<PreflightCheck>(["far_via_stop"]);
export type PreflightFinding = { check: PreflightCheck; action: "block" | "warn"; location_ids: string[]; line_ids: string[]; message: string };
export type PreflightSettings = {
  trailer_capacity?: number;
  travel_circuity?: number;
  max_leg_m?: number;
  excluded_line_ids?: string[];
  preflight?: Partial<Record<Exclude<PreflightCheck, "far_via_stop">, "block" | "warn">>;
};
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
export function preflightChecks(scenario: ScenarioDocument, settings: PreflightSettings = {}): PreflightFinding[] {
  const locations = new Map(scenario.locations.map(x => [x.id, x]));
  const products = new Map(scenario.products.map(x => [x.id, x]));
  const allIds = new Set(scenario.orders.flatMap(x => x.lines.map(y => y.id)));
  const excluded = new Set(settings.excluded_line_ids ?? []);
  const unknown = [...excluded].filter(x => !allIds.has(x)).sort();
  if (unknown.length) throw new Error(`Unknown excluded line IDs: ${unknown.join(", ")}`);
  const found = new Map<PreflightCheck, Map<string, string[]>>();
  const grouped = new Map<string, { ids: string[]; load: number }>();
  const farLines = new Map<string, string[]>();
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
    const far = !missing && Math.round(distanceM(scenario.depot, { lat: loc.lat!, lon: loc.lon! }) * circuity) > maxLeg;
    for (const line of active) {
      if (missing) add("missing_coordinates", loc.id, line.id);
      if (far) farLines.set(loc.id, [...(farLines.get(loc.id) ?? []), line.id]);
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
  if (farLines.size) {
    const chained = reachableViaStops(scenario.depot, points, maxLeg, circuity);
    for (const [id, lineIds] of farLines) for (const lineId of lineIds) add(chained.has(id) ? "far_via_stop" : "far_from_depot", id, lineId);
  }
  for (const [key, group] of grouped) if (group.load > (settings.trailer_capacity ?? 5300)) {
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
