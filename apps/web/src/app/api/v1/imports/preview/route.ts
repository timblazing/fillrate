import { previewCsvImport } from "@fillrate/db/imports"
import { errorResponse } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try { assertScenarioAccess(request); return Response.json(previewCsvImport(await boundedJson(request))) }
  catch (error) { return errorResponse(error) }
}
