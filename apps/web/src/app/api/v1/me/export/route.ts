import { scenarioList, scenarioVersion } from "@fillrate/db/scenarios"

import { principal, requireOwner } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

/** Your data as JSON: each scenario's latest version with its import source, plus your runs and sweeps (spec §14 export). */
export async function GET(request: Request) {
  try {
    const who = await principal(request)
    const ownerId = requireOwner(who)
    const store = initializeDatabase()
    const scenarios = (scenarioList(store, ownerId) as { id: string }[]).map(row => scenarioVersion(store, row.id, undefined, ownerId))
    const runs = store.sqlite.prepare("SELECT id, versionId, kind, status, createdAt FROM runs WHERE ownerId=? ORDER BY createdAt").all(ownerId)
    const experiments = store.sqlite.prepare("SELECT id, name, versionId, createdAt FROM experiments WHERE ownerId=? ORDER BY createdAt").all(ownerId)
    const body = JSON.stringify({ schema_version: 1, exported_at: new Date().toISOString(), account: who.user, scenarios, runs, experiments, note: "Each run's full result is at /api/v1/runs/<id>/export." }, null, 1)
    return new Response(body, { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="fillrate-my-data.json"', "Cache-Control": "private, no-store" } })
  } catch (error) {
    return errorResponse(error)
  }
}
