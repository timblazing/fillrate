import { scenarioList } from "@fillrate/db/scenarios"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse } from "@/lib/server/runs"
import { assertScenarioAccess } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
export function GET(request: Request) {
  try { assertScenarioAccess(request); return Response.json({scenarios: scenarioList(initializeDatabase())}, {headers: {"Cache-Control": "private, no-store"}}) }
  catch (error) { return errorResponse(error) }
}
