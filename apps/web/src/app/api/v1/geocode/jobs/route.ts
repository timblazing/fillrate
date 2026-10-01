import { startGeocodeJob } from "@/lib/server/geocode"
import { errorResponse } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
/** Queue a geocoding job for a saved version; poll GET /api/v1/geocode/jobs/<id>. */
export async function POST(request: Request) {
  try { assertScenarioAccess(request); return Response.json(startGeocodeJob(await boundedJson(request), request.headers.get("idempotency-key") ?? ""), { status: 202 }) }
  catch (error) { return errorResponse(error) }
}
