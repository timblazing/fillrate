import { scenarioList } from "@fillrate/db/scenarios"
import { OWNER } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse } from "@/lib/server/runs"
export const dynamic = "force-dynamic"
export async function GET() {
  try { return Response.json({scenarios: scenarioList(initializeDatabase(), OWNER)}, {headers: {"Cache-Control": "private, no-store"}}) }
  catch (error) { return errorResponse(error) }
}
