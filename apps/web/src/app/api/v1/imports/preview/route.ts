import { previewImport } from "@fillrate/db/imports"
import { principal, quotas, requireOwner } from "@/lib/server/access"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try { requireOwner(await principal(request)); return Response.json(previewImport(await boundedJson(request, quotas().uploadBytes)), {headers: {"Cache-Control":"private, no-store"}}) }
  catch (error) { return errorResponse(error) }
}
