import { initializeDatabase } from "@/lib/server/database"
import { createSweep, experimentDetail, publicExperiments } from "@/lib/server/experiments"
import { errorResponse } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

export function GET(request: Request) {
  let operator = true
  try { assertScenarioAccess(request) } catch { operator = false }
  return Response.json({ experiments: publicExperiments(initializeDatabase(), operator) }, { headers: { "Cache-Control": "private, no-store" } })
}

// Bounded sweep (spec §8a, §10). Body: { versionId? or example? ("lesson" default, "m1"), name, base?, axes: { k: [...], kmeans_seed: [...], ... }, comparison? }
export async function POST(request: Request) {
  try {
    const body = await boundedJson(request)
    const store = initializeDatabase()
    const id = createSweep(store, request, body ?? {}, request.headers.get("idempotency-key") ?? "")
    return Response.json(experimentDetail(store, id), { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
