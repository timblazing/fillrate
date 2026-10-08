export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Build workers also run register(); only a serving process owns the worker port.
    const serving = process.env.NEXT_PHASE !== "phase-production-build"
    const { initializeDatabase, startWorkerTransport } = await import("./lib/server/database")
    initializeDatabase()
    if (serving) await startWorkerTransport()
  }
}
