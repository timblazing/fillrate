import { describe, expect, it } from "vitest";
import { CSV_TEMPLATES, parseExactHundredths, previewCsvImport, type CsvImportInput } from "../src/imports";
const base: CsvImportInput = { name: "Imported", depot: { id: "depot", label: "Depot", lat: 35, lon: -90 }, ordersCsv: CSV_TEMPLATES.orders, inventoryCsv: CSV_TEMPLATES.inventory };
const preview = (ordersCsv: string) => previewCsvImport({ ...base, ordersCsv });
describe("CSV import preview", () => {
  it("normalizes exact units and retains original sources without changing input", () => {
    const result = previewCsvImport(base);
    expect(result.errors).toEqual([]);
    expect(result.document?.orders[0].lines[0]).toMatchObject({ ordered_pieces: 10, net_value_per_piece_cents: 1250, linear_feet_per_piece: 125 });
    expect(result.originals.ordersCsv).toBe(base.ordersCsv);
    expect(result.document?.locations[0].coordinate_source).toBe("imported");
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
