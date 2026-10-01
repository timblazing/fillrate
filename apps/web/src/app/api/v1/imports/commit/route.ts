import { previewCsvImport } from "@fillrate/db/imports"
import { saveScenario } from "@fillrate/db/scenarios"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    assertScenarioAccess(request); const body = await boundedJson(request); const preview = previewCsvImport(body);
    if (!preview.valid || !preview.document) throw new ApiError(400, "invalid_import", "Resolve import errors before saving.");
    return Response.json(saveScenario(initializeDatabase(), {document:preview.document, source:{originals:preview.originals,mappings:preview.mappings}, author:body.author, metadata:body.metadata}), {status:201});
  } catch (error) { return errorResponse(error) }
}
