import { assertRunRead, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, runDetail } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

export async function GET(request: Request, ctx: RouteContext<"/api/v1/runs/[id]">) {
  try {
    const { id } = await ctx.params
    const store = initializeDatabase()
    assertRunRead(store, await principal(request), id)
    return Response.json(runDetail(store, id), {headers: {"Cache-Control": "private, no-store"}})
  } catch (error) {
    return errorResponse(error)
  }
}
