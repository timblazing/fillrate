import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, runDetail } from "@/lib/server/runs"
import { boundedJson, createScenarioRun } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    const body = await boundedJson(request); const store = initializeDatabase()
    const id = createScenarioRun(store, body.versionId, body.settings)
    return Response.json(runDetail(store,id), {status:201, headers: {"Cache-Control":"private, no-store"}})
  }
  catch (error) { return errorResponse(error) }
}
