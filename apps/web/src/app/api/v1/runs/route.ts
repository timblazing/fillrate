import { initializeDatabase } from "@/lib/server/database"
import { assertRunAccess, createRun, errorResponse, parseExample, parseOverrides, runDetail } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

import { publicRuns } from "@/lib/server/scenarios"

export function GET() {
  const store = initializeDatabase()
  return Response.json({ runs: publicRuns(store) })
}

// Creates a run of a bundled synthetic scenario (`example`: "m1" default, "lesson" or "allocation"). Settings: k, kmeans_seed, solver_seed, inventory_percent, allocation_strategy, fulfillment_policy. Requires an Idempotency-Key header.
export async function POST(request: Request) {
  try {
    assertRunAccess(request)
    const body = (await request.json().catch(() => ({}))) as { settings?: unknown; example?: unknown }
    const store = initializeDatabase()
    const id = createRun(store, request.headers.get("idempotency-key") ?? "", parseOverrides(body?.settings), parseExample(body?.example, "m1"))
    return Response.json(runDetail(store, id), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
