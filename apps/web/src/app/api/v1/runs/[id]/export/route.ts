import { join } from "node:path"
import { EXAMPLES_OWNER } from "@fillrate/db"
import { replayBundle } from "@fillrate/db/replay"
import { MAX_EXPORT_NODES, runMatrixJson, snapshotCsv } from "@fillrate/db/travel-export"

import { initializeDatabase } from "@/lib/server/database"
import { exportCsv, exportJson, type CsvTable } from "@/lib/server/export"
import type { SheetColumn } from "@/lib/shipment-sheet"
import { buildRouteGeoJson } from "@/lib/geojson"
import { ApiError, errorResponse, runDetail } from "@/lib/server/runs"
import { assertRunRead, OWNER } from "@/lib/server/access"
import { cachedGeometries } from "@/lib/server/route-geometry"

export const dynamic = "force-dynamic"

// ?format=json (default), ?format=python (replay bundle .zip; also for succeeded k explorer jobs) or ?format=csv&table=loads|unplanned|clusters|products|sheet
// ?format=geojson (schematic truck routes; add &geometry=road to draw Valhalla road legs for trucks whose geometry was fetched) and ?format=matrix&as=csv|json (the travel snapshot the run used; estimated
// runs have no recorded matrix, so they answer 409 matrix_not_recorded). The sheet table takes optional &truck=<truck id> and &columns=location,pieces.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/export">) {
  try {
    const { id } = await ctx.params
    const params = new URL(request.url).searchParams
    const format = params.get("format") ?? "json"
    const store = initializeDatabase()
    const view = assertRunRead(store, id)
    const name = `fillrate-run-${id.slice(0, 8)}`
    if (format === "json") {
      return new Response(JSON.stringify(exportJson(store, id), null, 1), {
        headers: { "Cache-Control": "private, no-store", "content-type": "application/json", "content-disposition": `attachment; filename="${name}.json"` },
      })
    }
    if (format === "csv") {
      const table = (params.get("table") ?? "loads") as CsvTable
      const truck = params.get("truck")
      const columns = (params.get("columns") ?? "").split(",").filter((c): c is SheetColumn => c === "location" || c === "pieces")
      const file = `${name}-${table === "sheet" ? `shipments${truck ? `-${truck}` : ""}` : table}.csv`.replace(/[^\w.-]/g, "_")
      return new Response(exportCsv(store, id, table, { truck, columns }), {
        headers: { "Cache-Control": "private, no-store", "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}"` },
      })
    }
    if (format === "geojson" || format === "matrix") {
      const detail = runDetail(store, id)
      if (detail.kind !== "pipeline" || detail.status !== "succeeded" || !detail.summary) throw new ApiError(409, "run_not_succeeded", "Only succeeded pipeline runs with results can be exported in this format.")
      const summary = detail.summary
      if (format === "geojson") {
        return new Response(JSON.stringify(buildRouteGeoJson(id, summary, params.get("geometry") === "road" ? cachedGeometries(store, id) : undefined)), {
          headers: { "Cache-Control": "private, no-store", "content-type": "application/geo+json", "content-disposition": `attachment; filename="${name}.geojson"` },
        })
      }
      const as = params.get("as") ?? "json"
      if (as !== "csv" && as !== "json") throw new ApiError(400, "invalid_format", "as must be csv or json.", ["as"])
      const snapshotId = summary.travel?.mode === "snapshot" ? summary.travel.snapshot_id : null
      if (!snapshotId) throw new ApiError(409, "matrix_not_recorded", "This run used estimated travel (straight line × circuity). No matrix was recorded, so there is nothing to export; rerun with a travel snapshot to get one.")
      const exampleRun = store.versionOwner(view.versionId) === EXAMPLES_OWNER
      const info = store.travelSnapshotInfo(snapshotId, OWNER) ?? (exampleRun ? store.travelSnapshotInfo(snapshotId, EXAMPLES_OWNER) : null)
      if (!info) throw new ApiError(404, "travel_snapshot_not_found", "The travel snapshot this run used is not available.")
      if (info.nodeCount > MAX_EXPORT_NODES) throw new ApiError(413, "matrix_too_large", `This matrix has ${info.nodeCount} nodes; run matrix exports are limited to ${MAX_EXPORT_NODES}.`)
      const snapshot = store.travelSnapshot(snapshotId)
      const file = `${name}-matrix.${as}`
      if (as === "csv") {
        return new Response(snapshotCsv(snapshot), { headers: { "Cache-Control": "private, no-store", "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}"` } })
      }
      return new Response(JSON.stringify(runMatrixJson(id, snapshot, summary.depot, summary.locations), null, 1), {
        headers: { "Cache-Control": "private, no-store", "content-type": "application/json", "content-disposition": `attachment; filename="${file}"` },
      })
    }
    if (format === "python") {
      let zip: Buffer
      try {
        zip = replayBundle(store, id, process.env.OPTIMIZER_SOURCE_DIR ?? join(process.cwd(), "../../services/optimizer"))
      } catch (error) {
        const code = error instanceof Error ? error.message : "error"
        if (code === "run_not_replayable") throw new ApiError(409, code, "Only succeeded pipeline runs and k explorer jobs can be replayed.")
        if (code === "bundle_too_large") throw new ApiError(413, code, "This run is too large for a replay bundle; use the JSON export.")
        throw error
      }
      return new Response(new Uint8Array(zip), {
        headers: { "Cache-Control": "private, no-store", "content-type": "application/zip", "content-disposition": `attachment; filename="${name}-replay.zip"` },
      })
    }
    throw new ApiError(400, "invalid_format", "format must be json, csv, geojson, matrix or python.", ["format"])
  } catch (error) {
    return errorResponse(error)
  }
}
