import { saveScenario, scenarioVersion } from "@fillrate/db/scenarios"
import { principal, quotas, requireOwner, workAdmission } from "@/lib/server/access"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, ApiError } from "@/lib/server/runs"
import { boundedJson } from "@/lib/server/scenarios"
export const dynamic = "force-dynamic"
export async function GET(request: Request, context: RouteContext<"/api/v1/scenarios/[id]">) {
  try { const ownerId = requireOwner(await principal(request)); const {id} = await context.params; return Response.json(scenarioVersion(initializeDatabase(), id, new URL(request.url).searchParams.get("version") ?? undefined, ownerId), {headers: {"Cache-Control":"private, no-store"}}) }
  catch (error) { return errorResponse(error) }
}
export async function POST(request: Request, context: RouteContext<"/api/v1/scenarios/[id]">) {
  try {
    const who = await principal(request); const ownerId = requireOwner(who)
    const idempotencyKey = request.headers.get("idempotency-key") ?? ""; if (!idempotencyKey || idempotencyKey.length > 200) throw new ApiError(400, "invalid_idempotency_key", "Send an Idempotency-Key header (1–200 characters).")
    const {id} = await context.params; const body = await boundedJson(request, quotas().uploadBytes); const store = initializeDatabase(); const charge = workAdmission(who, "save")
    const save = () => saveScenario(store, {...body, scenarioId:id, idempotencyKey, requestPayload:body, ownerId})
    return Response.json(charge ? store.admitWork(charge, 1, save) : save(), {status:201, headers: {"Cache-Control":"private, no-store"}})
  }
  catch (error) { if (error instanceof Error && error.message === "version_conflict") return errorResponse(new ApiError(409, "version_conflict", "This scenario changed. Save your edits as a new branch, or discard them and reload.")); if (error instanceof Error && error.message === "idempotency_conflict") return errorResponse(new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for a different save.")); return errorResponse(error) }
}
/** Deletes the scenario with every version, branch, run, sweep and geocoding job made from it (spec §14). */
export async function DELETE(request: Request, context: RouteContext<"/api/v1/scenarios/[id]">) {
  try {
    const ownerId = requireOwner(await principal(request)); const {id} = await context.params; const store = initializeDatabase()
    if (store.scenarioOwner(id) !== ownerId) throw new ApiError(404, "scenario_not_found", "No scenario with this ID.")
    try { return Response.json({ deleted: store.deleteScenarios([id]) }, {headers: {"Cache-Control":"private, no-store"}}) }
    catch (error) { if (error instanceof Error && error.message === "active_work") throw new ApiError(409, "active_work", "Cancel this scenario's unfinished runs and geocoding jobs before deleting it."); throw error }
  } catch (error) { return errorResponse(error) }
}
