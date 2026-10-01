import { MAX_SNAPSHOT_BYTES } from "@fillrate/db/travel"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
// Stores one immutable directed travel snapshot (spec §7) under its content hash and returns its identity,
// which run settings then name as `travel_snapshot_id`. Operator-only, like every imported-data write.
export async function POST(request: Request) {
  try {
    assertScenarioAccess(request)
    const store = initializeDatabase()
    const saved = store.saveTravelSnapshot(await boundedJson(request, MAX_SNAPSHOT_BYTES))
    return Response.json(saved, { status: saved.created ? 201 : 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && /^(invalid_travel_snapshot|travel_snapshot_too_large)/.test(error.message)) {
      const [code, ...detail] = error.message.split(": ")
      return errorResponse(new ApiError(422, code, detail.join(": ")))
    }
    return errorResponse(error)
  }
}
