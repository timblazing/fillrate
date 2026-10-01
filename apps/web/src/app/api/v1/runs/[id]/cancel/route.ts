import { assertRunRead, canCancel, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { ApiError, errorResponse, runDetail } from "@/lib/server/runs"

// Requests cancellation. A queued run is cancelled at once; a running one when the worker
// has killed its solver process and acknowledged (or its lease expires). Admissions already
// charged stay charged, so cancelling and resubmitting cannot dodge the daily quota.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/cancel">) {
  try {
    const { id } = await ctx.params
    const who = await principal(request)
    const store = initializeDatabase()
    const view = assertRunRead(store, who, id)
    if (!canCancel(who, view.ownerId)) throw new ApiError(403, "forbidden", "Only whoever started this run can cancel it.")
    store.cancel(id)
    return Response.json(runDetail(store, id), { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}
