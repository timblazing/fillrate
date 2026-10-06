import { valhallaConfigured } from "@fillrate/db/travel-job"
import { initializeDatabase, workerTransport } from "@/lib/server/database"

export const dynamic = "force-dynamic"

// Container HEALTHCHECK target (spec §14): database, queue, worker connection and road provider configuration.
// The road provider reports its recorded identity (image, extract dataset, costing) but never the endpoint.
function roadProvider() {
  if (!valhallaConfigured()) return { valhalla: { configured: false } }
  return { valhalla: {
    configured: true,
    version: process.env.VALHALLA_VERSION,
    dataset_revision: process.env.VALHALLA_DATASET_REVISION,
    graph_config_hash: process.env.VALHALLA_GRAPH_CONFIG_HASH,
    costing: "truck",
    costing_label: process.env.VALHALLA_COSTING_LABEL || null,
  } }
}

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
      road: roadProvider(),
    })
  } catch {
    return Response.json({ status: "error", database: "unavailable" }, { status: 503 })
  }
}
