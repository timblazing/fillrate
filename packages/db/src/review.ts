// Data review (spec §6, M5): what an operator should check before saving or running a scenario.
// Pure and dependency-free so the import preview (server) and the workbench (browser) share it.
import type { ScenarioDocument } from "@fillrate/contracts";

export type CoordinateSource = ScenarioDocument["locations"][number]["coordinate_source"];
export const COORDINATE_SOURCES: CoordinateSource[] = ["imported", "census", "manual", "zcta", "unresolved"];

export type DataReview = {
  orders: number; lines: number; customers: number; products: number;
  /** Locations with at least one line that orders pieces. */
  locations: number;
  /** Those locations by coordinate source. */
  coordinates: Record<CoordinateSource, number>;
  /** Unresolved locations that keep an address (Census can try them) and those with none. */
  geocodable: number; noAddress: number;
  /** Census matches that were not exact (interpolated on a near-miss address). */
  censusNonExact: number;
  /** Locations corrected by hand, which keep their original coordinate and provenance. */
  corrected: number;
  /** Distinct locations sharing an identical coordinate with another location. */
  sharedCoordinates: number;
  zeroPieceLines: number; zeroValueLines: number;
  /** Products ordered beyond available stock, largest shortfall first. */
  shortProducts: { product_id: string; ordered: number; available: number }[];
  orderDates: { first: string; last: string } | null;
};

export function reviewScenario(doc: ScenarioDocument): DataReview {
  const coordinates = Object.fromEntries(COORDINATE_SOURCES.map(s => [s, 0])) as Record<CoordinateSource, number>;
  const ordered = new Map<string, number>();
  const active = new Set<string>(), customers = new Set<string>();
  let lines = 0, zeroPieceLines = 0, zeroValueLines = 0;
  for (const order of doc.orders) {
    customers.add(order.customer_id ?? order.id);
    for (const line of order.lines) {
      lines++;
      if (!line.ordered_pieces) zeroPieceLines++;
      else active.add(order.location_id);
      if (!line.net_value_per_piece_cents) zeroValueLines++;
      ordered.set(line.product_id, (ordered.get(line.product_id) ?? 0) + line.ordered_pieces);
    }
  }
  let geocodable = 0, noAddress = 0, censusNonExact = 0, corrected = 0;
  const at = new Map<string, number>();
  for (const loc of doc.locations) {
    if (!active.has(loc.id)) continue;
    coordinates[loc.coordinate_source]++;
    if (loc.coordinate_source === "unresolved") { if (loc.address?.trim()) geocodable++; else noAddress++; }
    if (loc.coordinate_source === "census" && loc.geocode?.match_type === "non_exact") censusNonExact++;
    if (loc.original) corrected++;
    if (loc.lat !== null && loc.lon !== null && loc.coordinate_source !== "unresolved") {
      const key = `${loc.lat},${loc.lon}`;
      at.set(key, (at.get(key) ?? 0) + 1);
    }
  }
  const stock = new Map(doc.inventory.map(i => [i.product_id, i.available_pieces]));
  const shortProducts = [...ordered]
    .map(([product_id, n]) => ({ product_id, ordered: n, available: stock.get(product_id) ?? 0 }))
    .filter(p => p.ordered > p.available)
    .sort((a, b) => (b.ordered - b.available) - (a.ordered - a.available) || a.product_id.localeCompare(b.product_id));
  const dates = doc.orders.map(o => o.order_date).sort();
  return {
    orders: doc.orders.length, lines, customers: customers.size, products: doc.products.length, locations: active.size,
    coordinates, geocodable, noAddress, censusNonExact, corrected,
    sharedCoordinates: [...at.values()].filter(n => n > 1).reduce((s, n) => s + n, 0),
    zeroPieceLines, zeroValueLines, shortProducts,
    orderDates: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null,
  };
}
