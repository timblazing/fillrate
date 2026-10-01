import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, runDetail } from "@/lib/server/runs"
import { assertScenarioAccess, boundedJson, createScenarioRun } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try { assertScenarioAccess(request); const body = await boundedJson(request); const store = initializeDatabase(); const id = createScenarioRun(store, body.versionId, body.settings, request.headers.get("idempotency-key") ?? ""); return Response.json(runDetail(store,id), {status:201, headers: process.env.NODE_ENV === "production" ? {"Set-Cookie": `fillrate_operator=${encodeURIComponent(request.headers.get("x-scenario-key") ?? "")}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`, "Cache-Control":"private, no-store"} : {"Cache-Control":"private, no-store"}}) }
  catch (error) { return errorResponse(error) }
}
