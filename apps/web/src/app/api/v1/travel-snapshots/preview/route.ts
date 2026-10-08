import { MAX_SNAPSHOT_BYTES, normalizeSnapshot, snapshotIdentity } from "@fillrate/db/travel"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
import { travelSnapshotPreview } from "@/lib/server/travel-snapshot-preview"

export const dynamic = "force-dynamic"

/** Validate an uploaded matrix and return only a small inspector sample before it is saved. */
export async function POST(request: Request) {
  try {
    const body = await boundedJson(request, MAX_SNAPSHOT_BYTES)
    const snapshot = normalizeSnapshot(body)
    const preview = travelSnapshotPreview(snapshot, snapshotIdentity(snapshot))
    return Response.json(preview, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && /^(invalid_travel_snapshot|travel_snapshot_too_large)/.test(error.message)) {
      const [code, ...detail] = error.message.split(": ")
      return errorResponse(new ApiError(422, code, detail.join(": ")))
    }
    return errorResponse(error)
  }
}
