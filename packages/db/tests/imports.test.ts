import { describe, expect, it } from "vitest";
import { canonical } from "../src/canonical";
import { CSV_TEMPLATES, parseExactHundredths, previewCsvImport, previewImport, type CsvImportInput } from "../src/imports";
const base = { name: "Imported", depot: { id: "depot", label: "Depot", lat: 35, lon: -90 }, ordersCsv: CSV_TEMPLATES.orders, inventoryCsv: CSV_TEMPLATES.inventory } satisfies CsvImportInput;
const preview = (ordersCsv: string) => previewCsvImport({ ...base, ordersCsv });
describe("CSV import preview", () => {
  it("normalizes exact units and retains original sources without changing input", () => {
    const result = previewCsvImport(base);
    expect(result.errors).toEqual([]);
    expect(result.document?.orders[0].lines[0]).toMatchObject({ ordered_pieces: 10, net_value_per_piece_cents: 1250, linear_feet_per_piece: 125 });
    expect(result.originals.ordersCsv).toBe(base.ordersCsv);
    expect(result.document?.locations[0].coordinate_source).toBe("imported");
    expect(result.document?.orders[0].customer_id).toBe("customer-1");
  });
  it("parses exact decimals and refuses precision loss, exponents, negatives and overflow", () => {
    expect(parseExactHundredths("0.29")).toBe(29);
    expect(parseExactHundredths("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER);
    for (const value of ["0.001", "1e2", "-1", "NaN", "Infinity", "90071992547409.92", ""]) expect(() => parseExactHundredths(value)).toThrow();
    expect(preview(base.ordersCsv.replace("1.25", "0.001")).document).toBeNull();
  });
  it("supports quoted commas, escaped quotes, CRLF, embedded newlines and custom mapping", () => {
    const result = previewCsvImport({ ...base, orderMapping: { order_id: "Number" }, ordersCsv: base.ordersCsv.replace("order_id", "Number").replace("Customer 1", '"Customer, ""One""\nSouth"').replaceAll("\n", "\r\n") });
    expect(result.errors).toEqual([]);
    expect(result.document?.locations[0].label).toBe('Customer, "One"\r\nSouth');
    expect(result.mappings.orders.order_id).toBe("Number");
  });
  it("groups compatible order lines but rejects duplicate line IDs and conflicting order metadata", () => {
    const second = base.ordersCsv.split("\n")[1].replace("L-1", "L-2");
    expect(preview(base.ordersCsv + second + "\n").document?.orders[0].lines).toHaveLength(2);
    expect(preview(base.ordersCsv + base.ordersCsv.split("\n")[1]).errors.some((e) => e.code === "duplicate_id")).toBe(true);
    expect(preview(base.ordersCsv + second.replace("2026-09-30", "2026-09-29")).errors.some((e) => e.code === "conflicting_order")).toBe(true);
    expect(preview(base.ordersCsv + second.replace("customer-1", "customer-2")).errors.some((e) => e.code === "conflicting_order")).toBe(true);
  });
  it("keeps legacy CSV customers distinct by default", () => {
    const rows = base.ordersCsv.trimEnd().split("\n").map(row => row.replace("customer_id,", "").replace("customer-1,", ""));
    const second = rows[1].replace("O-1", "O-2").replace("L-1", "L-2");
    const result = preview(`${rows[0]}\n${rows[1]}\n${second}\n`);
    expect(result.document?.orders.map(order => order.customer_id)).toEqual(["O-1", "O-2"]);
  });
  it("retains address-only rows with explicit unresolved provenance", () => {
    const result = preview(base.ordersCsv.replace(",,35.1,-90.1,", ",123 Main Street,,,"));
    expect(result.valid).toBe(true);
    expect(result.document?.locations[0]).toMatchObject({ lat: null, lon: null, coordinate_source: "unresolved" });
    expect(result.warnings[0].code).toBe("unresolved");
    expect(result.originals.ordersCsv).toContain("123 Main Street");
  });
  it("rejects bad coordinates, dates, quantities and missing inventory with row diagnostics", () => {
    for (const [from, to] of [["35.1", "NaN"], ["35.1", "91"], ["-90.1", ""], ["2026-09-30", "2026-02-30"], [",10,", ",-1,"], [",10,", ",1.5,"]]) {
      const result = preview(base.ordersCsv.replace(from, to));
      expect(result.valid).toBe(false);
      expect(result.document).toBeNull();
      expect(result.errors.some((e) => e.row === 2)).toBe(true);
    }
    expect(previewCsvImport({ ...base, inventoryCsv: "product,available_pieces\n" }).errors.some((e) => e.code === "missing_inventory")).toBe(true);
  });
  it("rejects invalid quoting, duplicate headers, mismatched row lengths and ambiguous mappings", () => {
    for (const text of [base.ordersCsv.replace("Customer 1", '"Customer 1'), base.ordersCsv.replace("line_id", "order_id"), base.ordersCsv.replace("Customer 1", "Customer,1")]) expect(preview(text).valid).toBe(false);
    expect(previewCsvImport({ ...base, orderMapping: { line_id: "order_id" } }).errors.some((e) => e.code === "mapping")).toBe(true);
  });
  it("does not silently discard unsupported windows or inconsistent units", () => {
    for (const [header, value] of [["time_window", "broken"], ["group_id", "G1"], ["length_unit", "m"], ["quantity_unit", "pallet"]]) {
      const lines = base.ordersCsv.trimEnd().split("\n");
      expect(preview(`${lines[0]},${header}\n${lines[1]},${value}\n`).valid).toBe(false);
    }
  });
  it("rejects duplicate inventory instead of silently summing stock", () => {
    const result = previewCsvImport({ ...base, inventoryCsv: base.inventoryCsv + "SKU-1,10\n" });
    expect(result.errors.some((e) => e.code === "duplicate_id")).toBe(true);
    expect(result.document).toBeNull();
  });
});

// Source-independent reproduction (M5 exit evidence): the same orders as CSV, GeoJSON points and
// canonical JSON normalize to one canonical document, so runs on any of them share every input hash.
const ordersCsv = `order_id,order_date,customer_id,location_label,address,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece,priority
O-1,2026-09-28,ACME,Acme North,,35.2,-90.1,SKU-1,10,12.50,1.25,3
O-1,2026-09-28,ACME,Acme North,,35.2,-90.1,SKU-2,4,80.00,4.00,3
O-2,2026-09-29,Beta,Beta Yard,"125 N Main St, Memphis, TN 38103",,,SKU-1,7,12.25,1.25,1
`;
const inventoryCsv = "product,available_pieces\nSKU-1,12\nSKU-2,4\n";
const feature = (props: Record<string, unknown>, point: [number, number] | null) => ({ type: "Feature", geometry: point && { type: "Point", coordinates: point }, properties: props });
const ordersGeojson = JSON.stringify({ type: "FeatureCollection", features: [
  feature({ order_id: "O-1", order_date: "2026-09-28", customer_id: "ACME", location_label: "Acme North", product: "SKU-1", ordered_pieces: 10, net_value_per_piece: "12.50", linear_feet_per_piece: 1.25, priority: 3 }, [-90.1, 35.2]),
  feature({ order_id: "O-1", order_date: "2026-09-28", customer_id: "ACME", location_label: "Acme North", product: "SKU-2", ordered_pieces: 4, net_value_per_piece: 80, linear_feet_per_piece: 4, priority: 3 }, [-90.1, 35.2]),
  feature({ order_id: "O-2", order_date: "2026-09-29", customer_id: "Beta", location_label: "Beta Yard", address: "125 N Main St, Memphis, TN 38103", product: "SKU-1", ordered_pieces: 7, net_value_per_piece: 12.25, linear_feet_per_piece: "1.25", priority: 1 }, null),
] });
const common = { name: "Same orders", depot: base.depot };

describe("GeoJSON and canonical JSON imports", () => {
  it("normalize the same orders to one canonical document as CSV", () => {
    const fromCsv = previewImport({ ...common, format: "csv", ordersCsv, inventoryCsv });
    const fromGeojson = previewImport({ ...common, format: "geojson", ordersGeojson, inventoryCsv });
    expect(fromCsv.errors).toEqual([]);
    expect(fromGeojson.errors).toEqual([]);
    expect(canonical(fromGeojson.document)).toBe(canonical(fromCsv.document));
    const exported = JSON.stringify({ document: fromCsv.document, source: fromCsv.originals, versionId: "v1", metadata: {} });
    const fromJson = previewImport({ ...common, format: "json", scenarioJson: exported });
    expect(fromJson.errors).toEqual([]);
    expect(canonical(fromJson.document)).toBe(canonical(fromCsv.document));
    expect(fromGeojson.originals.ordersGeojson).toBe(ordersGeojson);
    expect(fromJson.originals.scenarioJson).toBe(exported);
    // Line and location IDs default from record order and order ID, not from the file format.
    expect(fromGeojson.document!.orders[0].lines.map(l => l.id)).toEqual(["line-1", "line-2"]);
    expect(fromGeojson.document!.locations.map(l => [l.id, l.coordinate_source, l.address])).toEqual([["location-O-1", "imported", null], ["location-O-2", "unresolved", "125 N Main St, Memphis, TN 38103"]]);
    expect(fromGeojson.review).toMatchObject({ orders: 2, lines: 3, locations: 2, geocodable: 1, coordinates: { imported: 1, unresolved: 1 }, shortProducts: [{ product_id: "SKU-1", ordered: 17, available: 12 }] });
  });
  it("rejects non-point geometry, conflicting coordinates and nested properties", () => {
    const one = (f: unknown) => previewImport({ ...common, format: "geojson", ordersGeojson: JSON.stringify({ type: "FeatureCollection", features: [f] }), inventoryCsv });
    const props = { order_id: "O-1", order_date: "2026-09-28", product: "SKU-1", ordered_pieces: 1, net_value_per_piece: 1, linear_feet_per_piece: 1 };
    expect(one({ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: props }).errors[0].code).toBe("geojson");
    expect(one(feature({ ...props, latitude: 10 }, [-90, 35])).errors[0].message).toMatch(/differ from its geometry/);
    expect(one(feature({ ...props, extra: { nested: true } }, [-90, 35])).errors[0].message).toMatch(/string, a finite number or null/);
    expect(one(feature(props, [-90, 95])).errors.some(e => e.code === "coordinates")).toBe(true);
    expect(previewImport({ ...common, format: "geojson", ordersGeojson: "{\"type\":\"Point\"}", inventoryCsv }).valid).toBe(false);
  });
  it("validates canonical JSON against the contract and references", () => {
    expect(previewImport({ ...common, format: "json", scenarioJson: "{" }).errors[0].code).toBe("json");
    const doc = previewImport({ ...common, format: "csv", ordersCsv, inventoryCsv }).document!;
    const broken = structuredClone(doc); broken.orders[0].location_id = "missing";
    expect(previewImport({ ...common, format: "json", scenarioJson: JSON.stringify(broken) }).errors[0].code).toBe("contract");
    const noStock = { ...doc, inventory: doc.inventory.slice(0, 1) };
    expect(previewImport({ ...common, format: "json", scenarioJson: JSON.stringify(noStock) }).errors[0].code).toBe("missing_inventory");
  });
});

