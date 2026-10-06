import { accessError, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { createLabRun, labRunDetail, visibleLabRuns } from "@/lib/server/lab"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const who = await principal(request)
    if (who.kind === "pending") throw accessError(who)
    return Response.json({ runs: visibleLabRuns(initializeDatabase(), who) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

// Queues one Solver Lab run (spec §4, M6). Body: { example: "dimensions" | "dimensions_volume" | "fleet" | "fleet_trucks" | "depots" | "depots_single" }
// for a bundled instance, or { instance: LabInstance } for your own (local/operator mode or a signed-in account).
// Requires an Idempotency-Key header.
export async function POST(request: Request) {
  try {
    const who = await principal(request)
    const body = (await boundedJson(request, 4 * 1024 * 1024)) as { example?: unknown; instance?: unknown }
    const store = initializeDatabase()
    const id = createLabRun(store, who, body ?? {}, request.headers.get("idempotency-key") ?? "")
    return Response.json(labRunDetail(store, id), { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
