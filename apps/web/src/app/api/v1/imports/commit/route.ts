import { previewImport } from "@fillrate/db/imports"
import { saveScenario } from "@fillrate/db/scenarios"
import { principal, quotas, requireOwner, workAdmission } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    const who = await principal(request); const ownerId = requireOwner(who); const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).");
    const body = await boundedJson(request, quotas().uploadBytes); const preview = previewImport(body);
    if (!preview.valid || !preview.document) throw new ApiError(400, "invalid_import", "Resolve import errors before saving.");
    const store = initializeDatabase(); const charge = workAdmission(who, "save")
    const save = () => saveScenario(store, {document:preview.document, source:{format:preview.format,originals:preview.originals,mappings:preview.mappings}, author:body.author, metadata:body.metadata, idempotencyKey, requestPayload:body, ownerId})
    return Response.json(charge ? store.admitWork(charge, 1, save) : save(), {status:201, headers: {"Cache-Control":"private, no-store"}});
  } catch (error) { if (error instanceof Error && error.message === "idempotency_conflict") return errorResponse(new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for a different save.")); return errorResponse(error) }
}
