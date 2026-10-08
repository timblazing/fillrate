import { assertRunRead } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, runDetail } from "@/lib/server/runs"

// Requests cancellation. A queued run is cancelled at once; a running one when the worker
// has killed its solver process and acknowledged (or its lease expires).
export async function POST(_request: Request, ctx: RouteContext<"/api/v1/runs/[id]/cancel">) {
  try {
    const { id } = await ctx.params
    const store = initializeDatabase()
    assertRunRead(store, id)
    store.cancel(id)
    return Response.json(runDetail(store, id), { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}
