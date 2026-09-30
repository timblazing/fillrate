import "server-only";
import { join } from "node:path";
import { defaultDatabasePath, openDatabase, type Store } from "@fillrate/db";
import { createWorkerTransport, resolveWorkerToken } from "@fillrate/db/transport";

type Transport = ReturnType<typeof createWorkerTransport>;
const globalDatabase = globalThis as typeof globalThis & { fillrateStore?: Store; fillrateTransport?: Transport };
const databasePath = () => defaultDatabasePath(join(process.cwd(), "../.."));

export function initializeDatabase() {
  return globalDatabase.fillrateStore ??= openDatabase(
    databasePath(),
    process.env.DB_MIGRATIONS_DIR ?? join(process.cwd(), "../../packages/db/migrations"),
  );
}

// Loopback-only worker endpoints on their own port (default 3100); see packages/db/src/transport.ts.
export async function startWorkerTransport() {
  if (globalDatabase.fillrateTransport) return globalDatabase.fillrateTransport;
  const transport = createWorkerTransport(initializeDatabase(), {
    token: resolveWorkerToken(databasePath()),
    port: Number(process.env.INTERNAL_PORT ?? 3100),
    leaseMs: Number(process.env.LEASE_MS ?? 60_000),
  });
  globalDatabase.fillrateTransport = transport;
  await transport.listen();
  return transport;
}

export const workerTransport = () => globalDatabase.fillrateTransport ?? null;
