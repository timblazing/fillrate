import "server-only";

import type { Store } from "@fillrate/db";

import { EXPORT_NOTE } from "../copy";
import { type SheetColumn, sheetCsvRows, shipmentSheets } from "../shipment-sheet";
import { ApiError, runDetail } from "./runs";

export type CsvTable = "loads" | "unplanned" | "clusters" | "products" | "sheet";

// Canonical run export (spec §13): input snapshot, settings, stage manifests, results and provenance.
export function exportJson(store: Store, runId: string) {
  const detail = runDetail(store, runId);
  const view = store.runView(runId)!;
  return {
    schema_version: 1,
    kind: "fillrate.run",
    run: { id: detail.id, status: detail.status, created_at: detail.created_at, attempts: detail.attempts },
    scenario: store.versionDocument(view.versionId).document,
    settings: detail.settings,
    stages: view.artifacts,
    summary: detail.summary,
    units: { distance: "meters", linear_feet: "hundredths of a foot", money: "cents" },
  };
}

function csv(header: string[], rows: (string | number | boolean | null | undefined)[][], note = `# ${EXPORT_NOTE}`) {
  const cell = (v: string | number | boolean | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // Exports keep internal names; the first line says which UI label each maps to (spec v1.8 §15 M2 item 1).
  return [note, ...[header, ...rows].map(r => r.map(cell).join(","))].join("\r\n") + "\r\n";
}

export type SheetOptions = { truck?: string | null; columns?: SheetColumn[] };

export function exportCsv(store: Store, runId: string, table: CsvTable, sheet: SheetOptions = {}) {
  const summary = runDetail(store, runId).summary;
  if (!summary) throw new ApiError(409, "no_result", "This run has no result to export yet.");
  if (table === "loads") {
    return csv(
      ["truck_id", "cluster_id", "sequence", "visit_id", "location_id", "order_id", "line_id", "product_id", "pieces", "linear_feet_hundredths", "amount_cents", "leg_m", "truck_load_hundredths", "truck_fill", "validated"],
      summary.trucks.flatMap(t => t.visits.flatMap(v => v.lines.map(l => [
        t.id, t.cluster_id, v.sequence, v.visit_id, v.location_id, l.order_id, l.line_id, l.product_id, l.pieces, l.linear_feet, l.amount_cents, v.leg_m, t.load, t.fill.toFixed(4), true,
      ]))),
    );
  }
  if (table === "unplanned") {
    return csv(
      ["line_id", "order_id", "product_id", "location_id", "pieces", "amount_cents", "reason", "stage", "evidence"],
      summary.unplanned.map(u => [u.line_id, u.order_id, u.product_id, u.location_id, u.pieces, u.amount_cents, u.reason, u.stage, u.evidence]),
    );
  }
  if (table === "clusters") {
    return csv(
      ["cluster_id", "status", "locations", "visits", "planned_visits", "trucks", "load_hundredths", "capacity_lower_bound", "avg_fill", "min_fill", "diameter_m", "mean_centroid_distance_m", "loaded_distance_m", "planned_amount_cents", "objective", "truck_penalty", "distance_bound_m"],
      summary.clusters.map(c => [c.id, c.status, c.location_ids.length, c.visit_count, c.planned_visit_count, c.trucks, c.load, c.capacity_lower_bound, c.avg_fill?.toFixed(4), c.min_fill?.toFixed(4), c.diameter_m, c.mean_centroid_distance_m, c.loaded_distance_m, c.planned_amount_cents, c.objective_mode, c.truck_penalty, c.distance_bound_m]),
    );
  }
  if (table === "products") {
    return csv(
      ["product_id", "label", "starting_inventory", "ordered", "excluded", "eligible", "allocated", "unselected", "planned", "allocated_unplanned", "residual", "ordered_cents", "allocated_cents", "planned_cents"],
      summary.products.map(p => [p.product_id, p.label, p.starting_inventory, p.ordered, p.excluded, p.eligible, p.allocated, p.unselected, p.planned, p.allocated_unplanned, p.residual, p.ordered_cents, p.allocated_cents, p.planned_cents]),
    );
  }
  if (table === "sheet") {
    let sheets = shipmentSheets(summary);
    if (sheet.truck) {
      sheets = sheets.filter(s => s.truckId === sheet.truck);
      if (!sheets.length) throw new ApiError(404, "truck_not_found", "No truck with this ID in the run.", ["truck"]);
    }
    const { header, rows } = sheetCsvRows(sheets, sheet.columns);
    return csv(header, rows, `# Fillrate shipment sheet. truck_id = Shipment in the app; miles are estimated (haversine × ${summary.settings.travel_circuity}).`);
  }
  throw new ApiError(400, "invalid_table", "table must be loads, unplanned, clusters, products or sheet.", ["table"]);
}
