import { initializeDatabase } from "@/lib/server/database"
import { createExplorer } from "@/lib/server/experiments"
import { errorResponse, runDetail } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"

export const dynamic = "force-dynamic"

// k explorer job (spec §8a, §9): clustering only, over a k range × seeds plus H3 resolutions.
// Body: { versionId? (your imported version) or example? ("lesson" default, "m1"), base?: RunSettings overrides, settings: { ks, seeds, selected_k, reference_seed, h3_resolutions } }
export async function POST(request: Request) {
  try {
    const body = await boundedJson(request)
    const store = initializeDatabase()
    const id = createExplorer(store, body ?? {})
    return Response.json(runDetail(store, id), { status: 201, headers: { "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
