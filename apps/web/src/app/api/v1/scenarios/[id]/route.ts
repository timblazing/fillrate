import { saveScenario, scenarioVersion } from "@fillrate/db/scenarios"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
export async function GET(request: Request, context: RouteContext<"/api/v1/scenarios/[id]">) {
  try { assertScenarioAccess(request); const {id} = await context.params; return Response.json(scenarioVersion(initializeDatabase(), id, new URL(request.url).searchParams.get("version") ?? undefined), {headers: {"Cache-Control":"private, no-store"}}) }
  catch (error) { return errorResponse(error) }
}
export async function POST(request: Request, context: RouteContext<"/api/v1/scenarios/[id]">) {
  try { assertScenarioAccess(request); const idempotencyKey = request.headers.get("idempotency-key") ?? ""; if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters)."); const {id} = await context.params; const body = await boundedJson(request); return Response.json(saveScenario(initializeDatabase(), {...body, scenarioId:id, idempotencyKey, requestPayload:body}), {status:201}) }
  catch (error) { if (error instanceof Error && error.message === "version_conflict") return errorResponse(new ApiError(409, "version_conflict", "This scenario changed. Save your edits as a new branch, or discard them and reload.")); if (error instanceof Error && error.message === "idempotency_conflict") return errorResponse(new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for a different save.")); return errorResponse(error) }
}
