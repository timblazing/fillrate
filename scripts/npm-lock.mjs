// Keeps the npm lockfile (package-lock.json) aligned with the canonical bun.lock (decisions 2026-10-05).
//   node scripts/npm-lock.mjs          check: every direct dependency of every workspace resolves to the same
//                                      version in both lockfiles; exits 1 and lists the differences otherwise
//   node scripts/npm-lock.mjs --sync   rewrite package-lock.json: pin each direct dependency to its bun.lock
//                                      version, resolve with npm, then restore the declared ranges (npm keeps
//                                      locked versions that still satisfy them)
// Transitive dependencies are resolved by npm within the declared ranges and may differ from bun.lock.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kinds = ["dependencies", "devDependencies", "optionalDependencies"];
// bun.lock is JSON with trailing commas.
const readBunLock = () => JSON.parse(readFileSync(join(root, "bun.lock"), "utf8").replace(/,(\s*[}\]])/g, "$1"));

function bunVersions() {
  const lock = readBunLock();
  const names = new Set(Object.values(lock.workspaces).map((w) => w.name));
  const out = [];
  for (const [path, workspace] of Object.entries(lock.workspaces)) {
    for (const kind of kinds) {
      for (const dep of Object.keys(workspace[kind] ?? {})) {
        if (names.has(dep)) continue; // workspace link
        const entry = lock.packages[`${workspace.name}/${dep}`] ?? lock.packages[dep];
        if (!entry) throw new Error(`bun.lock has no resolution for ${dep} (${path || "root"})`);
        out.push({ path, kind, dep, version: entry[0].slice(entry[0].lastIndexOf("@") + 1) });
      }
    }
  }
  return out;
}

function npmVersion(lock, path, dep) {
  const nested = path ? lock.packages[`${path}/node_modules/${dep}`] : undefined;
  return (nested ?? lock.packages[`node_modules/${dep}`])?.version;
}

function check() {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const drift = bunVersions()
    .map((d) => ({ ...d, npm: npmVersion(lock, d.path, d.dep) }))
    .filter((d) => d.npm !== d.version);
  for (const d of drift) console.error(`${d.path || "(root)"} ${d.dep}: bun.lock ${d.version}, package-lock.json ${d.npm ?? "missing"}`);
  if (drift.length) {
    console.error(`${drift.length} direct dependencies differ; run node scripts/npm-lock.mjs --sync after bun install.`);
    process.exit(1);
  }
  console.log("package-lock.json direct dependencies match bun.lock");
}

function sync() {
  const pins = bunVersions();
  const files = [...new Set(pins.map((p) => join(root, p.path, "package.json")))];
  const original = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  const npm = (...args) => execFileSync("npm", ["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund", ...args], { cwd: root, stdio: "inherit" });
  try {
    for (const file of files) {
      const pkg = JSON.parse(original.get(file));
      for (const p of pins) if (join(root, p.path, "package.json") === file) pkg[p.kind][p.dep] = p.version;
      writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
    }
    npm();
  } finally {
    for (const [file, text] of original) writeFileSync(file, text);
  }
  npm();
  check();
}

if (process.argv.includes("--sync")) sync();
else check();
