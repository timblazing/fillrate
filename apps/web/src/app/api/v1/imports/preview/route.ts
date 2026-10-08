import { previewImport } from "@fillrate/db/imports"
import { errorResponse } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try { return Response.json(previewImport(await boundedJson(request)), {headers: {"Cache-Control":"private, no-store"}}) }
  catch (error) { return errorResponse(error) }
}
