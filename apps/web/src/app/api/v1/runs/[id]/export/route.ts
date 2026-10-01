import { initializeDatabase } from "@/lib/server/database"
import { exportCsv, exportJson, type CsvTable } from "@/lib/server/export"
import type { SheetColumn } from "@/lib/shipment-sheet"
import { ApiError, errorResponse } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

// ?format=json (default) or ?format=csv&table=loads|unplanned|clusters|products|sheet
// The sheet table takes optional &truck=<truck id> and &columns=location,pieces.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/export">) {
  try {
    const { id } = await ctx.params
    const params = new URL(request.url).searchParams
    const format = params.get("format") ?? "json"
    const store = initializeDatabase()
    const name = `fillrate-run-${id.slice(0, 8)}`
    if (format === "json") {
      return new Response(JSON.stringify(exportJson(store, id), null, 1), {
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${name}.json"` },
      })
    }
    if (format === "csv") {
      const table = (params.get("table") ?? "loads") as CsvTable
      const truck = params.get("truck")
      const columns = (params.get("columns") ?? "").split(",").filter((c): c is SheetColumn => c === "location" || c === "pieces")
      const file = `${name}-${table === "sheet" ? `shipments${truck ? `-${truck}` : ""}` : table}.csv`.replace(/[^\w.-]/g, "_")
      return new Response(exportCsv(store, id, table, { truck, columns }), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${file}"` },
      })
    }
    throw new ApiError(400, "invalid_format", "format must be json or csv.", ["format"])
  } catch (error) {
    return errorResponse(error)
  }
}
