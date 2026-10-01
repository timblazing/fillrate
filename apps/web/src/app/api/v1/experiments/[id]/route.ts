import { principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { assertExperimentRead, experimentDetail, saveExperimentComparison } from "@/lib/server/experiments"
import { ApiError, errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

export async function GET(request: Request, ctx: RouteContext<"/api/v1/experiments/[id]">) {
  try {
    const { id } = await ctx.params
    const store = initializeDatabase()
    const experiment = store.experiment(id)
    if (!experiment) throw new ApiError(404, "experiment_not_found", "No experiment with this ID.")
    assertExperimentRead(store, await principal(request), experiment.versionId)
    return Response.json(experimentDetail(store, id), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

// Save the comparison vector, ranking order and cohort with the experiment. Body: { comparison }
export async function PATCH(request: Request, ctx: RouteContext<"/api/v1/experiments/[id]">) {
  try {
    const { id } = await ctx.params
    const who = await principal(request)
    const body = await boundedJson(request)
    return Response.json(saveExperimentComparison(initializeDatabase(), who, id, body?.comparison))
  } catch (error) {
    return errorResponse(error)
  }
}
