import { principal } from "@/lib/server/access"
import { baselineView, listRunBaselines, saveRunBaseline } from "@/lib/server/baselines"
import { initializeDatabase } from "@/lib/server/database"
import { ApiError, errorResponse } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

const PRIVATE = { "Cache-Control": "private, no-store" }

// GET: your saved manual baselines on this run (newest first). Baselines are owner-scoped; a run you can read
// but another account baselined shows only your own.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/baselines">) {
  try {
    const { id } = await ctx.params
    const who = await principal(request)
    return Response.json({ schema_version: 1, baselines: listRunBaselines(initializeDatabase(), who, id) }, { headers: PRIVATE })
  } catch (error) {
    return errorResponse(error)
  }
}

// POST { name, plan: { cluster_id, routes } } with an Idempotency-Key: evaluates the plan with the run's own
// validator and saves it with the outcome. Invalid plans are saved too, marked `valid: false`; they are never a
// warm-start source. The saved baseline belongs to the caller (bundled example runs may be baselined too).
export async function POST(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/baselines">) {
  try {
    const { id } = await ctx.params
    const who = await principal(request)
    const body = await request.json().catch(() => {
      throw new ApiError(400, "invalid_json", "Send {name, plan: {cluster_id, routes}}.")
    })
    const { record, replayed } = await saveRunBaseline(initializeDatabase(), who, id, request.headers.get("idempotency-key") ?? "", body)
    return Response.json(baselineView(record, true), { status: replayed ? 200 : 201, headers: PRIVATE })
  } catch (error) {
    return errorResponse(error)
  }
}
