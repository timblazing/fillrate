import { principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { assertExperimentRead, experimentCsv, experimentDetail } from "@/lib/server/experiments"
import { ApiError, errorResponse } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

// ?format=json (default) or csv. Both include the compared settings, metric directions and ranking order.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/experiments/[id]/export">) {
  try {
    const { id } = await ctx.params
    const store = initializeDatabase()
    const experiment = store.experiment(id)
    if (!experiment) throw new ApiError(404, "experiment_not_found", "No experiment with this ID.")
    assertExperimentRead(store, await principal(request), experiment.versionId)
    const detail = experimentDetail(store, id)
    const format = new URL(request.url).searchParams.get("format") ?? "json"
    const name = `fillrate-sweep-${id.slice(0, 8)}`
    const headers = { "Cache-Control": "private, no-store" }
    if (format === "json") return new Response(JSON.stringify(detail, null, 1), { headers: { ...headers, "content-type": "application/json", "content-disposition": `attachment; filename="${name}.json"` } })
    if (format === "csv") return new Response(experimentCsv(detail), { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"` } })
    throw new ApiError(400, "invalid_format", "format must be json or csv.", ["format"])
  } catch (error) {
    return errorResponse(error)
  }
}
