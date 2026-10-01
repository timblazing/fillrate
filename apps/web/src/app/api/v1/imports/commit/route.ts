import { previewCsvImport } from "@fillrate/db/imports"
import { saveScenario } from "@fillrate/db/scenarios"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    assertScenarioAccess(request); const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).");
    const body = await boundedJson(request); const preview = previewCsvImport(body);
    if (!preview.valid || !preview.document) throw new ApiError(400, "invalid_import", "Resolve import errors before saving.");
    return Response.json(saveScenario(initializeDatabase(), {document:preview.document, source:{originals:preview.originals,mappings:preview.mappings}, author:body.author, metadata:body.metadata, idempotencyKey, requestPayload:body}), {status:201});
  } catch (error) { if (error instanceof Error && error.message === "idempotency_conflict") return errorResponse(new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for a different save.")); return errorResponse(error) }
}
