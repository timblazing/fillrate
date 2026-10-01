import { MAX_SNAPSHOT_BYTES } from "@fillrate/db/travel"
import { principal, quotas, requireOwner, workAdmission } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
// Stores one immutable directed travel snapshot (spec §7) under its content hash and returns its identity,
// which run settings then name as `travel_snapshot_id`. The uploader's account holds a link to it; hosted
// accounts are held to the upload size limit and a daily upload quota.
export async function POST(request: Request) {
  try {
    const who = await principal(request)
    const ownerId = requireOwner(who)
    const store = initializeDatabase()
    const body = await boundedJson(request, who.kind === "user" ? Math.min(quotas().uploadBytes, MAX_SNAPSHOT_BYTES) : MAX_SNAPSHOT_BYTES)
    const charge = workAdmission(who, "upload")
    const save = () => store.saveTravelSnapshot(body, Date.now(), ownerId)
    const saved = charge ? store.admitWork(charge, 1, save) : save()
    return Response.json(saved, { status: saved.created ? 201 : 200, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    if (error instanceof Error && /^(invalid_travel_snapshot|travel_snapshot_too_large)/.test(error.message)) {
      const [code, ...detail] = error.message.split(": ")
      return errorResponse(new ApiError(422, code, detail.join(": ")))
    }
    return errorResponse(error)
  }
}
