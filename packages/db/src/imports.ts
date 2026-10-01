import { parseContract, type ScenarioDocument } from "@fillrate/contracts";

export const ORDER_COLUMNS = ["order_id", "customer_id", "line_id", "order_date", "location_id", "location_label", "address", "latitude", "longitude", "product", "ordered_pieces", "net_value_per_piece", "linear_feet_per_piece"] as const;
export const INVENTORY_COLUMNS = ["product", "available_pieces"] as const;
export type OrderColumn = typeof ORDER_COLUMNS[number];
export type InventoryColumn = typeof INVENTORY_COLUMNS[number];
export type ColumnMapping<T extends string> = Partial<Record<T, string>>;
export const CSV_TEMPLATES = {
  orders: `${ORDER_COLUMNS.join(",")}\nO-1,customer-1,L-1,2026-09-30,C-1,Customer 1,,35.1,-90.1,SKU-1,10,12.50,1.25\n`,
  inventory: "product,available_pieces\nSKU-1,100\n",
};
export type ImportIssue = { file: "orders" | "inventory"; row: number; column: string; code: string; message: string };
export type CsvImportInput = {
  ordersCsv: string; inventoryCsv: string; name: string; depot: ScenarioDocument["depot"];
  orderMapping?: ColumnMapping<OrderColumn>; inventoryMapping?: ColumnMapping<InventoryColumn>;
};
export type CsvImportPreview = {
  valid: boolean; document: ScenarioDocument | null; errors: ImportIssue[]; warnings: ImportIssue[];
  originals: { ordersCsv: string; inventoryCsv: string };
  mappings: { orders: ColumnMapping<OrderColumn>; inventory: ColumnMapping<InventoryColumn> };
  samples: { orders: Record<string, string>[]; inventory: Record<string, string>[] };
};

/** Decimal strings are converted without floating point rounding or exponent coercion. */
export function parseExactHundredths(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Use a nonnegative decimal with at most two fractional digits.");
  const [whole, fraction = ""] = value.split(".");
  const integer = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Value exceeds the supported exact integer range.");
  return Number(integer);
}

/** RFC 4180 quoting, including escaped quotes and embedded newlines. */
function csv(text: string): { headers: string[]; rows: { row: number; cells: string[] }[] } {
  if (Buffer.byteLength(text, "utf8") > 5_000_000) throw new Error("CSV exceeds the 5 MB limit.");
  const records: { row: number; cells: string[] }[] = [];
  let cells: string[] = [], field = "", quoted = false, closed = false, line = 1, start = 1;
  const cell = () => { cells.push(field); field = ""; closed = false; };
  const record = () => { cell(); if (cells.some((v) => v.trim() !== "")) records.push({ row: start, cells }); cells = []; };
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') { if (input[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else { field += char; if (char === "\n") line++; }
      continue;
    }
    if (char === ",") cell();
    else if (char === "\n" || char === "\r") { if (char === "\r" && input[i + 1] === "\n") i++; record(); line++; start = line; }
    else if (char === '"' && field === "" && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error(`Malformed quoting on row ${line}.`); field += char; }
  }
  if (quoted) throw new Error(`Unclosed quoted field on row ${start}.`);
  if (field || cells.length || closed) record();
  if (!records.length) throw new Error("CSV is empty.");
  if (records.length > 10_001) throw new Error("CSV exceeds the 10,000 row limit.");
  const headers = records.shift()!.cells.map((h) => h.trim());
  if (headers.some((h) => !h) || new Set(headers).size !== headers.length) throw new Error("Headers must be nonempty and unique.");
  return { headers, rows: records };
}

export function previewCsvImport(input: CsvImportInput): CsvImportPreview {
  const errors: ImportIssue[] = [], warnings: ImportIssue[] = [];
  const result: CsvImportPreview = { valid: false, document: null, errors, warnings, originals: { ordersCsv: input.ordersCsv, inventoryCsv: input.inventoryCsv }, mappings: { orders: {}, inventory: {} }, samples: { orders: [], inventory: [] } };
  const issue = (file: ImportIssue["file"], row: number, column: string, code: string, message: string) => errors.push({ file, row, column, code, message });
  const read = <T extends string>(file: ImportIssue["file"], text: string, columns: readonly T[], supplied: ColumnMapping<T> | undefined, required: T[]) => {
    let parsed: ReturnType<typeof csv>;
    try { parsed = csv(text); } catch (e) { issue(file, 1, "", "csv", String((e as Error).message)); return []; }
    const mapping: ColumnMapping<T> = {};
    for (const column of columns) { const header = supplied?.[column] ?? column; if (parsed.headers.includes(header)) mapping[column] = header; else if (supplied?.[column] || required.includes(column)) issue(file, 1, column, "missing_column", `Missing column: ${header}.`); }
    const selected = Object.values(mapping);
    if (new Set(selected).size !== selected.length) issue(file, 1, "", "mapping", "Each source column may map to only one field.");
    result.mappings[file] = mapping;
    result.samples[file] = parsed.rows.slice(0, 5).map(({ cells }) => Object.fromEntries(parsed.headers.map((h, i) => [h, cells[i] ?? ""])));
    return parsed.rows.map(({ row, cells }) => {
      // The current canonical model has no windows/groups or alternate units. Do not
      // silently drop constraints that would change fulfillment semantics.
      for (let i = 0; i < parsed.headers.length; i++) {
        const header = parsed.headers[i].toLowerCase();
        const value = (cells[i] ?? "").trim();
        if (!value) continue;
        if (/window|group|release_time|service_duration/.test(header)) issue(file, row, parsed.headers[i], "unsupported_constraint", "Windows, groups and service constraints are not supported by this import version.");
        if ((header === "length_unit" || header === "linear_feet_unit") && value.toLowerCase() !== "ft") issue(file, row, parsed.headers[i], "units", "Linear feet must use ft units.");
        if ((header === "quantity_unit" || header === "unit") && !["piece", "pieces"].includes(value.toLowerCase())) issue(file, row, parsed.headers[i], "units", "Quantity must use whole pieces.");
        if (header === "currency" && value.toUpperCase() !== "USD") issue(file, row, parsed.headers[i], "units", "Monetary values must be USD.");
      }
      if (cells.length !== parsed.headers.length) issue(file, row, "", "column_count", `Expected ${parsed.headers.length} cells, received ${cells.length}.`);
      return { row, get: (column: T) => { const header = mapping[column]; return header ? (cells[parsed.headers.indexOf(header)] ?? "").trim() : ""; } };
    });
  };
  const orderRows = read("orders", input.ordersCsv, ORDER_COLUMNS, input.orderMapping, ["order_id", "order_date", "product", "ordered_pieces", "net_value_per_piece", "linear_feet_per_piece"]);
  const inventoryRows = read("inventory", input.inventoryCsv, INVENTORY_COLUMNS, input.inventoryMapping, ["product", "available_pieces"]);
  const products = new Map<string, ScenarioDocument["products"][number]>(), locations = new Map<string, ScenarioDocument["locations"][number]>(), orders = new Map<string, ScenarioDocument["orders"][number]>();
  const lineIds = new Set<string>(), inventoryIds = new Set<string>();
  const inventory: ScenarioDocument["inventory"] = [];
  for (const { row, get } of orderRows) {
    const before = errors.length;
    const id = (column: OrderColumn) => { const value = get(column); if (!value || value.length > 200) issue("orders", row, column, "id", "An ID of 1–200 characters is required."); return value; };
    const orderId = id("order_id"), product = id("product");
    const customerId = get("customer_id") || orderId;
    if (customerId.length > 200) issue("orders", row, "customer_id", "id", "Customer IDs must be at most 200 characters.");
    const lineId = get("line_id") || `csv-line-${row}`;
    if (lineId.length > 200 || lineIds.has(lineId)) issue("orders", row, "line_id", "duplicate_id", "Line IDs must be unique and at most 200 characters.");
    lineIds.add(lineId);
    const date = get("order_date");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) issue("orders", row, "order_date", "date", "Use a valid calendar date in YYYY-MM-DD form.");
    const count = get("ordered_pieces");
    const pieces = Number(count);
    if (!/^\d+$/.test(count) || !Number.isSafeInteger(pieces)) issue("orders", row, "ordered_pieces", "quantity", "Pieces must be a nonnegative safe integer.");
    const decimal = (column: OrderColumn) => { try { return parseExactHundredths(get(column)); } catch (e) { issue("orders", row, column, "decimal", (e as Error).message); return 0; } };
    const value = decimal("net_value_per_piece"), feet = decimal("linear_feet_per_piece");
    if (!feet) issue("orders", row, "linear_feet_per_piece", "positive_load", "Linear feet must be at least 0.01 per piece.");
    if (!Number.isSafeInteger(pieces * value) || !Number.isSafeInteger(pieces * feet)) issue("orders", row, "ordered_pieces", "overflow", "Extended load or value exceeds the exact integer range.");
    const address = get("address"), latText = get("latitude"), lonText = get("longitude");
    const coordinate = (text: string, limit: number) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) && Number.isFinite(Number(text)) && Math.abs(Number(text)) <= limit;
    const suppliedCoordinates = !!latText || !!lonText;
    if (suppliedCoordinates && (!coordinate(latText, 90) || !coordinate(lonText, 180))) issue("orders", row, "latitude", "coordinates", "Supply both finite latitude (-90 to 90) and longitude (-180 to 180).");
    if (!suppliedCoordinates && !address) issue("orders", row, "address", "location", "Coordinates or an original address are required.");
    const locationId = get("location_id") || `csv-location-${orderId}`;
    if (locationId.length > 200) issue("orders", row, "location_id", "id", "Location IDs must be at most 200 characters.");
    const location: ScenarioDocument["locations"][number] = { id: locationId, label: get("location_label") || address || locationId, lat: suppliedCoordinates ? Number(latText) : null, lon: suppliedCoordinates ? Number(lonText) : null, coordinate_source: suppliedCoordinates ? "imported" : "unresolved" };
    const priorLocation = locations.get(locationId);
    if (priorLocation && JSON.stringify(priorLocation) !== JSON.stringify(location)) issue("orders", row, "location_id", "conflicting_location", "Repeated location ID has conflicting coordinates or label.");
    const priorOrder = orders.get(orderId);
    if (priorOrder && (priorOrder.location_id !== locationId || priorOrder.order_date !== date || priorOrder.customer_id !== customerId)) issue("orders", row, "order_id", "conflicting_order", "Repeated order ID must keep the same date, location and customer.");
    if (errors.length !== before) continue;
    if (!suppliedCoordinates) warnings.push({ file: "orders", row, column: "address", code: "unresolved", message: "Address retained; geocoding is not available yet. Resolve coordinates before running." });
    products.set(product, products.get(product) ?? { id: product, label: product, linear_feet_per_piece: feet });
    locations.set(locationId, location);
    const order = priorOrder ?? { id: orderId, customer_id: customerId, location_id: locationId, order_date: date, lines: [] };
    order.lines.push({ id: lineId, product_id: product, ordered_pieces: pieces, net_value_per_piece_cents: value, linear_feet_per_piece: feet });
    orders.set(orderId, order);
  }
  for (const { row, get } of inventoryRows) {
    const product = get("product"), raw = get("available_pieces"), available = Number(raw);
    if (inventoryIds.has(product)) issue("inventory", row, "product", "duplicate_id", "Inventory must contain only one row per product.");
    inventoryIds.add(product);
    if (!products.has(product)) issue("inventory", row, "product", "unknown_product", "Inventory product must occur in the order lines.");
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(available)) issue("inventory", row, "available_pieces", "quantity", "Available pieces must be a nonnegative safe integer.");
    inventory.push({ product_id: product, available_pieces: available });
  }
  for (const product of products.keys()) if (!inventoryIds.has(product)) issue("inventory", 1, "product", "missing_inventory", `Missing inventory for ${product}; enter zero explicitly if unavailable.`);
  if (!orderRows.length) issue("orders", 1, "", "empty", "At least one order line is required.");
  let totalLoad = BigInt(0), totalValue = BigInt(0);
  for (const order of orders.values()) for (const line of order.lines) {
    totalLoad += BigInt(line.ordered_pieces) * BigInt(line.linear_feet_per_piece!);
    totalValue += BigInt(line.ordered_pieces) * BigInt(line.net_value_per_piece_cents);
  }
  if (totalLoad > BigInt(Number.MAX_SAFE_INTEGER) || totalValue > BigInt(Number.MAX_SAFE_INTEGER)) issue("orders", 1, "", "overflow", "Scenario totals exceed the exact integer range.");
  if (!input.name.trim()) issue("orders", 1, "name", "name", "Scenario name is required.");
  if (!errors.length) {
    try { result.document = parseContract("ScenarioDocument", { schema_version: 1, name: input.name.trim(), depot: input.depot, products: [...products.values()], locations: [...locations.values()], orders: [...orders.values()], inventory }); }
    catch (e) { issue("orders", 1, "", "contract", (e as Error).message); }
  }
  result.valid = errors.length === 0;
  return result;
}
