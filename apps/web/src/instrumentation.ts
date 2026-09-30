export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeDatabase, startWorkerTransport } = await import("./lib/server/database");
    initializeDatabase();
    // Build workers also run register(); only a serving process owns the worker port.
    if (process.env.NEXT_PHASE !== "phase-production-build") await startWorkerTransport();
  }
}
