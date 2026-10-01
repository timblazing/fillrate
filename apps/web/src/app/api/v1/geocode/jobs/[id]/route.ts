import { principal } from "@/lib/server/access"
import { readGeocodeJob } from "@/lib/server/geocode"
import { errorResponse } from "@/lib/server/runs"
export const dynamic = "force-dynamic"
export async function GET(request: Request, context: RouteContext<"/api/v1/geocode/jobs/[id]">) {
  try { const who = await principal(request); const { id } = await context.params; return Response.json(readGeocodeJob(who, id), { headers: { "Cache-Control": "private, no-store" } }) }
  catch (error) { return errorResponse(error) }
}
