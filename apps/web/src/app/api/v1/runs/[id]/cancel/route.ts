import { initializeDatabase } from "@/lib/server/database"
import { ApiError, assertRunAccess, errorResponse, runDetail } from "@/lib/server/runs"

// Requests cancellation. A queued run is cancelled at once; a running one when the worker
// has killed its solver process and acknowledged (or its lease expires).
export async function POST(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/cancel">) {
  try {
    assertRunAccess(request)
    const { id } = await ctx.params
    const store = initializeDatabase()
    try {
      store.cancel(id)
    } catch (error) {
      if (error instanceof Error && error.message === "run_not_found") throw new ApiError(404, "run_not_found", "No run with this ID.")
      throw error
    }
    return Response.json(runDetail(store, id), { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}
