import { initializeDatabase } from "@/lib/server/database"
import { createSweep, experimentDetail, visibleExperiments } from "@/lib/server/experiments"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    return Response.json({ experiments: visibleExperiments(initializeDatabase()) }, { headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}

// Bounded sweep (spec §8a, §10). Body: { versionId? or example? ("lesson" default, "m1"), name, base?, axes: { k: [...], kmeans_seed: [...], ... }, comparison? }
export async function POST(request: Request) {
  try {
    const body = await boundedJson(request)
    const store = initializeDatabase()
    const id = createSweep(store, body ?? {})
    return Response.json(experimentDetail(store, id), { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
