import { principal } from "@/lib/server/access"
import { deleteBaseline, readBaseline } from "@/lib/server/baselines"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

// GET: one of your saved baselines with the evaluator's outcome at save time. Anyone else's is 404.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/baselines/[id]">) {
  try {
    const { id } = await ctx.params
    return Response.json(readBaseline(initializeDatabase(), await principal(request), id), { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

// DELETE: removes your baseline (409 while a queued or running solve starts from it).
export async function DELETE(request: Request, ctx: RouteContext<"/api/v1/baselines/[id]">) {
  try {
    const { id } = await ctx.params
    deleteBaseline(initializeDatabase(), await principal(request), id)
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
