import { parseContract } from "@fillrate/contracts"
import { preflightChecks } from "@fillrate/db/preflight"
import { validateScenario } from "@fillrate/db/scenarios"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    assertScenarioAccess(request)
    const {versionId,settings} = await boundedJson(request)
    const store = initializeDatabase()
    if (!store.sqlite.prepare("SELECT 1 FROM scenario_sources WHERE versionId=?").get(versionId)) throw new ApiError(404,"version_not_found","No saved imported scenario version.")
    const document = validateScenario(store.versionDocument(versionId).document)
    return Response.json({findings:preflightChecks(document,parseContract("RunSettings",settings))}, {headers:{"Cache-Control":"private, no-store"}})
  } catch(error) { return errorResponse(error) }
}
