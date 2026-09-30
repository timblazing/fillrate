import { openDatabase } from "../src/index";
const store = openDatabase(process.argv[2]);
try { process.stdout.write(JSON.stringify(store.claim(process.argv[3]))); }
finally { store.close(); }
