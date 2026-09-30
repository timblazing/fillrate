// Static copy for the Fulfillment components section. Synthetic; never real customer data (spec §14).

export const lineFilterItems = [
  { value: "all", label: "All states" },
  { value: "loaded", label: "Loaded" },
  { value: "partial", label: "Partly filled" },
  { value: "short", label: "No stock" },
  { value: "unreachable", label: "Beyond leg limit" },
  { value: "excluded", label: "Excluded" },
]

export const strategyItems = [
  { value: "date-value", label: "Order date, then value" },
  { value: "first-come", label: "First come" },
  { value: "priority", label: "Priority" },
  { value: "optimized", label: "Optimized (CP-SAT)" },
]

export const importPreview = {
  columns: ["order_id", "order_date", "ship_to_zip", "sku", "qty", "net_price", "lf_per_pc"],
  mapping: ["Order ID", "Order date", "Location · ZIP", "Product", "Ordered pieces", "Net value / piece", "Linear ft / piece"],
  rows: [
    ["SO-260400", "2026-08-11", "37203", "4105", "6", "512.40", "0.40"],
    ["SO-260400", "2026-08-11", "37203", "1100", "12", "181.00", ""],
    ["SO-260401", "2026-08-11", "38111", "5600", "28", "1,196.00", "2.00"],
    ["SO-260402", "08/12/2026", "72202", "3320", "-2", "401.25", "0.60"],
    ["SO-260403", "2026-08-12", "38101", "1240", "3", "440.00", "1.50"],
    ["SO-260404", "2026-08-12", "35203", "7730", "4", "95.00", ""],
  ],
  issues: {
    3: { text: "Date not ISO (YYYY-MM-DD) · negative pieces", cols: [1, 4] },
    4: { text: "ZIP 38101 is PO-box-only: no ZCTA, stays unresolved", cols: [2] },
    5: { text: "Unknown SKU 7730 and no linear feet to fall back on", cols: [3, 6] },
  } as Record<number, { text: string; cols: number[] }>,
}

export const runEvents = [
  { at: "14:02:11", text: "Claimed by worker-1 (lease 60 s, attempt 1)" },
  { at: "14:02:11", text: "Inputs: allocation a-0221 · clusters c-0221 · matrix h×1.2" },
  { at: "14:02:11", text: "Cluster 4: 79 stops · 21 edges over 500 mi prohibited" },
  { at: "14:02:12", text: "PyVRP 0.14.0 · seed 0 · MaxRuntime(10) · open routes" },
  { at: "14:02:15", text: "Heartbeat · 33%" },
  { at: "14:02:18", text: "Heartbeat · 62%" },
]

export const pythonExport = `"""run-0214 · Mid-South open orders v14 · reproduces the pipeline offline."""
from pipeline import allocate, aggregate_stops, kmeans_with_repair, solve_cluster
from pyvrp.stop import MaxIterations

lines, stock = load_csv("order_lines.csv"), load_csv("inventory.csv")
alloc = allocate(lines, stock, strategy="order_date_then_value")  # piece-level
stops = aggregate_stops(alloc, trailer_lf=5_300)  # hundredths of a foot

clusters = kmeans_with_repair(stops, k=8, seed=0, n_init=4,
                              max_diameter_mi=500, circuity=1.2)

for c in clusters:  # one PyVRP model per cluster
    res = solve_cluster(c, depot=DEPOT, max_leg_mi=500, open_routes=True,
                        stop=MaxIterations(2_000), seed=0)
    print(c.id, res.cost(), len(res.best.routes()))`
