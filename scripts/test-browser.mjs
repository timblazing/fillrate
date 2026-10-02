import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps/web");
const optimizerDir = join(root, "services/optimizer");
const agentBrowser = join(root, "node_modules/.bin/agent-browser");
const selected = process.argv.find((arg) => arg.startsWith("--flow="))?.slice("--flow=".length) ?? "all";
const flows = selected === "all" ? ["lesson", "import", "experiment"] : [selected];
if (flows.some((flow) => !["lesson", "import", "experiment"].includes(flow))) throw new Error("Use --flow=lesson, --flow=import, --flow=experiment, or --flow=all.");

const dataDir = mkdtempSync(join(tmpdir(), "fillrate-browser-smoke-"));
const downloadDir = join(dataDir, "downloads");
mkdirSync(downloadDir);
const children = new Set();
const sessions = new Set();
let session;
let stopping;
const testSecrets = [];
const redact = (value) => testSecrets.reduce((text, secret) => text.replaceAll(secret, "[test-key]"), String(value));

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a local port."));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

function launch(command, args, options) {
  const child = spawn(command, args, { stdio: "inherit", ...options });
  children.add(child);
  child.once("exit", () => children.delete(child));
  child.once("error", (error) => console.error(`Could not start ${command}: ${error.message}`));
  return child;
}

async function waitForWeb(url, child) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Production web server exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`Production web server did not become ready: ${lastError}`);
}

function browser(...args) {
  const result = spawnSync(agentBrowser, ["--session", session, "--download-path", downloadDir, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 35_000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, AGENT_BROWSER_NO_WEBMCP: "1" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`agent-browser ${args[0]} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function expect(value, message) { if (!value) throw new Error(message); }
function stable(value) { return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }
function snapshot() { return browser("snapshot", "-i"); }
function open(url) { browser("open", url); }
function clickButton(name) { browser("find", "role", "button", "click", "--name", name, "--exact"); }
function clickMenuItem(name) { browser("find", "role", "menuitem", "click", "--name", name, "--exact"); }
function fillCss(css, value) { browser("fill", css, value); }
function fillLabel(label, value) { browser("find", "label", label, "fill", value); }
function setViewport(width, height) { browser("set", "viewport", String(width), String(height)); }
function assertViewport(width, height) {
  if (width === 393) {
    browser("set", "device", "iPhone 16");
    browser("set", "viewport", String(width), String(height), "1");
  } else setViewport(width, height);
  const output = browser("eval", "JSON.stringify({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.clientHeight})");
  let dims;
  try { dims = JSON.parse(JSON.parse(output)); } catch { try { dims = JSON.parse(output); } catch { throw new Error(`Could not read browser viewport dimensions: ${output}`); } }
  expect(dims.width === width && dims.height === height && dims.scroll <= dims.width, `Page has horizontal overflow or incorrect viewport at ${width}x${height}: ${JSON.stringify(dims)}`);
}

async function fetchJson(baseURL, path, key, header = "x-scenario-key") {
  const response = await fetch(new URL(path, baseURL), { headers: key ? { [header]: key } : {}, signal: AbortSignal.timeout(8_000) });
  return { response, body: await response.json().catch(() => null) };
}
async function fetchOkJson(baseURL, path, key, header = "x-scenario-key") {
  const result = await fetchJson(baseURL, path, key, header);
  if (!result.response.ok) throw new Error(`Expected ${path} to be readable; received HTTP ${result.response.status}.`);
  return result.body;
}

function beginBrowserFlow(name) {
  if (session) spawnSync(agentBrowser, ["--session", session, "close"], { stdio: "ignore", timeout: 10_000 });
  session = `fillrate-${process.pid}-${name}-${randomBytes(4).toString("hex")}`;
  sessions.add(session);
}

async function poll(get, done, label, timeout = 150_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await get();
    if (done(last)) return last;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  }
  throw new Error(`${label} did not complete before the ${timeout} ms limit. Last state: ${JSON.stringify(last).slice(0, 1500)}`);
}

async function downloadRunJson(runId) {
  const file = join(downloadDir, `fillrate-run-${runId.slice(0, 8)}.json`);
  expect(!existsSync(file), "Run export should be a new download.");
  clickButton("Export");
  clickMenuItem("Run JSON (inputs, stages, results)");
  await poll(() => existsSync(file), Boolean, "Run JSON export", 10_000);
  const exported = JSON.parse(readFileSync(file, "utf8"));
  expect(exported.run?.id === runId, "Downloaded export belongs to a different run.");
  return exported;
}

function checkBrowserDiagnostics(flow) {
  const readResult = (command) => {
    const raw = browser(command, "--json");
    let result;
    try { result = JSON.parse(raw); } catch { throw new Error(`Could not parse agent-browser ${command} JSON output.`); }
    expect(result.success === true && result.data && !result.error, `agent-browser ${command} did not return successful diagnostics.`);
    return result.data;
  };
  const pageErrors = readResult("errors");
  const errors = pageErrors.errors;
  expect(Array.isArray(errors) && errors.length === 0, `${flow} browser page errors: ${JSON.stringify(errors)}`);
  const consoleResult = readResult("console");
  expect(Array.isArray(consoleResult.messages), "agent-browser console diagnostics did not contain a messages array.");
  const consoleErrors = [];
  const visit = (value) => {
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    if (!value || typeof value !== "object") return;
    const level = String(value.level ?? value.type ?? value.method ?? "").toLowerCase();
    if (level === "error" || level === "exception") consoleErrors.push(value);
    for (const nested of Object.values(value)) visit(nested);
  };
  visit(consoleResult.messages);
  expect(consoleErrors.length === 0, `${flow} browser console errors: ${JSON.stringify(consoleErrors)}`);
}

async function lessonFlow(baseURL, runKey) {
  console.log("Browser smoke: public fulfillment lesson");
  beginBrowserFlow("lesson");
  browser("errors", "--clear");
  browser("console", "--clear");
  open(`${baseURL}/learn/fulfillment-pipeline?key=${encodeURIComponent(runKey)}`);
  expect(snapshot().includes('heading "Fulfillment pipeline"'), "Fulfillment lesson did not load.");
  clickButton("Run the pipeline");
  browser("wait", "--text", "Open run", "--timeout", "20000");
  const page = snapshot();
  const href = page.match(/link "Open run"[^\n]*\n?[^\n]*?(\/runs\/[0-9a-f-]+\?key=[^\s\]"']+)/i)?.[1]
    ?? browser("eval", "document.querySelector('a[href^=\"/runs/\"]')?.getAttribute('href') ?? ''");
  const path = href.replace(/^.*?(\/runs\/)/, "/runs/");
  const runId = path.match(/^\/runs\/([0-9a-f-]+)/i)?.[1];
  expect(runId, `Could not identify the lesson run from the rendered page: ${page.slice(-1500)}`);
  browser("open", new URL(path, baseURL).toString());
  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}`, runKey, "x-run-key"), (body) => body?.status === "succeeded" || body?.status === "failed", "Public lesson run");
  checkRun(detail, "public lesson");
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  const resultText = browser("read");
  expect(resultText.includes("Planned revenue") && resultText.includes("Shipments"), "Lesson result is missing revenue or shipment output.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  const exported = await downloadRunJson(runId);
  expect(exported.run.status === "succeeded" && exported.summary.validity === "valid" && exported.summary.coverage === "complete", "Lesson JSON export did not contain its valid complete run.");
  expect(exported.summary.totals.planned_cents > 0 && exported.summary.totals.trucks > 0, "Lesson JSON export has empty revenue or shipment totals.");
  checkBrowserDiagnostics("public lesson");
  console.log(`  passed: run ${runId.slice(0, 8)}, revenue ${exported.summary.totals.planned_cents} cents, ${exported.summary.totals.trucks} shipments, JSON export`);
}

function checkRun(detail, label) {
  expect(detail?.status === "succeeded", `${label} run failed: ${detail?.error ?? detail?.status}`);
  expect(detail?.summary?.validity === "valid" && detail?.summary?.coverage === "complete", `${label} run was not valid and complete: ${JSON.stringify(detail?.summary)}`);
  expect(detail?.summary?.totals?.planned_cents > 0 && detail?.summary?.totals?.trucks > 0, `${label} run has no meaningful revenue or shipments.`);
}

async function importFlow(baseURL, scenarioKey) {
  console.log("Browser smoke: protected CSV import");
  beginBrowserFlow("import");
  browser("errors", "--clear");
  browser("console", "--clear");
  const denied = await fetchJson(baseURL, "/api/v1/scenarios");
  expect([401, 403].includes(denied.response.status), `Unkeyed scenario listing should be denied; received ${denied.response.status}.`);
  open(`${baseURL}/scenarios`);
  expect(snapshot().includes("Scenarios"), "Scenario workbench did not load.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  fillLabel("Operator key", scenarioKey);
  fillLabel("Display name", "Browser smoke");
  fillLabel("Scenario name", "Bounded browser import");
  fillLabel("Depot label", "Memphis depot");
  const orders = [
    "order_id,line_id,order_date,customer_id,location_id,location_label,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece,priority",
    "SMOKE-1,SMOKE-L1,2026-10-01,Smoke Customer,SMOKE-C1,Smoke Customer,35.16,-90.05,SMOKE-SKU,10,25.00,1.00,1",
  ].join("\n");
  const inventory = "product,available_pieces\nSMOKE-SKU,100\n";
  fillCss('textarea[aria-label="orders CSV content"]', orders);
  fillCss('textarea[aria-label="inventory CSV content"]', inventory);
  clickButton("Preview import");
  browser("wait", "--text", "ready to save", "--timeout", "20000");
  const preview = browser("read");
  expect(/1 orders? ready to save/.test(preview), `CSV preview did not report the expected single order:\n${preview.slice(-1800)}`);
  clickButton("Save import");
  browser("wait", "--text", "Import saved as version 1.", "--timeout", "25000");
  expect(snapshot().includes("Bounded browser import"), "Saved scenario identity is missing from the workbench.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  clickButton("Review checks");
  browser("wait", "--text", "Preflight review updated.", "--timeout", "15000");
  clickButton("Review and run saved version");
  browser("wait", "--url", "**/runs/**", "--timeout", "25000");
  const path = browser("get", "url");
  const runId = path.match(/\/runs\/([0-9a-f-]+)/i)?.[1];
  expect(runId, `Imported run result URL is unexpected: ${path}`);
  const access = `?key=${encodeURIComponent(scenarioKey)}`;
  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}${access}`, scenarioKey), (body) => ["succeeded", "failed"].includes(body?.status), "Imported CSV run");
  checkRun(detail, "imported CSV");
  const list = await fetchJson(baseURL, "/api/v1/scenarios", scenarioKey);
  expect(list.response.ok && list.body?.scenarios?.length === 1, "Authorized scenario list should contain only the imported smoke scenario.");
  expect(list.body.scenarios[0].name === "Bounded browser import", "Persisted scenario identity does not match the imported scenario name.");
  const version = await fetchJson(baseURL, `/api/v1/scenarios/${list.body.scenarios[0].id}?version=${encodeURIComponent(list.body.scenarios[0].versionId)}`, scenarioKey);
  expect(version.response.ok && version.body?.document?.name === "Bounded browser import", "Saved scenario version could not be read back.");
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  browser("open", `${baseURL}/runs/${runId}?key=${encodeURIComponent(scenarioKey)}`);
  browser("wait", "--text", "Validated, complete", "--timeout", "15000");
  const exported = await downloadRunJson(runId);
  expect(stable(exported.scenario) === stable(version.body.document), "Imported result export scenario does not match the saved scenario version.");
  expect(exported.scenario?.name === "Bounded browser import" && exported.scenario?.orders?.[0]?.id === "SMOKE-1" && exported.scenario?.orders?.[0]?.lines?.[0]?.id === "SMOKE-L1", "Imported result export does not preserve the scenario and fixture identity.");
  expect(exported.summary?.validity === "valid" && exported.summary?.coverage === "complete", "Imported result export is not valid and complete.");
  expect(exported.summary.totals.planned_cents === 25_000 && exported.summary.totals.trucks === 1, "Imported fixture should ship all ten pieces worth $250 on one truck.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  const unkeyed = await fetchJson(baseURL, `/api/v1/runs/${runId}`);
  expect([401, 403, 404].includes(unkeyed.response.status), `Unkeyed imported run access should be denied; received ${unkeyed.response.status}.`);
  const unkeyedExport = await fetch(baseURL + `/api/v1/runs/${runId}/export?format=json`);
  expect([401, 403, 404].includes(unkeyedExport.status), `Unkeyed imported export should be denied; received ${unkeyedExport.status}.`);
  const refreshed = await fetchJson(baseURL, `/api/v1/runs/${runId}${access}`, scenarioKey);
  checkRun(refreshed.body, "refreshed imported CSV");
  checkBrowserDiagnostics("protected import");
  console.log(`  passed: unkeyed reads denied, saved scenario ${version.body.scenarioId.slice(0, 8)} matches export, revenue ${detail.summary.totals.planned_cents} cents, ${detail.summary.totals.trucks} shipments`);
}

async function experimentFlow(baseURL, runKey) {
  console.log("Browser smoke: bounded synthetic experiment");
  beginBrowserFlow("experiment");
  browser("errors", "--clear");
  browser("console", "--clear");
  open(`${baseURL}/experiments?example=allocation&key=${encodeURIComponent(runKey)}`);
  expect(snapshot().includes("Sweeps"), "Experiment builder did not load.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  fillLabel("Name", "Bounded allocation comparison");
  fillLabel("k (clusters)", "2, 3");
  fillLabel("k-means seeds", "0");
  clickButton("Preview runs");
  browser("wait", "--text", "2 runs", "--timeout", "15000");
  expect(snapshot().includes("2 runs"), "Experiment preview did not expand to exactly two combinations.");
  clickButton("Start 2 runs");
  browser("wait", "--url", "**/experiments/**", "--timeout", "20000");
  const url = browser("get", "url");
  const id = url.match(/\/experiments\/([0-9a-f-]+)/i)?.[1];
  expect(id, `Started experiment URL is unexpected: ${url}`);
  const access = `?key=${encodeURIComponent(runKey)}`;
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  const experiment = await poll(() => fetchOkJson(baseURL, `/api/v1/experiments/${id}${access}`, runKey, "x-run-key"),
    (body) => body && body.runs?.length === 2 && body.runs.every((run) => !["queued", "claimed", "running"].includes(run.status)), "Two-run experiment");
  expect(experiment.runs.length === 2, `Expected two persisted combinations; got ${experiment.runs?.length}.`);
  expect(experiment.runs.every((run) => run.status === "succeeded" && run.validity === "valid" && run.coverage === "complete"), `Both combinations must succeed with valid complete results: ${JSON.stringify(experiment.runs.map((run) => ({ status: run.status, validity: run.validity, coverage: run.coverage })))}`);
  expect(stable(experiment.runs.map((run) => run.varied?.k).sort((a, b) => a - b)) === "[2,3]", "Experiment combinations did not match the requested k values.");
  expect(experiment.runs.every((run) => run.eligible && run.signature === experiment.runs[0].signature), "Both experiment runs must be eligible in the same comparison cohort.");
  const best = experiment.runs.find((run) => run.label === "Best option" || run.rank === 1);
  expect(best, "Completed experiment does not identify a Best option.");
  expect(best.metrics?.planned_cents > 0 && best.metrics?.trucks > 0, `Best option has empty comparison metrics: ${JSON.stringify(best.metrics)}`);
  browser("wait", "--text", "Best option", "--timeout", "30000");
  const page = snapshot();
  expect(page.includes("Best option") && page.includes("shipments"), "Rendered comparison does not show its Best option and shipment metric.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("experiment comparison");
  console.log(`  passed: 2 combinations, Best option ${best.metrics.planned_cents} cents, ${best.metrics.trucks} shipments`);
}

async function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    for (const browserSession of sessions) {
      try { spawnSync(agentBrowser, ["--session", browserSession, "close"], { stdio: "ignore", timeout: 10_000 }); } catch {}
    }
    for (const child of children) child.kill("SIGTERM");
    await Promise.race([Promise.all([...children].map((child) => new Promise((resolveExit) => child.once("exit", resolveExit)))), new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000))]);
    for (const child of children) child.kill("SIGKILL");
    rmSync(dataDir, { recursive: true, force: true });
  })();
  return stopping;
}

process.once("SIGINT", () => void stop().finally(() => process.exit(130)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(143)));

try {
  expect(existsSync(join(appDir, ".next/standalone/apps/web/server.js")), "Production standalone build is missing; run bun run build first.");
  const [webPort, internalPort] = await Promise.all([freePort(), freePort()]);
  const workerToken = randomBytes(32).toString("hex");
  const runKey = randomUUID();
  const scenarioKey = randomBytes(32).toString("hex");
  testSecrets.push(workerToken, runKey, scenarioKey);
  const standaloneAppDir = join(appDir, ".next/standalone/apps/web");
  cpSync(join(appDir, ".next/static"), join(standaloneAppDir, ".next/static"), { recursive: true });
  cpSync(join(appDir, "public"), join(standaloneAppDir, "public"), { recursive: true });
  // Deliberately allowlist only the local runtime configuration. Hosted credentials, auth settings,
  // ambient data paths, and externally configured worker URLs cannot enter this smoke server.
  const commonEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    NODE_ENV: "production",
    DATA_DIR: dataDir,
    WORKER_TOKEN: workerToken,
    INTERNAL_PORT: String(internalPort),
    RUN_KEY: runKey,
    SCENARIO_KEY: scenarioKey,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const web = launch(process.execPath, [join(standaloneAppDir, "server.js")], { cwd: standaloneAppDir, env: { ...commonEnv, PORT: String(webPort), HOSTNAME: "127.0.0.1" } });
  const baseURL = `http://127.0.0.1:${webPort}`;
  await waitForWeb(`${baseURL}/learn/fulfillment-pipeline?key=${encodeURIComponent(runKey)}`, web);
  const worker = launch("uv", ["run", "--locked", "fillrate-worker"], {
    cwd: optimizerDir,
    env: { ...commonEnv, UV_PYTHON: "3.13", FILLRATE_INTERNAL_URL: `http://127.0.0.1:${internalPort}`, WORKER_ID: `browser-smoke-${process.pid}`, WORKER_POLL_SECONDS: "0.2" },
  });
  for (const flow of flows) {
    if (flow === "lesson") await lessonFlow(baseURL, runKey);
    if (flow === "import") await importFlow(baseURL, scenarioKey);
    if (flow === "experiment") await experimentFlow(baseURL, runKey);
  }
  await stop();
} catch (error) {
  console.error(redact(error instanceof Error ? error.stack : error));
  await stop();
  process.exitCode = 1;
}
