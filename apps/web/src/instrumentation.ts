export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Build workers also run register(); only a serving process checks the mode and owns the worker port.
    const serving = process.env.NEXT_PHASE !== "phase-production-build"
    if (serving) {
      // Spec §14: an incomplete hosted configuration refuses to start rather than serving without accounts.
      const { deploymentMode, ModeConfigError } = await import("@fillrate/db/hosted")
      try {
        deploymentMode(process.env)
      } catch (error) {
        if (!(error instanceof ModeConfigError)) throw error
        console.error(error.message)
        process.exit(78) // EX_CONFIG
      }
    }
    const { initializeDatabase, startWorkerTransport } = await import("./lib/server/database")
    initializeDatabase()
    if (serving) await startWorkerTransport()
  }
}
