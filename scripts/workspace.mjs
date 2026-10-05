// Runs a script in one workspace with the package manager that invoked the root script, so the root
// scripts work under both `bun run` and `npm run` (spec §14 local distribution). Usage from a root
// package.json script: `node scripts/workspace.mjs <workspace dir> <script> [args...]`.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [dir, script, ...args] = process.argv.slice(2);
if (!dir || !script) {
  console.error("usage: node scripts/workspace.mjs <workspace dir> <script> [args...]");
  process.exit(64);
}

// Bun and npm both set npm_execpath for scripts they run: the bun binary, or npm's JavaScript entry point.
const execPath = process.env.npm_execpath;
const [command, prefix] = !execPath ? ["npm", []]
  : /\.[cm]?js$/.test(execPath) ? [process.execPath, [execPath]]
  : [execPath, []];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(command, [...prefix, "run", script, ...(args.length ? ["--", ...args] : [])], {
  cwd: join(root, dir),
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
