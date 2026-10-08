import { previewImport } from "@fillrate/db/imports"
import { saveScenario } from "@fillrate/db/scenarios"
import { OWNER } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    const body = await boundedJson(request); const preview = previewImport(body);
    if (!preview.valid || !preview.document) throw new ApiError(400, "invalid_import", "Resolve import errors before saving.");
    const store = initializeDatabase()
    return Response.json(saveScenario(store, {document:preview.document, source:{format:preview.format,originals:preview.originals,mappings:preview.mappings}, author:body.author, metadata:body.metadata, ownerId: OWNER}), {status:201, headers: {"Cache-Control":"private, no-store"}});
  } catch (error) { return errorResponse(error) }
}
