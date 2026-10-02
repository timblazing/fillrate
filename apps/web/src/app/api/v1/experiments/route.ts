import { accessError, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { createSweep, experimentDetail, visibleExperiments } from "@/lib/server/experiments"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const who = await principal(request)
    if (who.kind === "pending") throw accessError(who)
    return Response.json({ experiments: visibleExperiments(initializeDatabase(), who) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

// Bounded sweep (spec §8a, §10). Body: { versionId? or example? ("lesson" default, "m1"), name, base?, axes: { k: [...], kmeans_seed: [...], ... }, comparison? }
export async function POST(request: Request) {
  try {
    const who = await principal(request)
    const body = await boundedJson(request)
    const store = initializeDatabase()
    const id = createSweep(store, who, body ?? {}, request.headers.get("idempotency-key") ?? "")
    return Response.json(experimentDetail(store, id), { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
