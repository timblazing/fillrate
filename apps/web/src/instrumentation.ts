export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Build workers also run register(); only a serving process owns running solves.
    const serving = process.env.NEXT_PHASE !== "phase-production-build"
    const { initializeDatabase } = await import("./lib/server/database")
    const store = initializeDatabase()
    // A restart kills every in-flight solve, so no run can still be queued or running.
    if (serving) store.failInterruptedRuns()
  }
}
