// Shipment sheet (spec v1.8 §15 M2 item 11): per stop in visit order, the sequence, order numbers, linear feet,
// miles from the previous stop (the depot for stop 1) and dollar value, plus shipment totals. Location and
// per-product pieces were not requested, so they are optional columns. Shared by the printable page and the CSV
// export so both always agree. Internal names stay `truck`/`load`; "Shipment" is the UI label (lib/copy.ts).

import type { RunSummary } from "@fillrate/contracts"

export const METERS_PER_MILE = 1609.344

export type SheetColumn = "location" | "pieces"

export type SheetStop = {
  sequence: number
  locationId: string
  location: string
  orders: string[]
  /** Hundredths of a foot. */
  linearFeet: number
  milesFromPrevious: number
  /** Cents. */
  value: number
  /** Pieces per product ID, for the optional column. */
  pieces: Record<string, number>
}

export type Sheet = {
  /** 1-based position in the run, for "Shipment 3". */
  index: number
  truckId: string
  clusterId: string
  clusterIndex: number
  stops: SheetStop[]
  totals: { stops: number; linearFeet: number; fill: number; loadedMiles: number; value: number }
}

export function shipmentSheets(summary: RunSummary): Sheet[] {
  const labels = new Map(summary.locations.map((l) => [l.id, l.label]))
  const clusterIndex = new Map(summary.clusters.map((c, i) => [c.id, i + 1]))
  return summary.trucks.map((t, i) => {
    const stops = t.visits.map((v) => {
      const pieces: Record<string, number> = {}
      for (const l of v.lines) pieces[l.product_id] = (pieces[l.product_id] ?? 0) + l.pieces
      return {
        sequence: v.sequence,
        locationId: v.location_id,
        location: labels.get(v.location_id) ?? v.location_id,
        orders: [...new Set(v.lines.map((l) => l.order_id))].sort(),
        linearFeet: v.lines.reduce((s, l) => s + l.linear_feet, 0),
        milesFromPrevious: v.leg_m / METERS_PER_MILE,
        value: v.lines.reduce((s, l) => s + l.amount_cents, 0),
        pieces,
      }
    })
    return {
      index: i + 1,
      truckId: t.id,
      clusterId: t.cluster_id,
      clusterIndex: clusterIndex.get(t.cluster_id) ?? 0,
      stops,
      totals: { stops: stops.length, linearFeet: t.load, fill: t.fill, loadedMiles: t.distance_m / METERS_PER_MILE, value: t.amount_cents },
    }
  })
}

/** CSV rows for the sheet export: one row per stop, with internal column names. */
export function sheetCsvRows(sheets: Sheet[], columns: SheetColumn[] = []) {
  const products = [...new Set(sheets.flatMap((s) => s.stops.flatMap((x) => Object.keys(x.pieces))))].sort()
  const header = [
    "truck_id",
    "shipment_number",
    "sequence",
    "order_ids",
    "linear_feet",
    "miles_from_previous",
    "value_dollars",
    ...(columns.includes("location") ? ["location_id", "location"] : []),
    ...(columns.includes("pieces") ? products.map((p) => `pieces_${p}`) : []),
  ]
  const rows = sheets.flatMap((s) =>
    s.stops.map((x) => [
      s.truckId,
      s.index,
      x.sequence,
      x.orders.join(" "),
      (x.linearFeet / 100).toFixed(2),
      x.milesFromPrevious.toFixed(1),
      (x.value / 100).toFixed(2),
      ...(columns.includes("location") ? [x.locationId, x.location] : []),
      ...(columns.includes("pieces") ? products.map((p) => x.pieces[p] ?? 0) : []),
    ])
  )
  return { header, rows }
}
