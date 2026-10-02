// Live two-account acceptance against a hosted deployment (spec §14, M4; docs/release-verification.md item 6).
// Sign in at the site with two different GitHub accounts (two browsers or a private window), copy each
// `__Secure-better-auth.session_token` cookie value from the browser's devtools, then:
//
//   FILLRATE_URL=https://fillrate.example.com COOKIE_A='…' COOKIE_B='…' node scripts/live-two-account.mjs [--sign-out-b]
//
// Account A imports a small synthetic scenario, solves it on the real worker, exports it and finally deletes
// it; account B and anonymous callers are refused at every step by guessed IDs. It spends one of A's daily
// solve admissions. --sign-out-b also signs B out at the end and checks that the old cookie stops working.
// Cookie values are secrets: they are never printed, and nothing is written to disk.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const example = JSON.parse(readFileSync(join(root, "examples/m1-synthetic.json"), "utf8"));
const base = (process.env.FILLRATE_URL ?? "").replace(/\/$/, "");
const { COOKIE_A, COOKIE_B } = process.env;
// FILLRATE_ORIGIN (rehearsal only): the site's public origin when FILLRATE_URL reaches it another way.
const origin = process.env.FILLRATE_ORIGIN ?? (base ? new URL(base).origin : "");
if (!origin.startsWith("https://") || !COOKIE_A || !COOKIE_B) {
  console.error("Set FILLRATE_URL (https), COOKIE_A and COOKIE_B (each account's __Secure-better-auth.session_token value).");
  process.exit(2);
}
const cookie = value => `__Secure-better-auth.session_token=${value.includes("%") ? value : encodeURIComponent(value)}`;
const A = { cookie: cookie(COOKIE_A), origin }, B = { cookie: cookie(COOKIE_B), origin }, anon = { origin };

let failures = 0, passes = 0;
function check(label, condition, detail = "") {
  if (condition) { passes++; console.log(`  ok   ${label}`); }
  else { failures++; console.log(`  FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}
async function call(path, who, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method, redirect: "manual",
    headers: { ...who, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(method !== "GET" ? { "idempotency-key": randomUUID() } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* CSV or HTML */ }
  return { status: response.status, body: json, text, headers: response.headers };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const metadata = { timezone: "America/Chicago", planningDate: new Date().toISOString().slice(0, 10), browserId: "live-two-account" };
const name = `Live isolation check ${new Date().toISOString()}`;

const meA = await call("/api/v1/me", A), meB = await call("/api/v1/me", B);
check("A is signed in", meA.body?.kind === "user", JSON.stringify(meA.body?.kind));
check("B is signed in", meB.body?.kind === "user", JSON.stringify(meB.body?.kind));
check("A and B are different accounts", meA.body?.user?.id && meA.body.user.id !== meB.body?.user?.id);
if (meA.body?.access !== "approved" || meB.body?.access !== "approved") {
  console.error("approve both accounts at /admin first");
  process.exit(2);
}
if (failures) process.exit(1);
console.log(`  A usage before: ${JSON.stringify(meA.body.usage?.solves)}`);

check("anonymous is not signed in", (await call("/api/v1/me", anon)).body?.kind === "anonymous");
check("anonymous import needs sign-in (401)", (await call("/api/v1/imports/commit", anon, { method: "POST", body: {} })).status === 401);
check("anonymous synthetic run needs sign-in (401)", (await call("/api/v1/runs", anon, { method: "POST", body: {} })).status === 401);
check("cross-origin write refused (403)", (await call("/api/v1/imports/commit", { ...A, origin: "https://evil.example" }, { method: "POST", body: {} })).status === 403);

const saved = await call("/api/v1/imports/commit", A, { method: "POST", body: { format: "json", name, depot: example.scenario.depot, scenarioJson: JSON.stringify({ ...example.scenario, name }), author: "live check", metadata } });
check("A imports a scenario", saved.status === 201, `${saved.status} ${saved.text.slice(0, 200)}`);
if (saved.status !== 201) process.exit(1);
const { scenarioId, versionId } = saved.body;
const settings = { ...example.settings, k: 1, solver_max_iterations: 200 };
const run = await call("/api/v1/scenarios/runs", A, { method: "POST", body: { versionId, settings } });
check("A starts a run", run.status === 201, `${run.status} ${run.text.slice(0, 200)}`);
const runId = run.body?.id;
const second = await call("/api/v1/runs", A, { method: "POST", body: {} });
check("A's second unfinished job is refused (429 active_limit, Retry-After)", second.status === 429 && second.body?.error?.code === "active_limit" && Number(second.headers.get("retry-after")) > 0, `${second.status} ${second.text.slice(0, 200)}`);

for (const [label, path, opts] of [
  ["read A's scenario", `/api/v1/scenarios/${scenarioId}`],
  ["save over A's scenario", `/api/v1/scenarios/${scenarioId}`, { method: "POST", body: { document: example.scenario, author: "B", metadata, expectedVersionId: versionId } }],
  ["branch A's scenario", `/api/v1/scenarios/${scenarioId}`, { method: "POST", body: { document: example.scenario, author: "B", metadata, expectedVersionId: versionId, branch: true } }],
  ["run A's version", "/api/v1/scenarios/runs", { method: "POST", body: { versionId, settings } }],
  ["preflight A's version", "/api/v1/scenarios/preflight", { method: "POST", body: { versionId, settings } }],
  ["explore A's version", "/api/v1/explorer", { method: "POST", body: { versionId, settings: { ks: [1, 2], seeds: [0] } } }],
  ["sweep A's version", "/api/v1/experiments", { method: "POST", body: { versionId, axes: { k: [1, 2] } } }],
  ["geocode A's version", "/api/v1/geocode/jobs", { method: "POST", body: { versionId, author: "B", metadata } }],
  ["read A's run", `/api/v1/runs/${runId}`],
  ["export A's run", `/api/v1/runs/${runId}/export?format=json`],
  ["cancel A's run", `/api/v1/runs/${runId}/cancel`, { method: "POST" }],
  ["delete A's scenario", `/api/v1/scenarios/${scenarioId}`, { method: "DELETE" }],
]) {
  const r = await call(path, B, opts);
  check(`B cannot ${label} (404)`, r.status === 404, String(r.status));
}
check("anonymous cannot read A's run (404)", (await call(`/api/v1/runs/${runId}`, anon)).status === 404);
check("B's scenario list omits A's scenario", !(await call("/api/v1/scenarios", B)).body?.scenarios?.some(s => s.id === scenarioId));
check("B's run list omits A's run", !(await call("/api/v1/runs", B)).body?.runs?.some(r => r.id === runId));
check("B's run page is not found", (await fetch(`${base}/runs/${runId}`, { headers: B, redirect: "manual" })).status === 404);

let detail;
for (let i = 0; i < 300; i++) {
  detail = (await call(`/api/v1/runs/${runId}`, A)).body;
  if (["succeeded", "failed", "cancelled", "interrupted"].includes(detail?.status)) break;
  await sleep(2000);
}
check("A's run succeeds with a valid result", detail?.status === "succeeded" && detail?.summary?.validity === "valid", `${detail?.status} ${detail?.summary?.validity}`);
const exportJson = await call(`/api/v1/runs/${runId}/export?format=json`, A);
check("A exports the run (JSON)", exportJson.status === 200 && exportJson.body?.summary);
const loads = await call(`/api/v1/runs/${runId}/export?format=csv&table=loads`, A);
check("A exports loads (CSV)", loads.status === 200 && loads.text.trim().split("\n").length > 1);
check("A's run page opens", (await fetch(`${base}/runs/${runId}`, { headers: A, redirect: "manual" })).status === 200);
const mine = await call("/api/v1/me/export", A);
check("A's data download includes the scenario", mine.status === 200 && JSON.stringify(mine.body?.scenarios ?? []).includes(scenarioId));
check("B's data download excludes it", !JSON.stringify((await call("/api/v1/me/export", B)).body ?? {}).includes(scenarioId));
const usage = (await call("/api/v1/me", A)).body?.usage;
console.log(`  A usage after: ${JSON.stringify(usage?.solves)}`);

const removed = await call(`/api/v1/scenarios/${scenarioId}`, A, { method: "DELETE" });
check("A deletes the scenario", removed.status === 200, `${removed.status} ${removed.text.slice(0, 200)}`);
check("the deleted scenario is gone (404)", (await call(`/api/v1/scenarios/${scenarioId}`, A)).status === 404);
check("its run is gone (404)", (await call(`/api/v1/runs/${runId}`, A)).status === 404);
check("lessons stay public", (await fetch(`${base}/learn/fulfillment-pipeline`)).status === 200);

if (process.argv.includes("--sign-out-b")) {
  const out = await fetch(`${base}/api/auth/sign-out`, { method: "POST", headers: { ...B, "content-type": "application/json" }, body: "{}" });
  check("B signs out", out.status === 200, String(out.status));
  check("B's old cookie is refused", (await call("/api/v1/scenarios", B)).status === 401);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
