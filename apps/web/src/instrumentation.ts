export async function register() {
  // Playground mode is stateless: no database.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.FILLRATE_PLAYGROUND !== "1") {
    // Build workers also run register(); only a serving process owns running solves.
    const serving = process.env.NEXT_PHASE !== "phase-production-build"
    const { initializeDatabase } = await import("./lib/server/database")
    const store = initializeDatabase()
    // A restart kills every in-flight solve, so no run can still be queued or running.
    if (serving) store.failInterruptedRuns()
  }
}
