import { initializeDatabase } from "@/lib/server/database"

export const dynamic = "force-dynamic"

// Container HEALTHCHECK target: the database is open and answering.
export function GET() {
  try {
    const store = initializeDatabase()
    store.sqlite.prepare("SELECT 1").get()
    return Response.json({ status: "ok", database: "ok", runs: store.runCounts() })
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503 })
  }
}
