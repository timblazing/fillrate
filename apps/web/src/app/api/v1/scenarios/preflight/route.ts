import { parseContract } from "@fillrate/contracts"
import { preflightChecks } from "@fillrate/db/preflight"
import { validateScenario } from "@fillrate/db/scenarios"
import { assertOwnVersion, principal } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson, selectedTravel } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    const who = await principal(request)
    const {versionId,settings} = await boundedJson(request)
    const store = initializeDatabase()
    const ownerId = assertOwnVersion(store, who, versionId)
    const document = validateScenario(store.versionDocument(versionId).document)
    const parsed = parseContract("RunSettings",settings)
    return Response.json({findings:preflightChecks(document,parsed,selectedTravel(store,document,parsed,ownerId))}, {headers:{"Cache-Control":"private, no-store"}})
  } catch(error) { return errorResponse(error) }
}
