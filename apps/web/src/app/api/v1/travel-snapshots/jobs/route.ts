import { valhallaConfigured } from "@fillrate/db/travel-job"
import { accessError, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { createTravelJob } from "@/lib/server/travel-jobs"
import { errorResponse, runDetail } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

// Whether this deployment can build Valhalla matrices (deployment env only; no endpoint or option is echoed).
export async function GET(request: Request) {
  try {
    const who = await principal(request)
    if (who.kind === "pending") throw accessError(who)
    return Response.json({ valhalla: { configured: valhallaConfigured() } }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return errorResponse(error) }
}

// Queues a durable job that builds a directed Valhalla travel snapshot for one of your saved scenario versions.
// Body: { versionId, idempotencyKey } (an Idempotency-Key header also works). 409 valhalla_not_configured when
// the server has no Valhalla deployment configured; nothing is queued then. Poll and cancel it as a run
// (GET /api/v1/runs/{id}, POST /api/v1/runs/{id}/cancel); the finished run's summary names the snapshot.
export async function POST(request: Request) {
  try {
    const who = await principal(request)
    const body = (await boundedJson(request, 64 * 1024).catch(() => ({}))) as { versionId?: unknown; idempotencyKey?: unknown }
    const key = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : request.headers.get("idempotency-key") ?? ""
    const store = initializeDatabase()
    const id = createTravelJob(store, who, body?.versionId, key)
    return Response.json(runDetail(store, id), { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) { return errorResponse(error) }
}
