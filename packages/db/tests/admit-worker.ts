import { openDatabase } from "../src/index";
// Races one enqueue against other processes for the same owner (argv: db path, version id, idempotency key).
const store = openDatabase(process.argv[2]);
try {
  const id = store.enqueue(process.argv[3], { schema_version: 1, document: { race: process.argv[4] } }, process.argv[4], Date.now(), 3, "pipeline", { ownerId: "user:a", admission: { ownerId: "user:a", maxActive: 1, buckets: [{ bucket: "solves:user:a", limit: 20, windowMs: 86_400_000, label: "daily solve admissions" }] } });
  process.stdout.write(JSON.stringify({ id }));
} catch (error) { process.stdout.write(JSON.stringify({ error: (error as Error).message })); }
finally { store.close(); }
