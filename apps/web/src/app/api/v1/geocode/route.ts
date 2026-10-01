import { capabilities } from "@/lib/server/geocode"
import { errorResponse } from "@/lib/server/runs"
export const dynamic = "force-dynamic"
/** Which geocoders this server offers (spec §3: hide unavailable modes rather than show inert controls). */
export async function GET() {
  try { return Response.json(capabilities()) }
  catch (error) { return errorResponse(error) }
}
