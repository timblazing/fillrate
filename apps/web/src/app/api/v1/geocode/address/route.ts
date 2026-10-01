import { geocodeAddress } from "@/lib/server/geocode"
import { errorResponse } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
/** One manual address through the Census one-line endpoint (with the ZIP fallback unless `fallback: "off"`). */
export async function POST(request: Request) {
  try { assertScenarioAccess(request); return Response.json(await geocodeAddress(await boundedJson(request))) }
  catch (error) { return errorResponse(error) }
}
