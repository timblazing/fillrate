#!/usr/bin/env node
// Phone and desktop review of the hosted /request-access and /admin pages (spec §14, M8) with agent-browser.
// Run after `bun run build`: node scripts/review-access-pages.mjs [--shots <dir>]
//
// Starts the production standalone server in hosted mode on loopback with a temporary database and
// test-only secrets, seeds synthetic Better Auth users and sessions directly (no OAuth, no live GitHub
// accounts), and serves it over HTTPS on a made-up host through a local TLS proxy with a throwaway
// self-signed certificate, so the browser's Origin and __Secure- session cookie match the configured
// canonical URL exactly as in production. Then, at iPhone 16 (393×852) and desktop (1440×900), a pending
// user submits and updates a long note, and the admin approves, denies, revokes and restores requests.
// Every screen must have no page-level horizontal overflow, its action buttons inside the viewport, and
// no console or page errors. Exits non-zero on any failure.

import { spawn, spawnSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const Database = createRequire(join(root, "packages/db/package.json"))("better-sqlite3");
const standalone = join(root, "apps/web/.next/standalone/apps/web");
const agentBrowser = join(root, "node_modules/.bin/agent-browser");
const shotsArg = process.argv.indexOf("--shots");
const shots = shotsArg > 0 ? resolve(process.argv[shotsArg + 1]) : null;
const HOST = "fillrate-review.test";
const ADMIN_GITHUB_ID = "119372400";

const freePort = () => new Promise((ok, fail) => {
  const server = createServer().once("error", fail);
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => ok(port)); });
});
const expect = (value, message) => { if (!value) throw new Error(message); };
const work = mkdtempSync(join(tmpdir(), "fillrate-access-review-"));
const cleanups = [];

// Throwaway TLS certificate for the made-up host; the browser is told to ignore its issuer.
const cert = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", `/CN=${HOST}`,
  "-addext", `subjectAltName=DNS:${HOST}`, "-keyout", join(work, "key.pem"), "-out", join(work, "cert.pem")], { encoding: "utf8" });
expect(cert.status === 0, `openssl failed: ${cert.stderr}`);

// The standalone server serves static assets only when they are copied next to it (as the image does).
cpSync(join(root, "apps/web/.next/static"), join(standalone, ".next/static"), { recursive: true });
cpSync(join(root, "apps/web/public"), join(standalone, "public"), { recursive: true });

const [webPort, internalPort, tlsPort] = await Promise.all([freePort(), freePort(), freePort()]);
const origin = `https://${HOST}:${tlsPort}`;
const secret = randomBytes(32).toString("base64");
const dataDir = join(work, "data");
mkdirSync(dataDir);
const web = spawn(process.execPath, [join(standalone, "server.js")], {
  cwd: standalone, stdio: ["ignore", "pipe", "pipe"],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1", DATA_DIR: dataDir,
    PORT: String(webPort), HOSTNAME: "127.0.0.1", INTERNAL_PORT: String(internalPort), WORKER_TOKEN: randomBytes(32).toString("hex"),
    FILLRATE_MODE: "hosted", BETTER_AUTH_SECRET: secret, BETTER_AUTH_URL: origin, GITHUB_CLIENT_ID: "review-client",
    GITHUB_CLIENT_SECRET: "review-secret", ADMIN_GITHUB_ID, SIGNUP_MODE: "request" },
});
const webLog = [];
web.stdout.on("data", d => webLog.push(String(d)));
web.stderr.on("data", d => webLog.push(String(d)));
cleanups.push(() => web.kill("SIGTERM"));

// TLS proxy: https://HOST:tlsPort -> http://127.0.0.1:webPort (headers, including Origin, pass through unchanged).
// It runs in its own process: agent-browser calls below block this process's event loop.
const proxySource = `
import { readFileSync } from "node:fs"; import { request } from "node:http"; import { createServer } from "node:https";
createServer({ key: readFileSync(${JSON.stringify(join(work, "key.pem"))}), cert: readFileSync(${JSON.stringify(join(work, "cert.pem"))}) }, (req, res) => {
  const up = request({ host: "127.0.0.1", port: ${webPort}, method: req.method, path: req.url, headers: { ...req.headers, "x-forwarded-proto": "https" } },
    r => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
  up.on("error", () => { res.writeHead(502); res.end(); }); req.pipe(up);
}).listen(${tlsPort}, "127.0.0.1", () => console.log("ready"));`;
writeFileSync(join(work, "proxy.mjs"), proxySource);
const proxy = spawn(process.execPath, [join(work, "proxy.mjs")], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((ok, fail) => { proxy.stdout.once("data", ok); proxy.once("exit", fail); });
cleanups.push(() => proxy.kill("SIGTERM"));

const deadline = Date.now() + 60_000;
for (;;) {
  try { if ((await fetch(`http://127.0.0.1:${webPort}/api/health`)).ok) break; } catch {}
  if (Date.now() > deadline || web.exitCode !== null) throw new Error(`server did not start:\n${webLog.join("")}`);
  await new Promise(r => setTimeout(r, 250));
}

// Synthetic users, the way scripts/test-hosted.mjs creates sessions (Better Auth's signed session cookie).
const db = new Database(join(dataDir, "fillrate.sqlite"));
const now = Date.now();
const LONG_NOTE = "Planning weekly pallet deliveries for a regional building-supply distributor across Tennessee, Mississippi and Arkansas; comparing truck counts with our current manual routes before peak season.";
function user(name, githubId, status, note = null, ageDays = 0) {
  const userId = randomUUID(), token = randomBytes(24).toString("hex"), at = now - ageDays * 86_400_000;
  db.prepare("INSERT INTO user (id,name,email,email_verified,image,created_at,updated_at) VALUES (?,?,?,1,NULL,?,?)")
    .run(userId, name, `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@example-logistics-company.com`, at, at);
  db.prepare("INSERT INTO account (id,account_id,provider_id,user_id,created_at,updated_at) VALUES (?,?,'github',?,?,?)").run(randomUUID(), githubId, userId, at, at);
  db.prepare("INSERT INTO session (id,expires_at,token,created_at,updated_at,user_id) VALUES (?,?,?,?,?,?)").run(randomUUID(), now + 86_400_000, token, now, now, userId);
  if (status) db.prepare("INSERT OR REPLACE INTO access_requests (user_id,status,note,requested_at,decided_at,decided_by,updated_at) VALUES (?,?,?,?,?,?,?)")
    .run(userId, status, note, at, status === "pending" ? null : at, status === "pending" ? null : "seed", at);
  return { userId, name, cookie: `${token}.${createHmac("sha256", secret).update(token).digest("base64")}` };
}
const admin = user("Review Admin", ADMIN_GITHUB_ID, "approved");
const applicant = user("Maximiliana Featherstonehaugh-Worthington", "5000001", "pending");
const other = user("Bartholomew Oyelaran-Castellanos", "5000002", "pending", LONG_NOTE, 1);
user("Approved Dispatcher With A Long Display Name", "5000003", "approved", "Route planning", 3);
user("Denied Applicant", "5000004", "denied", "averyveryverylongwordwithoutanyspacesthatcouldoverflowanarrowphonecolumnifnotwrapped", 5);
user("Revoked Former Tester", "5000005", "revoked", null, 9);
db.close();

let session = null;
function browser(...args) {
  const result = spawnSync(agentBrowser, ["--session", session, "--ignore-https-errors",
    "--args", `--host-resolver-rules=MAP ${HOST} 127.0.0.1`, ...args], {
    encoding: "utf8", timeout: 35_000, env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, AGENT_BROWSER_NO_WEBMCP: "1" } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`agent-browser ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}
const evalJson = (code) => { const out = browser("eval", `JSON.stringify(${code})`); try { return JSON.parse(JSON.parse(out)); } catch { return JSON.parse(out); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(code, label, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (evalJson(code)) return; await sleep(250); }
  throw new Error(`timed out waiting for ${label}`);
}
function signIn(who, width, height) {
  if (session) spawnSync(agentBrowser, ["--session", session, "close"], { stdio: "ignore" });
  session = `fillrate-access-${process.pid}-${randomBytes(3).toString("hex")}`;
  cleanups.push(((s) => () => spawnSync(agentBrowser, ["--session", s, "close"], { stdio: "ignore" }))(session));
  browser("open", `${origin}/privacy`);
  if (width === 393) { browser("set", "device", "iPhone 16"); browser("set", "viewport", "393", "852", "1"); }
  else browser("set", "viewport", String(width), String(height));
  browser("cookies", "set", "__Secure-better-auth.session_token", who.cookie, "--url", origin, "--secure", "--httpOnly", "--sameSite", "Lax");
  browser("errors", "--clear");
  browser("console", "--clear");
}
let shot = 0;
function check(label, width, { dialog = false } = {}) {
  const dims = evalJson(`({w: document.documentElement.clientWidth, s: document.documentElement.scrollWidth,
    out: [...document.querySelectorAll("main button, main textarea, main a")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > document.documentElement.clientWidth + 1); }).map(e => e.innerText || e.tagName)})`);
  expect(dims.w === width, `${label}: viewport ${dims.w}, expected ${width}`);
  expect(dims.s <= dims.w, `${label}: page overflows horizontally (${dims.s} > ${dims.w})`);
  expect(dims.out.length === 0, `${label}: controls outside the viewport: ${JSON.stringify(dims.out)}`);
  const failed = evalJson(`performance.getEntriesByType("resource").filter(e => e.responseStatus >= 400).map(e => e.name + " " + e.responseStatus)`);
  expect(failed.length === 0, `${label}: failed resources ${JSON.stringify(failed)}`);
  expect(evalJson(`Object.keys(document.querySelector("main button") ?? {}).some(k => k.startsWith("__react"))`), `${label}: page is not hydrated`);
  const errors = JSON.parse(browser("errors", "--json")).data?.errors ?? [];
  expect(errors.length === 0, `${label}: page errors ${JSON.stringify(errors)}`);
  const messages = JSON.parse(browser("console", "--json")).data?.messages ?? [];
  const bad = messages.filter(m => ["error", "exception"].includes(String(m.level ?? m.type).toLowerCase()));
  expect(bad.length === 0, `${label}: console errors ${JSON.stringify(bad)}`);
  if (shots) { mkdirSync(shots, { recursive: true }); browser("screenshot", ...(dialog ? [] : ["--full"]), join(shots, `${String(++shot).padStart(2, "0")}-${width}-${label.replace(/\W+/g, "-")}.png`)); }
  console.log(`  ok ${label} at ${width}px`);
}
// The note is a controlled React textarea: type into it so React sees the input events.
function fillNote(text) {
  browser("find", "label", "What will you use Fillrate for? (optional)", "fill", text);
  if (!evalJson(`document.querySelector("#request-note").value === ${JSON.stringify(text)}`)) {
    browser("eval", `document.querySelector("#request-note").select()`);
    browser("type", "#request-note", text);
  }
  expect(evalJson(`document.querySelector("#request-note").value === ${JSON.stringify(text)} && document.body.innerText.includes("${text.length}/500")`), "note text did not reach the form state");
}
const clickText = (text) => browser("eval", `(() => { const b = [...document.querySelectorAll("button")].find(x => x.innerText.trim() === ${JSON.stringify(text)}); b.scrollIntoView({block: "center"}); b.click(); return true })()`);
const status = (u) => { const d = new Database(join(dataDir, "fillrate.sqlite"), { readonly: true }); try { return d.prepare("SELECT status, note FROM access_requests WHERE user_id=?").get(u.userId); } finally { d.close(); } };

try {
  for (const [width, height] of [[393, 852], [1440, 900]]) {
    console.log(`Viewport ${width}×${height}`);
    // Pending applicant: submit a long note, then update it.
    signIn(applicant, width, height);
    browser("open", `${origin}/request-access`);
    await waitFor(`!!document.querySelector("#request-note")`, "request form");
    browser("wait", "--load", "networkidle"); // hydrated, so typed input reaches React state
    check("request-access empty", width);
    fillNote(LONG_NOTE);
    clickText("Submit request");
    await waitFor(`[...document.querySelectorAll("button")].some(b => b.innerText.trim() === "Update request")`, "submitted note");
    expect(status(applicant).note === LONG_NOTE, "note was not stored");
    check("request-access submitted", width);
    fillNote(`${LONG_NOTE} Updated at ${width}px.`);
    clickText("Update request");
    await waitFor(`true`, "update");
    await sleep(800);
    expect(status(applicant).note.endsWith(`Updated at ${width}px.`), "note update was not stored");
    check("request-access updated", width);

    // Admin: approve the applicant, deny and restore, revoke through the confirmation dialog.
    signIn(admin, width, height);
    browser("open", `${origin}/admin`);
    await waitFor(`document.body.innerText.includes(${JSON.stringify(applicant.name)})`, "admin list");
    browser("wait", "--load", "networkidle");
    check("admin list", width);
    const rowAction = (name, action) => browser("eval", `(() => { const row = [...document.querySelectorAll("main article")].find(e => e.innerText.includes(${JSON.stringify(name)})); const b = [...row.querySelectorAll("button")].find(x => x.innerText.trim() === ${JSON.stringify(action)}); b.scrollIntoView({block: "center"}); b.click(); return true })()`);
    const showTab = (prefix) => browser("eval", `(() => { const t = [...document.querySelectorAll("[role=tab]")].find(x => x.innerText.trim().startsWith(${JSON.stringify(prefix)})); t.scrollIntoView({block: "center"}); t.click(); return true })()`);
    const settled = async (u, want, label) => {
      const end = Date.now() + 10_000;
      while (Date.now() < end && status(u).status !== want) await sleep(200);
      expect(status(u).status === want, `${label} did not apply: ${JSON.stringify(status(u))}`);
      await sleep(400);
    };
    rowAction(other.name, "Approve");
    await settled(other, "approved", "approve");
    rowAction(applicant.name, "Deny");
    await settled(applicant, "denied", "deny");
    showTab("Denied");
    await waitFor(`document.querySelector("main").innerText.includes(${JSON.stringify(applicant.name)})`, "denied tab");
    check("admin denied/revoked tab", width);
    rowAction(applicant.name, "Restore");
    await settled(applicant, "approved", "restore");
    showTab("Approved");
    await waitFor(`document.querySelector("main").innerText.includes(${JSON.stringify(applicant.name)})`, "approved tab");
    check("admin approved tab", width);
    rowAction(applicant.name, "Revoke");
    await waitFor(`[...document.querySelectorAll("button")].some(b => b.innerText.trim() === "Revoke access")`, "revoke dialog");
    await sleep(600); // dialog open animation
    // Both dialog actions must be visible and clickable, not covered by toasts or the page.
    for (const name of ["Keep access", "Revoke access"]) {
      expect(evalJson(`(() => { const b = [...document.querySelectorAll("[role=alertdialog] button, [role=dialog] button")].find(x => x.innerText.trim() === ${JSON.stringify(name)}); if (!b) return false; const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.bottom <= innerHeight && r.top >= 0 && (hit === b || b.contains(hit)); })()`), `${width}px revoke dialog: "${name}" is hidden or covered`);
    }
    check("admin revoke dialog", width, { dialog: true });
    clickText("Revoke access");
    await settled(applicant, "revoked", "revoke");
    showTab("Denied");
    check("admin after revoke", width);
    // Put the applicant back to pending for the next viewport.
    const d = new Database(join(dataDir, "fillrate.sqlite"));
    for (const u of [applicant, other]) d.prepare("UPDATE access_requests SET status='pending', note=NULL, decided_at=NULL, decided_by=NULL WHERE user_id=?").run(u.userId);
    d.close();
  }
  console.log(`access review ok${shots ? `; screenshots in ${shots}` : ""}`);
} catch (error) {
  console.error(`access review FAILED: ${error.message}`);
  if (shots) try { browser("screenshot", join(shots, "failure.png")); } catch {}
  try { console.error(`page: ${evalJson("location.href + ' | ' + document.body.innerText.slice(0, 1500)")}`); } catch {}
  process.exitCode = 1;
} finally {
  for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch {} }
  rmSync(work, { recursive: true, force: true });
}
