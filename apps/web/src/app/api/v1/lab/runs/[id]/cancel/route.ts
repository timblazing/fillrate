import { assertRunRead, canCancel, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { labRunDetail } from "@/lib/server/lab"
import { ApiError, errorResponse } from "@/lib/server/runs"

// Requests cancellation of a lab run: a queued run is cancelled at once, a running one when the worker has killed
// its solver process. Admissions already charged stay charged.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/lab/runs/[id]/cancel">) {
  try {
    const { id } = await ctx.params
    const who = await principal(request)
    const store = initializeDatabase()
    const view = assertRunRead(store, who, id)
    if (view.kind !== "lab") throw new ApiError(404, "run_not_found", "No lab run with this ID.")
    if (!canCancel(who, view.ownerId)) throw new ApiError(403, "forbidden", "Only whoever started this run can cancel it.")
    store.cancel(id)
    return Response.json(labRunDetail(store, id), { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}
