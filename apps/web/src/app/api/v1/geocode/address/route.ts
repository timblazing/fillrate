import { geocodeAddress } from "@/lib/server/geocode"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
/** One manual address through the Census one-line endpoint (with the ZIP fallback unless `fallback: "off"`). */
export async function POST(request: Request) {
  try { return Response.json(await geocodeAddress(await boundedJson(request, 64 * 1024)), { headers: { "Cache-Control": "private, no-store" } }) }
  catch (error) { return errorResponse(error) }
}
