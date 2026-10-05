import { MAX_SNAPSHOT_BYTES, normalizeSnapshot, snapshotIdentity } from "@fillrate/db/travel"
import { initializeDatabase } from "@/lib/server/database"
import { principal, quotas, requireOwner, workAdmission } from "@/lib/server/access"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
import { travelSnapshotPreview } from "@/lib/server/travel-snapshot-preview"

export const dynamic = "force-dynamic"

/** Validate an uploaded matrix and return only a small inspector sample before it is saved. */
export async function POST(request: Request) {
  try {
    const who = await principal(request)
    requireOwner(who)
    const bodyLimit = who.kind === "user" ? Math.min(quotas().uploadBytes, MAX_SNAPSHOT_BYTES) : MAX_SNAPSHOT_BYTES
    const body = await boundedJson(request, bodyLimit)
    const snapshot = normalizeSnapshot(body)
    const store = initializeDatabase()
    const charge = workAdmission(who, "upload")
    const buildPreview = () => travelSnapshotPreview(snapshot, snapshotIdentity(snapshot))
    const preview = charge ? store.admitWork(charge, 1, buildPreview) : buildPreview()
    return Response.json(preview, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && /^(invalid_travel_snapshot|travel_snapshot_too_large)/.test(error.message)) {
      const [code, ...detail] = error.message.split(": ")
      return errorResponse(new ApiError(422, code, detail.join(": ")))
    }
    return errorResponse(error)
  }
}
