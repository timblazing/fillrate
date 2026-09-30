import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, runDetail } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

export async function GET(_request: Request, ctx: RouteContext<"/api/v1/runs/[id]">) {
  try {
    const { id } = await ctx.params
    return Response.json(runDetail(initializeDatabase(), id))
  } catch (error) {
    return errorResponse(error)
  }
}
