import { MAX_SNAPSHOT_BYTES } from "@fillrate/db/travel"
import { OWNER } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
// Stores one immutable directed travel snapshot (spec §7) under its content hash and returns its identity,
// which run settings then name as `travel_snapshot_id`.
export async function POST(request: Request) {
  try {
    const body = await boundedJson(request, MAX_SNAPSHOT_BYTES)
    const saved = initializeDatabase().saveTravelSnapshot(body, Date.now(), OWNER)
    return Response.json(saved, { status: saved.created ? 201 : 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && /^(invalid_travel_snapshot|travel_snapshot_too_large)/.test(error.message)) {
      const [code, ...detail] = error.message.split(": ")
      return errorResponse(new ApiError(422, code, detail.join(": ")))
    }
    return errorResponse(error)
  }
}

export async function GET() {
  try {
    const snapshots = initializeDatabase().listTravelSnapshots(OWNER)
    return Response.json({ snapshots }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return errorResponse(error) }
}
