import { principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { createRun, errorResponse, parseExample, parseOverrides, runDetail } from "@/lib/server/runs"
import { visibleRuns } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    return Response.json({ runs: visibleRuns(initializeDatabase(), await principal(request)) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

// Creates a run of a bundled synthetic scenario (`example`: "m1" default, "lesson" or "allocation"). Settings: k, kmeans_seed, solver_seed, inventory_percent, allocation_strategy, fulfillment_policy. Requires an Idempotency-Key header.
export async function POST(request: Request) {
  try {
    const who = await principal(request)
    const body = (await request.json().catch(() => ({}))) as { settings?: unknown; example?: unknown }
    const store = initializeDatabase()
    const id = createRun(store, who, request.headers.get("idempotency-key") ?? "", parseOverrides(body?.settings), parseExample(body?.example, "m1"))
    return Response.json(runDetail(store, id), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
