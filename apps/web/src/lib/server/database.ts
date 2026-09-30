import "server-only";
import { join } from "node:path";
import { defaultDatabasePath, openDatabase, type Store } from "@fillrate/db";

const globalDatabase = globalThis as typeof globalThis & { fillrateStore?: Store };
export function initializeDatabase() {
  return globalDatabase.fillrateStore ??= openDatabase(
    defaultDatabasePath(join(process.cwd(), "../..")),
    process.env.DB_MIGRATIONS_DIR ?? join(process.cwd(), "../../packages/db/migrations"),
  );
}
