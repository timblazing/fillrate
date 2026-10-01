import { principal } from "@/lib/server/access"
import { mode } from "@/lib/server/auth"
import { initializeDatabase } from "@/lib/server/database"
import { errorResponse, runDetail } from "@/lib/server/runs"
import { boundedJson, createScenarioRun } from "@/lib/server/scenarios"
export async function POST(request: Request) {
  try {
    const who = await principal(request); const body = await boundedJson(request); const store = initializeDatabase()
    const id = createScenarioRun(store, who, body.versionId, body.settings, request.headers.get("idempotency-key") ?? "")
    // Operator-key deployments: remember the key for an hour so /runs/<id> pages can open imported runs.
    const operatorKey = mode().mode !== "local" && process.env.NODE_ENV === "production" && who.kind === "operator" ? request.headers.get("x-scenario-key") : null
    return Response.json(runDetail(store,id), {status:201, headers: operatorKey ? {"Set-Cookie": `fillrate_operator=${encodeURIComponent(operatorKey)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`, "Cache-Control":"private, no-store"} : {"Cache-Control":"private, no-store"}})
  }
  catch (error) { return errorResponse(error) }
}
