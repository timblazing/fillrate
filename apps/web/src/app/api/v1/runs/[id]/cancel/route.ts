import { assertRunRead } from "@/lib/server/access"
import { initializeDatabase, solver } from "@/lib/server/database"
import { errorResponse, runDetail } from "@/lib/server/runs"

// A queued run is cancelled at once; a running one is cancelled by killing its solver process in the optimizer service.
export async function POST(_request: Request, ctx: RouteContext<"/api/v1/runs/[id]/cancel">) {
  try {
    const { id } = await ctx.params
    const store = initializeDatabase()
    assertRunRead(store, id)
    await solver().cancel(id)
    return Response.json(runDetail(store, id), { status: 202 })
  } catch (error) {
    return errorResponse(error)
  }
}
