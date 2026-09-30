import { initializeDatabase, workerTransport } from "@/lib/server/database"

export const dynamic = "force-dynamic"

// Container HEALTHCHECK target (spec §14): database, queue and worker connection.
export function GET() {
  try {
    const store = initializeDatabase()
    store.sqlite.prepare("SELECT 1").get()
    const contact = workerTransport()?.lastContact() ?? null
    const workerAgeMs = contact ? Date.now() - contact.at : null
    return Response.json({
      status: "ok",
      database: "ok",
      queue: store.queueStats(),
      worker: { connected: workerAgeMs !== null && workerAgeMs < 30_000, last_contact_ms_ago: workerAgeMs },
    })
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503 })
  }
}
