import { join } from "node:path"
import { replayBundle } from "@fillrate/db/replay"

import { initializeDatabase } from "@/lib/server/database"
import { exportCsv, exportJson, type CsvTable } from "@/lib/server/export"
import type { SheetColumn } from "@/lib/shipment-sheet"
import { ApiError, errorResponse } from "@/lib/server/runs"
import { assertRunRead, principal } from "@/lib/server/access"

export const dynamic = "force-dynamic"

// ?format=json (default), ?format=python (replay bundle .zip) or ?format=csv&table=loads|unplanned|clusters|products|sheet
// The sheet table takes optional &truck=<truck id> and &columns=location,pieces.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/export">) {
  try {
    const { id } = await ctx.params
    const params = new URL(request.url).searchParams
    const format = params.get("format") ?? "json"
    const store = initializeDatabase()
    assertRunRead(store, await principal(request), id)
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
    if (format === "python") {
      let zip: Buffer
      try {
        zip = replayBundle(store, id, process.env.OPTIMIZER_SOURCE_DIR ?? join(process.cwd(), "../../services/optimizer"))
      } catch (error) {
        const code = error instanceof Error ? error.message : "error"
        if (code === "run_not_replayable") throw new ApiError(409, code, "Only succeeded pipeline runs can be replayed.")
        if (code === "bundle_too_large") throw new ApiError(413, code, "This run is too large for a replay bundle; use the JSON export.")
        throw error
      }
      return new Response(new Uint8Array(zip), {
        headers: { "Cache-Control": "private, no-store", "content-type": "application/zip", "content-disposition": `attachment; filename="${name}-replay.zip"` },
      })
    }
    throw new ApiError(400, "invalid_format", "format must be json, csv or python.", ["format"])
  } catch (error) {
    return errorResponse(error)
  }
}
