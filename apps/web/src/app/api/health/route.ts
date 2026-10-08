import { initializeDatabase } from "@/lib/server/database"
import { playgroundMode } from "@/lib/server/playground"

export const dynamic = "force-dynamic"

// Container HEALTHCHECK target: the database is open and answering.
export function GET() {
  if (playgroundMode()) return Response.json({ status: "ok", mode: "playground" })
  try {
    const store = initializeDatabase()
    store.sqlite.prepare("SELECT 1").get()
    return Response.json({ status: "ok", database: "ok", runs: store.runCounts() })
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503 })
  }
}
