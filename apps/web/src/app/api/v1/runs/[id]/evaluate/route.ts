import { assertRunRead, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { evaluateRunPlan, manualPlanContext } from "@/lib/server/evaluate"
import { ApiError, errorResponse } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

// GET ?cluster=C1: the cluster's problem visits and the run's optimized routes, for a manual plan editor.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/evaluate">) {
  try {
    const { id } = await ctx.params
    const store = initializeDatabase()
    assertRunRead(store, await principal(request), id)
    return Response.json(manualPlanContext(store, id, new URL(request.url).searchParams.get("cluster")), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

// POST { cluster_id, routes: [[visit_id, ...], ...] }: evaluates a manual plan with the run's own matrices and
// constraint semantics, next to the run's optimized routes (spec §10). Nothing is saved.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/evaluate">) {
  try {
    const { id } = await ctx.params
    const who = await principal(request)
    const store = initializeDatabase()
    const view = assertRunRead(store, who, id)
    const body = await request.json().catch(() => {
      throw new ApiError(400, "invalid_json", "Send a JSON plan.")
    })
    return Response.json(await evaluateRunPlan(store, who, id, view.versionId, body), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
