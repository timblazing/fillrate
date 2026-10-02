// Hosted/local mode acceptance against the production build (spec §14, M4). Run `bun run build` first, then
// `bun run test:hosted`. No worker is started: jobs stay queued, which is what the admission checks need.
//
// 1. FILLRATE_MODE=hosted without auth settings refuses to start.
// 2. FILLRATE_MODE=local serves scenarios and runs with no keys and no account routes.
// 3. FILLRATE_MODE=hosted with settings: two accounts (sessions written to the database and signed with the
//    server secret, exactly as Better Auth would after GitHub sign-in) cannot see or touch each other's data by
//    guessed IDs; anonymous callers get sign-in errors; quotas answer 429 with Retry-After; cross-origin writes,
//    sign-out and account deletion behave. GitHub OAuth itself needs real credentials and is an owner check.
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const Database = createRequire(join(root, "packages/db/package.json"))("better-sqlite3");
const appDir = join(root, "apps/web");
const standalone = join(appDir, ".next/standalone/apps/web");
cpSync(join(appDir, ".next/static"), join(standalone, ".next/static"), { recursive: true });
cpSync(join(appDir, "public"), join(standalone, "public"), { recursive: true });
const example = JSON.parse(readFileSync(join(root, "examples/m1-synthetic.json"), "utf8"));

let failures = 0, passes = 0;
function check(label, condition, detail = "") {
  if (condition) { passes++; console.log(`  ok   ${label}`); }
  else { failures++; console.log(`  FAIL ${label}${detail ? ` (${detail})` : ""}`); }
}
const freePort = () => new Promise((ok, fail) => {
  const server = createServer().once("error", fail);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => ok(port)); });
});

async function start(env) {
  const dataDir = mkdtempSync(join(tmpdir(), "fillrate-hosted-"));
  const [port, internal] = await Promise.all([freePort(), freePort()]);
  const output = [];
  const child = spawn(process.execPath, [join(standalone, "server.js")], {
    cwd: standalone, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATA_DIR: dataDir, PORT: String(port), HOSTNAME: "127.0.0.1", INTERNAL_PORT: String(internal), WORKER_TOKEN: randomBytes(32).toString("hex"), ...env },
  });
  child.stdout.on("data", d => output.push(String(d)));
  child.stderr.on("data", d => output.push(String(d)));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try { if ((await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) })).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  const stop = async () => {
    if (child.exitCode === null) { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); }
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { child, base, dataDir, output, stop };
}

const json = async response => ({ status: response.status, headers: response.headers, body: await response.json().catch(() => null) });
const call = (base, path, { method = "GET", body, headers = {} } = {}) =>
  fetch(`${base}${path}`, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" }).then(json);
const metadata = { timezone: "America/Chicago", planningDate: "2026-10-01", browserId: "hosted-check" };
const importBody = name => ({ format: "json", name, depot: example.scenario.depot, scenarioJson: JSON.stringify({ ...example.scenario, name }), author: "Checker", metadata });

try {
  console.log("1. hosted mode with missing auth settings");
  {
    const server = await start({ FILLRATE_MODE: "hosted", BETTER_AUTH_URL: "https://fillrate.example.com" });
    await new Promise(r => setTimeout(r, 500));
    check("server exits instead of serving", server.child.exitCode !== null, `exit ${server.child.exitCode}`);
    check("exit code 78 (configuration)", server.child.exitCode === 78);
    check("names the missing settings", /BETTER_AUTH_SECRET/.test(server.output.join("")) && /GITHUB_CLIENT_ID/.test(server.output.join("")));
    await server.stop();
  }

  console.log("2. local mode");
  {
    const server = await start({ FILLRATE_MODE: "local" });
    const b = server.base;
    check("starts without any auth settings", server.child.exitCode === null);
    check("lists scenarios without a key", (await call(b, "/api/v1/scenarios")).status === 200);
    const saved = await call(b, "/api/v1/imports/commit", { method: "POST", body: importBody("Local"), headers: { "idempotency-key": randomUUID() } });
    check("imports without a key", saved.status === 201, JSON.stringify(saved.body));
    check("starts a synthetic run without a key", (await call(b, "/api/v1/runs", { method: "POST", body: {}, headers: { "idempotency-key": randomUUID() } })).status === 201);
    check("has no account routes", (await call(b, "/api/auth/get-session")).status === 404);
    check("reports local mode", (await call(b, "/api/v1/me")).body?.mode === "local");
    const db = new Database(join(server.dataDir, "fillrate.sqlite"), { readonly: true });
    check("creates no users or sessions", db.prepare("SELECT (SELECT count(*) FROM user) + (SELECT count(*) FROM session) AS n").get().n === 0);
    db.close();
    await server.stop();
  }

  console.log("3. hosted mode, two accounts");
  {
    const secret = randomBytes(32).toString("base64");
    const origin = "https://fillrate.example.com";
    const server = await start({ FILLRATE_MODE: "hosted", BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin, GITHUB_CLIENT_ID: "check-client", GITHUB_CLIENT_SECRET: "check-secret", ADMIN_GITHUB_ID: "119372400", SIGNUP_MODE: "open", QUOTA_SOLVES_PER_DAY: "3", SCENARIO_KEY: "operator-check" });
    const b = server.base;
    check("starts with complete settings", server.child.exitCode === null, server.output.join("").slice(-300));
    const db = new Database(join(server.dataDir, "fillrate.sqlite"));
    const now = Date.now();
    const session = name => {
      const userId = randomUUID(), token = randomBytes(24).toString("hex");
      db.prepare("INSERT INTO user (id,name,email,email_verified,image,created_at,updated_at) VALUES (?,?,?,1,NULL,?,?)").run(userId, name, `${name.toLowerCase()}@example.com`, now, now);
      db.prepare("INSERT INTO account (id,account_id,provider_id,user_id,created_at,updated_at) VALUES (?,?,'github',?,?,?)").run(randomUUID(), name === "Alice" ? "119372401" : "119372402", userId, now, now);
      db.prepare("INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)").run(randomUUID(), now + 86_400_000, token, now, now, userId);
      const signature = createHmac("sha256", secret).update(token).digest("base64");
      return { userId, token, headers: { cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`, origin } };
    };
    const A = session("Alice"), B = session("Bob");
    const as = (who, extra = {}) => ({ ...extra, headers: { ...who.headers, ...(extra.headers ?? {}) } });

    const me = await call(b, "/api/v1/me", as(A));
    check("session resolves to the account", me.body?.user?.name === "Alice" && me.body?.kind === "user", JSON.stringify(me.body));
    check("anonymous is not signed in", (await call(b, "/api/v1/me")).body?.kind === "anonymous");
    check("anonymous import needs sign-in (401)", (await call(b, "/api/v1/imports/commit", { method: "POST", body: importBody("Anon"), headers: { "idempotency-key": randomUUID() } })).status === 401);
    check("anonymous synthetic run needs sign-in (401)", (await call(b, "/api/v1/runs", { method: "POST", body: {}, headers: { "idempotency-key": randomUUID() } })).status === 401);
    check("cross-origin write refused (403)", (await call(b, "/api/v1/imports/commit", as(A, { method: "POST", body: importBody("X"), headers: { origin: "https://evil.example", "idempotency-key": randomUUID() } }))).status === 403);

    const saved = await call(b, "/api/v1/imports/commit", as(A, { method: "POST", body: importBody("Alice data"), headers: { "idempotency-key": randomUUID() } }));
    check("A imports a scenario", saved.status === 201, JSON.stringify(saved.body));
    const { scenarioId, versionId } = saved.body ?? {};
    const settings = { ...example.settings, k: 1, solver_max_iterations: 50 };
    const run = await call(b, "/api/v1/scenarios/runs", as(A, { method: "POST", body: { versionId, settings }, headers: { "idempotency-key": randomUUID() } }));
    check("A queues a run on it", run.status === 201, JSON.stringify(run.body));
    const runId = run.body?.id;

    check("B's scenario list is empty", (await call(b, "/api/v1/scenarios", as(B))).body?.scenarios?.length === 0);
    check("A's scenario list has it", (await call(b, "/api/v1/scenarios", as(A))).body?.scenarios?.length === 1);
    check("B cannot read A's scenario (404)", (await call(b, `/api/v1/scenarios/${scenarioId}`, as(B))).status === 404);
    check("B cannot save over A's scenario (404)", (await call(b, `/api/v1/scenarios/${scenarioId}`, as(B, { method: "POST", body: { document: example.scenario, author: "Bob", metadata, expectedVersionId: versionId }, headers: { "idempotency-key": randomUUID() } }))).status === 404);
    check("B cannot branch A's scenario (404)", (await call(b, `/api/v1/scenarios/${scenarioId}`, as(B, { method: "POST", body: { document: example.scenario, author: "Bob", metadata, expectedVersionId: versionId, branch: true }, headers: { "idempotency-key": randomUUID() } }))).status === 404);
    check("B cannot run A's version (404)", (await call(b, "/api/v1/scenarios/runs", as(B, { method: "POST", body: { versionId, settings }, headers: { "idempotency-key": randomUUID() } }))).status === 404);
    check("B cannot preflight A's version (404)", (await call(b, "/api/v1/scenarios/preflight", as(B, { method: "POST", body: { versionId, settings } }))).status === 404);
    check("B cannot explore A's version (404)", (await call(b, "/api/v1/explorer", as(B, { method: "POST", body: { versionId, settings: { ks: [1, 2], seeds: [0] } }, headers: { "idempotency-key": randomUUID() } }))).status === 404);
    check("B cannot sweep A's version (404)", (await call(b, "/api/v1/experiments", as(B, { method: "POST", body: { versionId, axes: { k: [1, 2] } }, headers: { "idempotency-key": randomUUID() } }))).status === 404);
    check("B cannot geocode A's version (404)", (await call(b, "/api/v1/geocode/jobs", as(B, { method: "POST", body: { versionId, author: "Bob", metadata }, headers: { "idempotency-key": randomUUID() } }))).status === 404);
    check("B cannot read A's run (404)", (await call(b, `/api/v1/runs/${runId}`, as(B))).status === 404);
    check("anonymous cannot read A's run (404)", (await call(b, `/api/v1/runs/${runId}`)).status === 404);
    check("B cannot export A's run (404)", (await call(b, `/api/v1/runs/${runId}/export?format=json`, as(B))).status === 404);
    check("B cannot cancel A's run (404)", (await call(b, `/api/v1/runs/${runId}/cancel`, as(B, { method: "POST" }))).status === 404);
    check("B's run list omits A's run", !(await call(b, "/api/v1/runs", as(B))).body?.runs?.some(r => r.id === runId));
    check("A's run list has it", (await call(b, "/api/v1/runs", as(A))).body?.runs?.some(r => r.id === runId));
    check("A's run page opens", (await fetch(`${b}/runs/${runId}`, as(A))).status === 200);
    check("B's run page is not found", (await fetch(`${b}/runs/${runId}`, as(B))).status === 404);
    check("operator key does not open A's data", (await call(b, `/api/v1/runs/${runId}`, { headers: { "x-scenario-key": "operator-check" } })).status === 404);

    const second = await call(b, "/api/v1/runs", as(A, { method: "POST", body: {}, headers: { "idempotency-key": randomUUID() } }));
    check("A's second job is refused: one unfinished job (429)", second.status === 429 && second.body?.error?.code === "active_limit" && Number(second.headers.get("retry-after")) > 0, JSON.stringify(second.body));
    check("A cancels own run", (await call(b, `/api/v1/runs/${runId}/cancel`, as(A, { method: "POST" }))).status === 202);
    const sweep = await call(b, "/api/v1/experiments", as(A, { method: "POST", body: { example: "m1", axes: { k: [1, 2, 3] } }, headers: { "idempotency-key": randomUUID() } }));
    check("a 3-run sweep exceeds the remaining daily solves (429)", sweep.status === 429 && sweep.body?.error?.code === "quota_exceeded" && /needs 3 daily solve admissions.*Room frees up at/.test(sweep.body?.error?.message ?? ""), JSON.stringify(sweep.body));
    const usage = (await call(b, "/api/v1/me", as(A))).body?.usage;
    check("usage reports one solve admission and a reset time", usage?.solves?.used === 1 && usage?.solves?.limit === 3 && typeof usage?.solves?.resetsAt === "number", JSON.stringify(usage));

    const dataExport = await fetch(`${b}/api/v1/me/export`, as(A));
    const exported = await dataExport.json().catch(() => null);
    check("A downloads own data", dataExport.status === 200 && exported?.scenarios?.length === 1 && exported?.runs?.length === 1);
    check("B's download has none of A's data", (await (await fetch(`${b}/api/v1/me/export`, as(B))).json()).scenarios.length === 0);
    check("B cannot delete A's scenario (404)", (await call(b, `/api/v1/scenarios/${scenarioId}`, as(B, { method: "DELETE" }))).status === 404);

    const signOut = await fetch(`${b}/api/auth/sign-out`, { method: "POST", headers: { ...B.headers, "content-type": "application/json" }, body: "{}" });
    check("B signs out", signOut.status === 200, String(signOut.status));
    check("B's old cookie is refused after sign-out", (await call(b, "/api/v1/scenarios", as(B))).status === 401);
    db.prepare("UPDATE session SET expires_at=? WHERE user_id=?").run(Date.now() - 1000, A.userId);
    check("an expired session is refused", (await call(b, "/api/v1/scenarios", as(A))).status === 401);
    // Better Auth removes an expired session; sign A in again.
    db.prepare("DELETE FROM session WHERE user_id=?").run(A.userId);
    const token = randomBytes(24).toString("hex");
    db.prepare("INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)").run(randomUUID(), Date.now() + 86_400_000, token, now, now, A.userId);
    A.headers.cookie = `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${createHmac("sha256", secret).update(token).digest("base64")}`)}`;

    const deleted = await call(b, "/api/v1/me", as(A, { method: "DELETE" }));
    check("A deletes the account", deleted.status === 200 && deleted.body?.deleted?.scenarios === 1, JSON.stringify(deleted.body));
    const left = db.prepare("SELECT (SELECT count(*) FROM user WHERE id=?) + (SELECT count(*) FROM session WHERE user_id=?) + (SELECT count(*) FROM access_requests WHERE user_id=?) + (SELECT count(*) FROM scenarios WHERE ownerId=?) + (SELECT count(*) FROM runs WHERE ownerId=?) AS n").get(A.userId, A.userId, A.userId, `user:${A.userId}`, `user:${A.userId}`).n;
    check("nothing of A remains", left === 0);
    check("A's old cookie no longer works", (await call(b, "/api/v1/scenarios", as(A))).status === 401);
    check("lessons stay public", (await fetch(`${b}/learn/fulfillment-pipeline`)).status === 200);
    db.close();
    await server.stop();
  }
  console.log("4. request-only hosted access");
  {
    const secret = randomBytes(32).toString("base64"), origin = "https://fillrate.example.com";
    const server = await start({ FILLRATE_MODE: "hosted", BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin, GITHUB_CLIENT_ID: "check-client", GITHUB_CLIENT_SECRET: "check-secret", ADMIN_GITHUB_ID: "119372400", SCENARIO_KEY: "operator-check" });
    const b = server.base, db = new Database(join(server.dataDir, "fillrate.sqlite")), now = Date.now();
    const session = (name, githubId) => {
      const userId = randomUUID(), token = randomBytes(24).toString("hex");
      db.prepare("INSERT INTO user (id,name,email,email_verified,image,created_at,updated_at) VALUES (?,?,?,1,NULL,?,?)").run(userId, name, `${name.toLowerCase()}@example.com`, now, now);
      db.prepare("INSERT INTO account (id,account_id,provider_id,user_id,created_at,updated_at) VALUES (?,?,'github',?,?,?)").run(randomUUID(), githubId, userId, now, now);
      db.prepare("INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)").run(randomUUID(), now + 86_400_000, token, now, now, userId);
      const signature = createHmac("sha256", secret).update(token).digest("base64");
      return { userId, headers: { cookie: `__Secure-better-auth.session_token=${encodeURIComponent(`${token}.${signature}`)}`, origin } };
    };
    const admin = session("Admin", "119372400"), user = session("Pending", "123"), stranger = session("Stranger", "456");
    const as = (who, extra = {}) => ({ ...extra, headers: { ...who.headers, ...(extra.headers ?? {}) } });
    check("admin is approved by numeric GitHub ID", (await call(b, "/api/v1/me", as(admin))).body?.admin === true);
    const pending = await call(b, "/api/v1/me", as(user));
    check("new account is pending without usage", pending.body?.kind === "pending" && pending.body?.access === "pending" && pending.body?.usage === null && pending.body?.signup_mode === "request");
    check("pending import is 403", (await call(b, "/api/v1/imports/commit", as(user, { method: "POST", body: importBody("Denied") }))).body?.error?.code === "access_pending");
    check("pending cookie cannot borrow operator key", (await call(b, "/api/v1/scenarios", as(user, { headers: { "x-scenario-key": "operator-check" } }))).body?.error?.code === "access_pending");
    check("pending run is 403", (await call(b, "/api/v1/runs", as(user, { method: "POST", body: {}, headers: { "idempotency-key": randomUUID() } }))).body?.error?.code === "access_pending");
    check("pending run list is 403", (await call(b, "/api/v1/runs", as(user))).body?.error?.code === "access_pending");
    check("pending export is 403", (await call(b, "/api/v1/me/export", as(user))).status === 403);
    check("pending page redirects", (await fetch(`${b}/scenarios`, { headers: user.headers, redirect: "manual" })).headers.get("location") === "/request-access");
    check("lessons remain public", (await fetch(`${b}/learn/fulfillment-pipeline`)).status === 200);
    check("pending note saves", (await call(b, "/api/v1/me/access-request", as(user, { method: "PUT", body: { note: "Testing with sample orders" } }))).status === 200);
    check("note is stored", db.prepare("SELECT note FROM access_requests WHERE user_id=?").get(user.userId)?.note === "Testing with sample orders");
    for (let i = 0; i < 9; i++) await call(b, "/api/v1/me/access-request", as(user, { method: "PUT", body: { note: `Update ${i}` } }));
    const overNote = await call(b, "/api/v1/me/access-request", as(user, { method: "PUT", body: { note: "Too many" } }));
    check("eleventh note update is rate limited", overNote.status === 429 && overNote.body?.error?.code === "quota_exceeded", JSON.stringify(overNote.body));
    check("stranger cannot list requests", (await call(b, "/api/v1/admin/access-requests", as(stranger))).status === 404);
    check("pending user cannot open admin page", (await fetch(`${b}/admin`, { headers: user.headers, redirect: "manual" })).status === 404);
    check("stranger cannot forge approval", (await call(b, `/api/v1/admin/access-requests/${user.userId}`, as(stranger, { method: "POST", body: { action: "approve" } }))).status === 404);
    const decision = (target, action, who = admin, headers = {}) => call(b, `/api/v1/admin/access-requests/${target.userId}`, as(who, { method: "POST", body: { action }, headers }));
    check("cross-origin admin POST is refused", (await decision(user, "approve", admin, { origin: "https://evil.example" })).status === 403);
    check("admin cannot change own status", (await decision(admin, "revoke")).status === 409);
    check("admin approves", (await decision(user, "approve")).body?.status === "approved");
    check("same session becomes approved", (await call(b, "/api/v1/me", as(user))).body?.kind === "user");
    const saved = await call(b, "/api/v1/imports/commit", as(user, { method: "POST", body: importBody("Keep data"), headers: { "idempotency-key": randomUUID() } }));
    check("approved user imports", saved.status === 201);
    const run = await call(b, "/api/v1/scenarios/runs", as(user, { method: "POST", body: { versionId: saved.body?.versionId, settings: { ...example.settings, k: 1, solver_max_iterations: 50 } }, headers: { "idempotency-key": randomUUID() } }));
    check("approved user queues a run", run.status === 201);
    check("admin revokes", (await decision(user, "revoke")).body?.status === "revoked");
    check("revocation applies to next request", (await call(b, "/api/v1/scenarios", as(user))).body?.error?.code === "access_revoked");
    check("unfinished run is cancelled", db.prepare("SELECT status FROM runs WHERE id=?").get(run.body?.id)?.status === "cancelled");
    check("data survives revoke", db.prepare("SELECT count(*) AS n FROM scenarios WHERE ownerId=?").get(`user:${user.userId}`).n === 1);
    check("admin restores", (await decision(user, "restore")).body?.status === "approved");
    check("restored session sees its data", (await call(b, "/api/v1/scenarios", as(user))).body?.scenarios?.length === 1);
    check("admin denies pending", (await decision(stranger, "deny")).body?.status === "denied");
    check("denied account cannot re-request immediately", (await call(b, "/api/v1/me/access-request", as(stranger, { method: "PUT", body: { note: "Again" } }))).body?.error?.code === "rerequest_wait");
    db.prepare("UPDATE access_requests SET decided_at=? WHERE user_id=?").run(Date.now() - 8 * 86_400_000, stranger.userId);
    check("denied account can re-request after seven days", (await call(b, "/api/v1/me/access-request", as(stranger, { method: "PUT", body: { note: "Again" } }))).body?.status === "pending");
    check("audit records actions", db.prepare("SELECT count(*) AS n FROM admin_events").get().n === 4);
    db.close(); await server.stop();
  }
} catch (error) {
  failures++;
  console.error(error);
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exitCode = failures ? 1 : 0;
