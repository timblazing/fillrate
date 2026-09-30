import { initializeDatabase } from "@/lib/server/database"
import { assertRunAccess, createRun, errorResponse, parseOverrides, runDetail } from "@/lib/server/runs"

export const dynamic = "force-dynamic"

export function GET() {
  const store = initializeDatabase()
  return Response.json({ runs: store.listRuns(50) })
}

// Creates a run of the bundled synthetic scenario. Requires an Idempotency-Key header.
export async function POST(request: Request) {
  try {
    assertRunAccess(request)
    const body = (await request.json().catch(() => ({}))) as { settings?: unknown }
    const store = initializeDatabase()
    const id = createRun(store, request.headers.get("idempotency-key") ?? "", parseOverrides(body?.settings))
    return Response.json(runDetail(store, id), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
