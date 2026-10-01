import { scenarioList } from "@fillrate/db/scenarios"
import { principal, requireOwner } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse } from "@/lib/server/runs"
export const dynamic = "force-dynamic"
export async function GET(request: Request) {
  try { const ownerId = requireOwner(await principal(request)); return Response.json({scenarios: scenarioList(initializeDatabase(), ownerId)}, {headers: {"Cache-Control": "private, no-store"}}) }
  catch (error) { return errorResponse(error) }
}
