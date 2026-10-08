import "server-only";
import { join } from "node:path";
import { defaultDatabasePath, openDatabase, type Store } from "@fillrate/db";
import { createSolver, type Solver } from "@fillrate/db/solver";

const globalDatabase = globalThis as typeof globalThis & { fillrateStore?: Store; fillrateSolver?: Solver };
const databasePath = () => defaultDatabasePath(join(process.cwd(), "../.."));

export function initializeDatabase() {
  return globalDatabase.fillrateStore ??= openDatabase(
    databasePath(),
    process.env.DB_MIGRATIONS_DIR ?? join(process.cwd(), "../../packages/db/migrations"),
  );
}

/** Starts runs one at a time against the optimizer service (`FILLRATE_OPTIMIZER_URL`, default http://127.0.0.1:8000). */
export const solver = () => globalDatabase.fillrateSolver ??= createSolver(initializeDatabase());
