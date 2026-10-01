import type { ScenarioDocument } from "@fillrate/contracts";

/** Submission policy, mirrored in fillrate_optimizer/preflight.py. */
export type PreflightCheck = "missing_coordinates" | "far_from_depot" | "oversize_stop" | "approximate_coordinates";
export type PreflightFinding = { check: PreflightCheck; action: "block" | "warn"; location_ids: string[]; line_ids: string[]; message: string };
export type PreflightSettings = {
  trailer_capacity?: number;
  travel_circuity?: number;
  max_leg_m?: number;
  excluded_line_ids?: string[];
  preflight?: Partial<Record<Exclude<PreflightCheck, "approximate_coordinates">, "block" | "warn">>;
};
const EARTH_RADIUS_M = 6_371_008.8;
const FIVE_HUNDRED_MILES_M = 804_672;
const rad = (degrees: number) => degrees * Math.PI / 180;
function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
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
    const far = !missing && Math.round(distanceM(scenario.depot, { lat: loc.lat!, lon: loc.lon! }) * (settings.travel_circuity ?? 1.2)) > (settings.max_leg_m ?? FIVE_HUNDRED_MILES_M);
    for (const line of active) {
      if (missing) add("missing_coordinates", loc.id, line.id);
      if (far) add("far_from_depot", loc.id, line.id);
      if (!missing && loc.coordinate_source === "zcta") add("approximate_coordinates", loc.id, line.id);
      const product = products.get(line.product_id);
      if (!product) throw new Error(`Unknown product: ${line.product_id}`);
      const group = grouped.get(loc.id) ?? { ids: [], load: 0 };
      group.ids.push(line.id);
      group.load += line.ordered_pieces * (line.linear_feet_per_piece ?? product.linear_feet_per_piece);
      grouped.set(loc.id, group);
    }
  }
  for (const [id, group] of grouped) if (group.load > (settings.trailer_capacity ?? 5300)) {
    for (const lineId of group.ids) add("oversize_stop", id, lineId);
  }
  return (["missing_coordinates", "far_from_depot", "oversize_stop", "approximate_coordinates"] as const).flatMap(check => {
    const hits = found.get(check);
    if (!hits?.size) return [];
    const line_ids = [...hits.values()].flat().sort();
    const location_ids = [...hits.keys()].sort();
    return [{ check, action: check === "approximate_coordinates" ? "warn" as const : (settings.preflight?.[check] ?? "block"), location_ids, line_ids, message: `${check}: ${line_ids.length} line(s) at ${location_ids.length} location(s).` }];
  });
}
