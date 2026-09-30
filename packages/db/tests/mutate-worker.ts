import { openDatabase } from "../src/index";
const store = openDatabase(process.argv[2]);
const lease = JSON.parse(process.argv[3]);
try {
  const result = process.argv[4] === "heartbeat" ? store.heartbeat(lease) : store.record({ lease, kind: "succeeded", sequence: 1, payload: {} }, [JSON.parse(process.argv[5])]);
  process.stdout.write(JSON.stringify(result));
} catch (error) { process.stdout.write(JSON.stringify({ error: (error as Error).message })); }
finally { store.close(); }
