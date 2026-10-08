import { assertRunRead } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { ApiError, errorResponse } from "@/lib/server/errors"
import { cachedGeometry, fetchGeometry, geometryStatus } from "@/lib/server/route-geometry"

export const dynamic = "force-dynamic"
const headers = { "Cache-Control": "private, no-store" }

// GET: without ?truck, whether road geometry is available for the run (and which trucks have it cached).
// With ?truck=<truck id>: the cached Valhalla geometry, 404 geometry_not_fetched when not fetched yet, and
// 409 geometry_unavailable (reason estimated_travel | imported_matrix | provider_context_mismatch |
// valhalla_not_configured) for runs whose travel data is not this deployment's Valhalla. Nothing is fetched.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/geometry">) {
  try {
    const { id } = await ctx.params
    const store = initializeDatabase()
    assertRunRead(store, id)
    const truck = new URL(request.url).searchParams.get("truck")
    return Response.json(truck === null ? geometryStatus(store, id) : cachedGeometry(store, id, truck), { headers })
  } catch (error) {
    return errorResponse(error)
  }
}

// POST { truck } with an Idempotency-Key: fetches Valhalla's route for one inspected truck (never a whole run),
// caches it and returns it. A cached truck returns at once at once.
export async function POST(request: Request, ctx: RouteContext<"/api/v1/runs/[id]/geometry">) {
  try {
    const { id } = await ctx.params
    const store = initializeDatabase()
    assertRunRead(store, id)
    const key = request.headers.get("idempotency-key")
    if (!key || key.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).")
    const body = await request.json().catch(() => {
      throw new ApiError(400, "invalid_json", "Send JSON: { \"truck\": \"<truck id>\" }.")
    }) as { truck?: unknown }
    const result = await fetchGeometry(store, id, body?.truck)
    return Response.json({ ...result.geometry, cached: result.cached }, { headers })
  } catch (error) {
    return errorResponse(error)
  }
}
