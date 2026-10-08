import { parseContract } from "@fillrate/contracts"
import { preflightChecks } from "@fillrate/db/preflight"
import { validateScenario } from "@fillrate/db/scenarios"
import { assertOwnVersion } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    const {versionId,settings} = await boundedJson(request)
    const store = initializeDatabase()
    assertOwnVersion(store, versionId)
    const document = validateScenario(store.versionDocument(versionId).document)
    const parsed = parseContract("RunSettings",settings)
    return Response.json({findings:preflightChecks(document,parsed)}, {headers:{"Cache-Control":"private, no-store"}})
  } catch(error) { return errorResponse(error) }
}
