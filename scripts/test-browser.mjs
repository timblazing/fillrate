import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appDir = join(root, "apps/web");
const optimizerDir = join(root, "services/optimizer");
const agentBrowser = join(root, "node_modules/.bin/agent-browser");
const selected = process.argv.find((arg) => arg.startsWith("--flow="))?.slice("--flow=".length) ?? "all";
// The import flow expects to save the first protected scenario, so flows that add their own scenarios run after it.
const allFlows = ["lesson", "import", "matrix", "experiment", "lessons", "time-windows", "manual-plan", "cancel", "edit", "labs"];
const flows = selected === "all" ? allFlows : [selected];
if (flows.some((flow) => !allFlows.includes(flow))) throw new Error(`Use ${allFlows.map((flow) => `--flow=${flow}`).join(", ")}, or --flow=all.`);

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
  const browserArgs = process.env.AGENT_BROWSER_ARGS ? ["--args", process.env.AGENT_BROWSER_ARGS] : [];
  const result = spawnSync(agentBrowser, ["--session", session, "--download-path", downloadDir, ...browserArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 35_000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      TMPDIR: process.env.TMPDIR,
      AGENT_BROWSER_NO_WEBMCP: "1",
    },
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
// Centers the named button first so a sticky app header cannot cover its click point.
function clickButtonCentered(name) {
  browser("eval", `[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === ${JSON.stringify(name)})?.scrollIntoView({ block: "center" })`);
  clickButton(name);
}
function clickMenuItem(name) { browser("find", "role", "menuitem", "click", "--name", name, "--exact"); }
function fillCss(css, value) { browser("fill", css, value); }
function fillLabel(label, value) { browser("find", "label", label, "fill", value); }
function setViewport(width, height) { browser("set", "viewport", String(width), String(height)); }
// Optional visual review: SMOKE_SHOTS=<dir> saves a full-page screenshot at every viewport check.
let shotCount = 0;
function assertViewport(width, height) {
  if (width === 393) {
    browser("set", "device", "iPhone 16");
    browser("set", "viewport", String(width), String(height), "1");
  } else setViewport(width, height);
  const output = browser("eval", "JSON.stringify({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,height:document.documentElement.clientHeight})");
  let dims;
  try { dims = JSON.parse(JSON.parse(output)); } catch { try { dims = JSON.parse(output); } catch { throw new Error(`Could not read browser viewport dimensions: ${output}`); } }
  if (process.env.SMOKE_SHOTS) { mkdirSync(process.env.SMOKE_SHOTS, { recursive: true }); browser("screenshot", "--full", join(process.env.SMOKE_SHOTS, `${String(++shotCount).padStart(2, "0")}-${width}.png`)); }
  expect(dims.width === width && dims.height === height && dims.scroll <= dims.width, `Page has horizontal overflow or incorrect viewport at ${width}x${height}: ${JSON.stringify(dims)}`);
}

// browser() blocks this process's event loop (spawnSync), so the server can close an idle keep-alive socket unnoticed and
// the next request fails with "other side closed". Yield first so pending socket closes are processed, then retry once on
// that socket error (every request here is a read or carries an Idempotency-Key).
async function localFetch(url, init = {}) {
  await new Promise((resolveTick) => setImmediate(resolveTick));
  try { return await fetch(url, init); } catch (error) {
    if (error?.cause?.code !== "UND_ERR_SOCKET") throw error;
    return fetch(url, init);
  }
}
async function fetchJson(baseURL, path, key, header = "x-scenario-key") {
  const response = await localFetch(new URL(path, baseURL), { headers: key ? { [header]: key } : {}, signal: AbortSignal.timeout(8_000) });
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
  expect(detail.summary.travel?.mode === "estimated" && detail.summary.trucks.every((t) => t.visits.every((v) => typeof v.leg_s === "number" && v.leg_s > 0)), "Lesson run should carry estimated travel with a duration on every leg.");
  await checkTimeline(detail, "public lesson", { timing: "Estimated drive time (constant speed)" });
  checkBrowserDiagnostics("public lesson");
  console.log(`  passed: run ${runId.slice(0, 8)}, revenue ${exported.summary.totals.planned_cents} cents, ${exported.summary.totals.trucks} shipments, JSON export`);
}

function checkRun(detail, label) {
  expect(detail?.status === "succeeded", `${label} run failed: ${detail?.error ?? detail?.status}`);
  expect(detail?.summary?.validity === "valid" && detail?.summary?.coverage === "complete", `${label} run was not valid and complete: ${JSON.stringify(detail?.summary)}`);
  expect(detail?.summary?.totals?.planned_cents > 0 && detail?.summary?.totals?.trucks > 0, `${label} run has no meaningful revenue or shipments.`);
}

const pageText = () => browser("eval", "document.body.innerText");
const parsedText = () => { const raw = pageText(); try { return JSON.parse(raw); } catch { return raw; } };
const evalValue = (js) => { const raw = browser("eval", js); try { return JSON.parse(raw); } catch { return raw; } };

// Replays one succeeded run's Timeline tab (spec §13, M7). The browser must already be on /runs/<id>.
// Asserts the selector, stop controls, arrival/load rendering and the explicit model limits, then bounds at both viewports.
async function checkTimeline(detail, label, { timing }) {
  const summary = detail.summary;
  setViewport(1440, 900);
  browser("find", "role", "tab", "click", "--name", "Timeline", "--exact");
  browser("wait", "--fn", "!!document.querySelector('ol[aria-label=\"Planned route timeline\"]')", "--timeout", "20000");
  const rows = () => evalValue("document.querySelectorAll('ol[aria-label=\"Planned route timeline\"] > li button').length");
  const stopCount = summary.trucks[0].visits.length;
  expect(Number(rows()) === stopCount, `${label}: expected ${stopCount} stop rows for ${summary.trucks[0].id}, got ${rows()}.`);
  // Truck selector: a combobox only when the run has more than one shipment, otherwise the shipment id is shown plainly.
  const selectors = Number(evalValue("document.querySelectorAll('[aria-label=\"Shipment\"]').length"));
  if (summary.trucks.length > 1) expect(selectors >= 1, `${label}: Timeline has no shipment selector for ${summary.trucks.length} shipments.`);
  else expect(parsedText().includes(summary.trucks[0].id), `${label}: Timeline does not name its only shipment.`);
  // Fixed explanations of what the timeline is and is not.
  const text = String(parsedText());
  expect(text.includes(timing), `${label}: Timeline duration source should read "${timing}".`);
  expect(text.includes("Schematic straight-line path"), `${label}: Timeline is missing the schematic straight-line label.`);
  expect(text.includes("service time not modeled (0 s)") && text.includes("not modeled (0 s)"), `${label}: Timeline is missing the "not modeled" service text.`);
  expect(/Return to .+: not planned/.test(text), `${label}: Timeline is missing the "not planned" return text.`);
  expect(/\d+:\d\d/.test(text), `${label}: Timeline shows no arrival clock times.`);
  // Stop controls: Next/Previous move the active row; the slider moves by keyboard.
  const active = () => Number(evalValue("[...document.querySelectorAll('ol[aria-label=\"Planned route timeline\"] > li button')].findIndex(b => b.getAttribute('aria-current') === 'step')"));
  expect(active() === -1, `${label}: cursor should start at departure (active row ${active()}).`);
  browser("find", "role", "button", "click", "--name", "Next stop", "--exact");
  expect(active() === 0, `${label}: Next stop should activate the first stop (active row ${active()}).`);
  const afterNext = String(parsedText());
  expect(/At stop 1, .+: service time not modeled \(0 s\), .+ on board after delivery/.test(afterNext), `${label}: stop status did not describe the first arrival.`);
  expect(/\d+:\d\d(?::\d\d)?\s+until\s+\d+:\d\d(?::\d\d)?/.test(afterNext), `${label}: current time until the route total is not shown.`);
  if (stopCount > 1) {
    browser("find", "role", "button", "click", "--name", "Next stop", "--exact");
    expect(active() === 1, `${label}: Next stop did not advance to the second stop.`);
    browser("find", "role", "button", "click", "--name", "Previous stop", "--exact");
    expect(active() === 0, `${label}: Previous stop did not return to the first stop.`);
  }
  browser("focus", 'input[type="range"]');
  browser("press", "Home");
  expect(active() === -1, `${label}: Home on the slider should return to departure (active row ${active()}).`);
  browser("press", "End");
  expect(active() === stopCount - 1, `${label}: End on the slider should reach the last stop (active row ${active()}).`);
  // Row text: arrival clock plus load before -> after.
  const rowText = String(evalValue("document.querySelector('ol[aria-label=\"Planned route timeline\"] button').innerText"));
  expect(/\d+:\d\d/.test(rowText) && /Load/.test(rowText) && /→/.test(rowText) && /Service\s+not modeled \(0 s\)/.test(rowText), `${label}: first stop row lacks arrival time, load before/after or service text: ${rowText}`);
  // Switch shipment when there is more than one: the stop list follows the selection.
  if (summary.trucks.length > 1) {
    browser("find", "role", "combobox", "click", "--name", "Shipment");
    browser("find", "role", "option", "click", "--name", summary.trucks[1].id, "--exact");
    const second = summary.trucks[1].visits.length;
    browser("wait", "--fn", `document.querySelectorAll('ol[aria-label="Planned route timeline"] > li button').length === ${second}`, "--timeout", "10000");
  }
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics(`${label} timeline`);
  setViewport(1440, 900);
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
  const unkeyedExport = await localFetch(baseURL + `/api/v1/runs/${runId}/export?format=json`);
  expect([401, 403, 404].includes(unkeyedExport.status), `Unkeyed imported export should be denied; received ${unkeyedExport.status}.`);
  const refreshed = await fetchJson(baseURL, `/api/v1/runs/${runId}${access}`, scenarioKey);
  checkRun(refreshed.body, "refreshed imported CSV");
  checkBrowserDiagnostics("protected import");
  console.log(`  passed: unkeyed reads denied, saved scenario ${version.body.scenarioId.slice(0, 8)} matches export, revenue ${detail.summary.totals.planned_cents} cents, ${detail.summary.totals.trucks} shipments`);
}

function roundHalfEven(x) {
  const floor = Math.floor(x), diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}
function haversineM(a, b) {
  const rad = (d) => d * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
function clickButtonStartingWith(prefix) { browser("find", "role", "button", "click", "--name", prefix); }
async function postJson(baseURL, path, key, body) {
  const response = await localFetch(new URL(path, baseURL), { method: "POST", headers: { "content-type": "application/json", "x-scenario-key": key, "idempotency-key": randomUUID() }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  return { response, body: await response.json().catch(() => null) };
}

async function matrixFlow(baseURL, scenarioKey) {
  console.log("Browser smoke: imported directed travel matrix");
  beginBrowserFlow("matrix");
  browser("errors", "--clear");
  browser("console", "--clear");
  open(`${baseURL}/scenarios`);
  expect(snapshot().includes("Scenarios"), "Scenario workbench did not load.");
  fillLabel("Operator key", scenarioKey);
  fillLabel("Display name", "Matrix smoke");
  fillLabel("Scenario name", "Directed matrix import");
  fillLabel("Depot label", "Memphis depot");
  // Three stops near the depot (all within ~15 km), so any imported leg of 40+ km is clearly not the estimate.
  const header = "order_id,line_id,order_date,customer_id,location_id,location_label,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece,priority";
  const orders = [header,
    "MX-1,MX-L1,2026-10-01,Cust A,MX-A,Stop A,35.10,-90.00,MX-SKU,10,25.00,1.00,1",
    "MX-2,MX-L2,2026-10-01,Cust B,MX-B,Stop B,35.20,-90.10,MX-SKU,10,25.00,1.00,1",
    "MX-3,MX-L3,2026-10-01,Cust C,MX-C,Stop C,35.25,-89.95,MX-SKU,10,25.00,1.00,1",
  ].join("\n");
  fillCss('textarea[aria-label="orders CSV content"]', orders);
  fillCss('textarea[aria-label="inventory CSV content"]', "product,available_pieces\nMX-SKU,100\n");
  clickButton("Preview import");
  browser("wait", "--text", "ready to save", "--timeout", "20000");
  expect(/3 orders? ready to save/.test(browser("read")), "CSV preview did not report three orders.");
  clickButton("Save import");
  browser("wait", "--text", "Import saved as version 1.", "--timeout", "25000");

  // Read the saved version to build a matrix over exactly its depot + stop nodes (depot first, then stops by ID).
  // Other flows may share this database, so find the scenario by its name.
  const matrixScenario = async () => (await fetchOkJson(baseURL, "/api/v1/scenarios", scenarioKey)).scenarios?.filter((s) => s.name === "Directed matrix import") ?? [];
  const created = await matrixScenario();
  expect(created.length === 1, "Expected exactly one saved matrix scenario.");
  const scenarioId = created[0].id;
  const versionId = created[0].versionId;
  const saved = await fetchOkJson(baseURL, `/api/v1/scenarios/${scenarioId}?version=${encodeURIComponent(versionId)}`, scenarioKey);
  const depot = saved.document.depot;
  const stops = saved.document.locations.map((l) => ({ id: l.id, lat: l.lat, lon: l.lon })).sort((a, b) => (a.id < b.id ? -1 : 1));
  expect(stops.length === 3, `Expected three stop locations, got ${stops.length}.`);
  const nodes = [{ id: depot.id, lat: depot.lat, lon: depot.lon }, ...stops];
  // Strongly asymmetric kilometers; the .xx5 fractions land on exact .5 meters, exercising ties-to-even rounding.
  const km = nodes.map((_, i) => nodes.map((__, j) => i === j ? 0 : i < j ? 40 + 3 * i + 5 * j + 0.4375 : 90 + 3 * i + 5 * j + 0.1875));
  const matrix = {
    schema_version: 1, nodes, provider: "imported", provider_version: "smoke-import/1", dataset_revision: "smoke-2026-10", profile: "truck", options: {},
    distance_units: "kilometers", duration_units: "seconds", distances: km, durations: km.map((row) => row.map((v) => v === 0 ? 0 : Math.round(v * 60))), warnings: [], conversion: "nearest-integer-ties-to-even/v1",
  };
  const durations = matrix.durations;
  const meters = km.map((row) => row.map((v) => roundHalfEven(v * 1000)));
  expect(meters[0][1] !== meters[1][0], "Test matrix must be asymmetric.");

  // Preview, save and select it in the panel.
  browser("find", "text", "Import a directed matrix", "click");
  fillCss('textarea[aria-label="Travel matrix JSON content"]', JSON.stringify(matrix));
  clickButton("Preview matrix");
  browser("wait", "--text", "Valid snapshot", "--timeout", "20000");
  const previewText = browser("read");
  expect(previewText.includes("Valid snapshot · 4 nodes · 12 / 12 directed edges present") && previewText.includes("imported smoke-import/1") && previewText.includes("kilometers / seconds"),
    `Matrix preview is missing provider, units or full coverage:\n${previewText.slice(-1800)}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  clickButton("Save matrix");
  browser("wait", "--text", "Matrix saved and selected for this scenario.", "--timeout", "20000");
  const snapshotId = (await fetchOkJson(baseURL, "/api/v1/travel-snapshots", scenarioKey)).snapshots?.[0]?.id;
  expect(/^[0-9a-f]{64}$/.test(snapshotId ?? ""), "Saved matrix did not list a content-hash identity.");
  browser("wait", "--text", "Directed coverage", "--timeout", "20000");
  const panel = browser("read");
  for (const needle of ["imported · truck", "smoke-import/1", "smoke-2026-10", "12 / 12 edges", "kilometers; seconds", "4 of 4 match exactly", snapshotId])
    expect(panel.includes(needle), `Travel matrix panel is missing "${needle}":\n${panel.slice(-2500)}`);
  expect(browser("eval", 'document.querySelector(\'select[aria-label="Run travel mode"]\').value').includes(snapshotId), "Saved matrix is not the selected run travel mode.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);

  // Run with the selected snapshot; the worker must use its directed legs.
  clickButton("Review and run saved version");
  browser("wait", "--url", "**/runs/**", "--timeout", "25000");
  const runId = browser("get", "url").match(/\/runs\/([0-9a-f-]+)/i)?.[1];
  expect(runId, "Matrix run result URL is unexpected.");
  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}`, scenarioKey), (body) => ["succeeded", "failed"].includes(body?.status), "Matrix-backed run");
  checkRun(detail, "matrix-backed");
  expect(detail.settings?.travel_snapshot_id === snapshotId, "Run settings did not record the selected snapshot.");
  const travel = detail.summary.travel;
  expect(travel?.mode === "snapshot" && travel.provider === "imported" && travel.provider_version === "smoke-import/1" && travel.snapshot_id === snapshotId && travel.node_count === 4,
    `Run summary does not name the imported provider and snapshot hash: ${JSON.stringify(travel)}`);
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  let checked = 0;
  for (const truck of detail.summary.trucks) {
    let previous = depot.id;
    for (const visit of [...truck.visits].sort((a, b) => a.sequence - b.sequence)) {
      const from = index.get(previous), to = index.get(visit.location_id);
      expect(visit.leg_m === meters[from][to], `Leg ${previous} -> ${visit.location_id} is ${visit.leg_m} m, expected directed matrix value ${meters[from][to]} m.`);
      expect(visit.leg_s === durations[from][to], `Leg ${previous} -> ${visit.location_id} lasts ${visit.leg_s} s, expected directed matrix duration ${durations[from][to]} s.`);
      expect(visit.leg_s !== durations[to][from], `Leg ${previous} -> ${visit.location_id} duration equals the reverse direction.`);
      expect(visit.leg_m !== meters[to][from], `Leg ${previous} -> ${visit.location_id} equals the reverse direction.`);
      expect(visit.leg_m !== Math.round(haversineM(nodes[from], nodes[to]) * 1.2), "Leg equals the haversine estimate instead of the matrix.");
      checked += 1; previous = visit.location_id;
    }
  }
  expect(checked >= 3, `Expected every stop leg to be checked; checked ${checked}.`);
  // Exports: schematic GeoJSON without the synthetic return, and the imported matrix with its node binding.
  const exportGet = (query, key = scenarioKey) => localFetch(new URL(`/api/v1/runs/${runId}/export?${query}`, baseURL), { headers: key ? { "x-scenario-key": key } : {}, signal: AbortSignal.timeout(15_000) });
  const geoResponse = await exportGet("format=geojson");
  expect(geoResponse.status === 200 && geoResponse.headers.get("content-type")?.startsWith("application/geo+json") && /filename="fillrate-run-[0-9a-f]{8}\.geojson"/.test(geoResponse.headers.get("content-disposition") ?? ""), "GeoJSON export headers are wrong.");
  const geo = await geoResponse.json();
  const routes = geo.features.filter((f) => f.geometry.type === "LineString");
  expect(geo.type === "FeatureCollection" && routes.length === detail.summary.trucks.length && geo.fillrate?.travel?.snapshot_id === snapshotId, "GeoJSON export is missing routes or the snapshot hash.");
  for (const route of routes) {
    const truck = detail.summary.trucks.find((t) => t.id === route.properties.truck_id);
    expect(route.properties.geometry === "schematic_straight_line" && route.geometry.coordinates.length === truck.visits.length + 1, "GeoJSON route must be the depot plus physical visits, with no return leg.");
    expect(route.geometry.coordinates[0][0] === depot.lon && route.geometry.coordinates[0][1] === depot.lat, "GeoJSON coordinates must be [lon, lat] starting at the depot.");
  }
  expect(geo.features.filter((f) => f.properties?.role === "stop").length === 3, "GeoJSON export should list the three planned stops.");
  const matrixExport = await (await exportGet("format=matrix&as=json")).json();
  expect(matrixExport.snapshot_id === snapshotId && matrixExport.snapshot?.distances?.[0]?.[1] === km[0][1] && matrixExport.snapshot.distances[1][0] === km[1][0] && matrixExport.binding?.every((b) => b.in_snapshot && b.coordinates_match), "Matrix JSON export does not match the imported snapshot.");
  const matrixCsv = (await (await exportGet("format=matrix&as=csv")).text()).trim().split(/\r?\n/);
  expect(matrixCsv[0] === "from_id,to_id,distance_m,duration_s" && matrixCsv.length === 17 && matrixCsv.includes(`${nodes[0].id},${nodes[1].id},${meters[0][1]},${Math.round(km[0][1] * 60)}`) && !matrixCsv.includes(`${nodes[1].id},${nodes[0].id},${meters[0][1]},${Math.round(km[0][1] * 60)}`), "Matrix CSV is not the directed imported matrix.");
  expect((await exportGet("format=geojson", "")).status === 404 && (await exportGet("format=matrix", "")).status === 404, "Keyless exports of a saved run must be refused.");
  const keyless = await localFetch(new URL(`/api/v1/travel-snapshots/${snapshotId}?format=csv`, baseURL), { signal: AbortSignal.timeout(8_000) });
  expect(keyless.status >= 400, "Keyless snapshot download must be refused.");
  const snapshotJson = await (await localFetch(new URL(`/api/v1/travel-snapshots/${snapshotId}?format=json`, baseURL), { headers: { "x-scenario-key": scenarioKey }, signal: AbortSignal.timeout(15_000) })).text();
  expect(createHash("sha256").update(snapshotJson).digest("hex") === snapshotId, "Downloaded snapshot JSON must hash to its identity.");
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  await checkTimeline(detail, "directed matrix", { timing: "Imported matrix durations" });
  // The rendered first-stop drive time is the matrix duration of the depot leg, not an estimate.
  const firstLeg = [...detail.summary.trucks[0].visits].sort((a, b) => a.sequence - b.sequence)[0];
  const firstSeconds = durations[0][index.get(firstLeg.location_id)];
  const rendered = String(evalValue("document.querySelector('ol[aria-label=\"Planned route timeline\"] button dd').innerText"));
  expect(rendered.includes(`${Math.floor(firstSeconds / 60)}`), `Timeline first drive "${rendered}" does not reflect matrix duration ${firstSeconds} s.`);

  // Edit a stop's coordinates in the browser, save a new version and try to run against the same snapshot.
  const runsBefore = (await fetchOkJson(baseURL, "/api/v1/runs", scenarioKey)).runs.length;
  open(`${baseURL}/scenarios`);
  fillLabel("Operator key", scenarioKey);
  fillLabel("Display name", "Matrix smoke");
  clickButton("Load scenarios");
  browser("wait", "--text", "Directed matrix import · v1", "--timeout", "20000");
  clickButtonStartingWith("Directed matrix import");
  browser("wait", "--text", "Run settings", "--timeout", "20000");
  // Saved matrices load shortly after the operator key settles; wait for the option before selecting it.
  browser("wait", "--fn", `[...document.querySelectorAll('select[aria-label="Run travel mode"] option')].some(o => o.value === ${JSON.stringify(snapshotId)})`, "--timeout", "20000");
  browser("select", 'select[aria-label="Run travel mode"]', snapshotId);
  try { browser("wait", "--text", "4 of 4 match exactly", "--timeout", "20000"); }
  catch (error) { throw new Error(`${error.message}\n${browser("read").slice(0, 2500)}`); }
  clickButtonStartingWith("Coordinates");
  fillLabel("Latitude Stop B", String(stops[1].lat + 0.01));
  browser("press", "Enter");
  browser("wait", "--text", "Unsaved changes", "--timeout", "10000");
  browser("wait", "--text", "3 of 4 match exactly", "--timeout", "10000");
  const stale = browser("read");
  expect(stale.includes(`Changed: ${stops[1].id}`) && stale.includes("enqueue will be refused until they match"), `Stale-coordinate warning is missing from the panel:\n${stale.slice(-2500)}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  clickButton("Save version");
  browser("wait", "--text", "Version saved.", "--timeout", "20000");
  clickButton("Review and run saved version");
  browser("wait", "--text", "coordinates changed since the snapshot", "--timeout", "20000");
  expect(browser("get", "url").includes("/scenarios"), "A stale-coordinate run must not leave the workbench.");
  // The same refusal straight from the server, with its error code.
  const [latest] = await matrixScenario();
  expect(latest.versionId !== versionId, "Edited scenario should be a new saved version.");
  const refused = await postJson(baseURL, "/api/v1/scenarios/runs", scenarioKey, { versionId: latest.versionId, settings: { ...detail.settings } });
  expect(refused.response.status === 422 && refused.body?.error?.code === "travel_snapshot_stale", `Stale run should be refused with travel_snapshot_stale; got ${refused.response.status} ${JSON.stringify(refused.body)}`);
  const runsAfter = (await fetchOkJson(baseURL, "/api/v1/runs", scenarioKey)).runs.length;
  expect(runsAfter === runsBefore, `No run should be enqueued for stale coordinates (${runsBefore} -> ${runsAfter}).`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("directed matrix");
  console.log(`  passed: snapshot ${snapshotId.slice(0, 10)}, ${checked} directed legs match the matrix, stale edit refused (travel_snapshot_stale)`);
}

async function timeWindowsFlow(baseURL, scenarioKey) {
  console.log("Browser smoke: time windows and service durations");
  beginBrowserFlow("time-windows");
  browser("errors", "--clear");
  browser("console", "--clear");
  const fixture = JSON.parse(readFileSync(join(root, "examples/m6-time-windows.json"), "utf8"));
  const saved = await postJson(baseURL, "/api/v1/imports/commit", scenarioKey, {
    format: "json",
    scenarioJson: JSON.stringify(fixture.scenario),
    author: "Browser smoke",
    metadata: { timezone: "America/Chicago", planningDate: "2026-10-06", browserId: `time-windows-${process.pid}` },
  });
  expect(saved.response.status === 201 && saved.body?.versionId, `Time-window fixture import failed: ${JSON.stringify(saved.body)}`);
  // Submit from the browser so the operator-key response can set its scoped run cookie.
  open(`${baseURL}/`);
  const request = { versionId: saved.body.versionId, settings: fixture.settings };
  const output = browser("eval", `(async()=>{const r=await fetch("/api/v1/scenarios/runs",{method:"POST",headers:{"content-type":"application/json","x-scenario-key":${JSON.stringify(scenarioKey)},"idempotency-key":${JSON.stringify(randomUUID())}},body:${JSON.stringify(JSON.stringify(request))}});return JSON.stringify({status:r.status,body:await r.json()})})()`);
  let queued;
  try { queued = JSON.parse(JSON.parse(output)); } catch { queued = JSON.parse(output); }
  expect(queued.status === 201 && queued.body?.id, `Time-window fixture run was not queued: ${JSON.stringify(queued)}`);
  const runId = queued.body.id;
  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}?key=${encodeURIComponent(scenarioKey)}`, scenarioKey), (body) => ["succeeded", "failed"].includes(body?.status), "Time-window run");
  checkRun(detail, "time-window");
  expect(detail.summary.time?.timezone === "America/Chicago", "Time-window result lost the scenario timezone.");
  expect(detail.summary.trucks.some((truck) => truck.visits.some((visit) => visit.wait_s > 0)), "Time-window fixture did not produce a waiting stop.");
  expect(detail.summary.trucks.some((truck) => truck.visits.some((visit) => visit.service_s > 0)), "Time-window fixture did not produce service time.");
  browser("open", `${baseURL}/runs/${runId}?key=${encodeURIComponent(scenarioKey)}`);
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  browser("find", "role", "tab", "click", "--name", "Timeline", "--exact");
  browser("wait", "--text", "service durations and windows from the scenario", "--timeout", "15000");
  browser("find", "role", "button", "click", "--name", "Next stop", "--exact");
  const timeline = String(parsedText());
  expect(timeline.includes("Waiting at stop") && timeline.includes("until the window opens"), "Timeline did not show the scheduled wait state.");
  expect(timeline.includes("Wait") && timeline.includes("Service") && timeline.includes("Window"), "Timeline is missing wait, service or window rows.");
  expect(timeline.includes("America/Chicago") && timeline.includes("Return to Memphis DC: not planned"), "Timeline is missing timezone or open-route semantics.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("time windows");
  console.log(`  passed: run ${runId.slice(0, 8)}, ${detail.summary.trucks.length} shipments, wait/service states on Timeline`);
}

const ORDER_HEADER = "order_id,line_id,order_date,customer_id,location_id,location_label,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece,priority";
const ACTIVE_RUN = new Set(["queued", "claimed", "running"]);

// Imports a small CSV scenario through the workbench and returns its listing row (found by name; flows share the database).
async function importInWorkbench(baseURL, scenarioKey, { author, name, orders, inventory }) {
  open(`${baseURL}/scenarios`);
  expect(snapshot().includes("Scenarios"), "Scenario workbench did not load.");
  fillLabel("Operator key", scenarioKey);
  fillLabel("Display name", author);
  fillLabel("Scenario name", name);
  fillLabel("Depot label", "Memphis depot");
  fillCss('textarea[aria-label="orders CSV content"]', [ORDER_HEADER, ...orders].join("\n"));
  fillCss('textarea[aria-label="inventory CSV content"]', inventory);
  clickButton("Preview import");
  browser("wait", "--text", "ready to save", "--timeout", "20000");
  clickButton("Save import");
  browser("wait", "--text", "Import saved as version 1.", "--timeout", "25000");
  const rows = (await fetchOkJson(baseURL, "/api/v1/scenarios", scenarioKey)).scenarios?.filter((s) => s.name === name) ?? [];
  expect(rows.length === 1 && rows[0].revision === 1, `Expected one saved "${name}" scenario at version 1.`);
  return rows[0];
}

// Opens a saved scenario in a fresh workbench: key and author, Load scenarios, then the listing button with this exact label.
function openSavedScenario(baseURL, scenarioKey, author, label) {
  open(`${baseURL}/scenarios`);
  fillLabel("Operator key", scenarioKey);
  fillLabel("Display name", author);
  clickButton("Load scenarios");
  browser("wait", "--text", label, "--timeout", "20000");
  clickButton(label);
  browser("wait", "--text", "Run settings", "--timeout", "20000");
}

// Sets one cluster and a per-cluster solver budget in the workbench, runs the saved version and returns the new run ID.
function runFromWorkbench(timeLimitSeconds) {
  fillLabel("Clusters (blank = auto)", "1");
  fillLabel("Time per cluster (seconds)", String(timeLimitSeconds));
  clickButton("Review and run saved version");
  browser("wait", "--url", "**/runs/**", "--timeout", "25000");
  const runId = browser("get", "url").match(/\/runs\/([0-9a-f-]+)/i)?.[1];
  expect(runId, "Workbench run did not open its run page.");
  return runId;
}

const hasButton = (name) => evalValue(`[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === ${JSON.stringify(name)})`) === true;

// A cancelled run page (after a fresh load) shows the cancelled state and offers no result, export or further cancel.
async function checkCancelledRun(baseURL, scenarioKey, runId, label) {
  open(`${baseURL}/runs/${runId}`);
  browser("wait", "--text", "Nothing from this run is counted as planned.", "--timeout", "15000");
  const text = String(parsedText());
  expect(text.includes("Cancelled") && !text.includes("Validated") && !text.includes("Planned revenue"), `${label}: reloaded page does not show only the cancelled state.`);
  expect(!hasButton("Export") && !hasButton("Cancel") && !text.includes("Shipment sheets"), `${label}: a cancelled run must not offer export, shipment sheets or cancel.`);
  const loads = await localFetch(new URL(`/api/v1/runs/${runId}/export?format=csv&table=loads`, baseURL), { headers: { "x-scenario-key": scenarioKey }, signal: AbortSignal.timeout(8_000) });
  const loadsBody = await loads.json().catch(() => null);
  expect(loads.status === 409 && loadsBody?.error?.code === "no_result", `${label}: result CSV of a cancelled run should be refused with no_result; got ${loads.status}.`);
  const geo = await localFetch(new URL(`/api/v1/runs/${runId}/export?format=geojson`, baseURL), { headers: { "x-scenario-key": scenarioKey }, signal: AbortSignal.timeout(8_000) });
  expect(geo.status === 409, `${label}: GeoJSON export of a cancelled run should be refused; got ${geo.status}.`);
  const audit = await fetchOkJson(baseURL, `/api/v1/runs/${runId}/export?format=json`, scenarioKey);
  expect(audit.run?.status === "cancelled" && audit.summary === null, `${label}: the JSON record of a cancelled run must carry no result.`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
}

// Spec §9/§12: cancelling a queued run ends it at once; cancelling a running one kills the solver child and persists
// `cancelled`. Neither offers a result, and the worker goes on to finish the next run.
async function cancelFlow(baseURL, scenarioKey) {
  console.log("Browser smoke: run cancellation (queued and running)");
  beginBrowserFlow("cancel");
  browser("errors", "--clear");
  browser("console", "--clear");
  const author = "Cancel smoke", name = "Cancellable browser run";
  await importInWorkbench(baseURL, scenarioKey, { author, name, inventory: "product,available_pieces\nCX-SKU,100\n", orders: [
    "CX-1,CX-L1,2026-10-01,Cust A,CX-A,Stop A,35.10,-90.00,CX-SKU,10,25.00,1.00,1",
    "CX-2,CX-L2,2026-10-01,Cust B,CX-B,Stop B,35.20,-90.10,CX-SKU,10,25.00,1.00,1",
    "CX-3,CX-L3,2026-10-01,Cust C,CX-C,Stop C,35.25,-89.95,CX-SKU,10,25.00,1.00,1",
  ] });
  const detailOf = (id) => fetchOkJson(baseURL, `/api/v1/runs/${id}`, scenarioKey);

  // A long run (a 120 s solve budget on one cluster) occupies the single worker.
  const longId = runFromWorkbench(120);
  await poll(() => detailOf(longId), (body) => body?.status === "running" && body.progress?.stage === "solve" || !ACTIVE_RUN.has(body?.status), "Long run reaching the solve stage", 90_000);
  const solving = await detailOf(longId);
  expect(solving.status === "running" && solving.progress?.stage === "solve", `Long run should be solving before it is cancelled: ${solving.status}.`);

  // A second run waits in the queue behind it; cancel it there.
  openSavedScenario(baseURL, scenarioKey, author, `${name} · v1`);
  const queuedId = runFromWorkbench(120);
  expect((await detailOf(queuedId)).status === "queued", "The second run should be queued behind the running one.");
  browser("wait", "--text", "Waiting for a worker…", "--timeout", "15000");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  clickButtonCentered("Cancel");
  browser("wait", "--text", "Nothing from this run is counted as planned.", "--timeout", "15000");
  const queued = await detailOf(queuedId);
  expect(queued.status === "cancelled" && queued.cancel_requested === true && queued.attempts.length === 0 && queued.summary === null, `A queued run should be cancelled at once without an attempt: ${JSON.stringify({ status: queued.status, cancel: queued.cancel_requested, attempts: queued.attempts })}`);
  await checkCancelledRun(baseURL, scenarioKey, queuedId, "cancelled queued run");

  // Cancel the running one from its page; the worker kills the solver at its next heartbeat.
  open(`${baseURL}/runs/${longId}`);
  browser("wait", "--fn", "[...document.querySelectorAll('button')].some((b) => b.innerText.trim() === 'Cancel')", "--timeout", "15000");
  expect((await detailOf(longId)).status === "running", "The long run finished before it could be cancelled.");
  const requested = Date.now();
  clickButtonCentered("Cancel");
  browser("wait", "--text", "Nothing from this run is counted as planned.", "--timeout", "60000");
  const stopped = await poll(() => detailOf(longId), (body) => !ACTIVE_RUN.has(body?.status), "Running-run cancellation", 60_000);
  const waited = Date.now() - requested;
  expect(stopped.status === "cancelled" && stopped.cancel_requested === true && stopped.summary === null, `A running run should end cancelled (not failed or succeeded): ${stopped.status}.`);
  expect(stopped.attempts.length === 1 && waited < 60_000, `Cancellation should stop the attempt well before the 120 s solve budget (took ${waited} ms).`);
  await checkCancelledRun(baseURL, scenarioKey, longId, "cancelled running run");

  // The worker is free again: a short run of the same version completes.
  openSavedScenario(baseURL, scenarioKey, author, `${name} · v1`);
  const nextId = runFromWorkbench(1);
  const next = await poll(() => detailOf(nextId), (body) => ["succeeded", "failed", "cancelled", "interrupted"].includes(body?.status), "Run after cancellations");
  checkRun(next, "post-cancellation");
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  const runs = (await fetchOkJson(baseURL, "/api/v1/runs", scenarioKey)).runs;
  expect(stable([longId, queuedId, nextId].map((id) => runs.find((r) => r.id === id)?.status)) === '["cancelled","cancelled","succeeded"]', "The run list does not persist both cancellations and the later success.");
  checkBrowserDiagnostics("run cancellation");
  console.log(`  passed: queued run cancelled at once, running run cancelled in ${(waited / 1000).toFixed(1)} s, next run ${nextId.slice(0, 8)} succeeded`);
}

const piecesOf = (document, lineId) => document.orders.flatMap((o) => o.lines).find((l) => l.id === lineId)?.ordered_pieces;
const stockOf = (document, product) => document.inventory.find((i) => i.product_id === product)?.available_pieces;
const CONFLICT_ACTIONS = ["Save my edits as a new branch", "Discard my edits and reload"];

// Saves a version as another editor would (a second client starting from `from`), so the browser's next save conflicts.
async function saveAsOtherEditor(baseURL, scenarioKey, scenarioId, from, edit) {
  const document = structuredClone(from.document);
  edit(document);
  const saved = await postJson(baseURL, `/api/v1/scenarios/${scenarioId}`, scenarioKey, { document, author: "Other editor", metadata: { timezone: "America/Chicago", planningDate: "2026-10-06", browserId: `edit-other-${process.pid}` }, source: from.source, expectedVersionId: from.id });
  expect(saved.response.status === 201 && saved.body?.versionId, `Concurrent save failed: ${JSON.stringify(saved.body)}`);
  return saved.body.versionId;
}

function expectConflictChoices(label) {
  browser("wait", "--text", "Another version was saved.", "--timeout", "15000");
  const choices = evalValue("JSON.stringify([...document.querySelectorAll('[role=\"alert\"] button')].map((b) => b.innerText.trim()))");
  const parsed = typeof choices === "string" ? JSON.parse(choices) : choices;
  expect(stable(parsed) === stable(CONFLICT_ACTIONS), `${label}: the conflict should offer exactly ${JSON.stringify(CONFLICT_ACTIONS)}; got ${JSON.stringify(parsed)}.`);
  expect(!hasButton("Save version") && !hasButton("Save branch") && !hasButton("Discard changes"), `${label}: the ordinary save, branch and discard buttons must give way to the two conflict choices.`);
}

// Spec §5: saves are immutable versions; a version conflict offers exactly branch or discard; a branch is a new scenario
// referencing the version the user started editing; existing runs keep their original version and settings.
async function editFlow(baseURL, scenarioKey) {
  console.log("Browser smoke: scenario editing, version conflicts and branches");
  beginBrowserFlow("edit");
  browser("errors", "--clear");
  browser("console", "--clear");
  const author = "Browser editor", name = "Editable browser scenario";
  const created = await importInWorkbench(baseURL, scenarioKey, { author, name, inventory: "product,available_pieces\nED-SKU,100\n", orders: [
    "ED-1,ED-L1,2026-10-01,Cust A,ED-A,Stop A,35.10,-90.00,ED-SKU,10,25.00,1.00,1",
    "ED-2,ED-L2,2026-10-01,Cust B,ED-B,Stop B,35.20,-90.10,ED-SKU,6,25.00,1.00,1",
  ] });
  const scenarioId = created.id, v1 = created.versionId;
  const version = (id, versionId) => fetchOkJson(baseURL, `/api/v1/scenarios/${id}${versionId ? `?version=${encodeURIComponent(versionId)}` : ""}`, scenarioKey);
  const named = async () => (await fetchOkJson(baseURL, "/api/v1/scenarios", scenarioKey)).scenarios.filter((s) => s.name === name);

  // A run of version 1, started in the browser.
  const runId = runFromWorkbench(2);
  const run = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}`, scenarioKey), (body) => ["succeeded", "failed"].includes(body?.status), "Version 1 run");
  checkRun(run, "version 1");

  // Edit a value and save: a new immutable version whose parent is version 1.
  openSavedScenario(baseURL, scenarioKey, author, `${name} · v1`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  fillLabel("Pieces ED-L1", "7");
  browser("press", "Enter");
  browser("wait", "--text", "Unsaved changes", "--timeout", "10000");
  clickButton("Save version");
  browser("wait", "--text", "Version saved.", "--timeout", "20000");
  const v2 = await version(scenarioId);
  expect(v2.revision === 2 && v2.parentVersionId === v1 && v2.author === author && piecesOf(v2.document, "ED-L1") === 7, `Saved edit should be version 2 of version 1 with 7 pieces: ${JSON.stringify({ revision: v2.revision, parent: v2.parentVersionId, pieces: piecesOf(v2.document, "ED-L1") })}`);
  const original = await version(scenarioId, v1);
  expect(original.revision === 1 && piecesOf(original.document, "ED-L1") === 10, "Version 1 must stay unchanged after an edit.");
  expect((await fetchOkJson(baseURL, "/api/v1/runs", scenarioKey)).runs.find((r) => r.id === runId)?.versionId === v1, "The existing run must still reference version 1.");
  const rerun = await fetchOkJson(baseURL, `/api/v1/runs/${runId}`, scenarioKey);
  expect(stable(rerun.settings) === stable(run.settings) && rerun.settings.solver_time_limit_s === 2 && rerun.settings.k === 1, "The existing run's settings snapshot changed.");
  const record = await fetchOkJson(baseURL, `/api/v1/runs/${runId}/export?format=json`, scenarioKey);
  expect(stable(record.scenario) === stable(original.document), "The existing run's export must carry the version 1 document.");

  // Round 1: another editor saves from version 2 while the browser has unsaved edits; branch the browser's edits.
  fillLabel("Pieces ED-L1", "8");
  browser("press", "Enter");
  browser("wait", "--text", "Unsaved changes", "--timeout", "10000");
  const v3 = await saveAsOtherEditor(baseURL, scenarioKey, scenarioId, v2, (doc) => { doc.inventory.find((i) => i.product_id === "ED-SKU").available_pieces = 90 });
  clickButton("Save version");
  expectConflictChoices("branch round");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  clickButton(CONFLICT_ACTIONS[0]);
  browser("wait", "--text", "Branch saved.", "--timeout", "20000");
  const branchRow = (await named()).find((s) => s.id !== scenarioId);
  expect(branchRow && branchRow.branchedFrom === v2.id && branchRow.revision === 1, `Branching should create a new scenario whose parent is version 2: ${JSON.stringify(branchRow)}`);
  const branch = await version(branchRow.id);
  expect(branch.parentVersionId === v2.id && piecesOf(branch.document, "ED-L1") === 8 && stockOf(branch.document, "ED-SKU") === 100, "The branch should hold the browser's edit on top of version 2, without the other editor's change.");
  const afterBranch = await version(scenarioId);
  expect(afterBranch.id === v3 && afterBranch.revision === 3 && stockOf(afterBranch.document, "ED-SKU") === 90 && piecesOf(afterBranch.document, "ED-L1") === 7, "The original scenario should keep the other editor's version 3 untouched.");
  browser("wait", "--text", `parent ${v2.id.slice(0, 8)}`, "--timeout", "10000");
  expect(String(parsedText()).includes("Version 1 · Browser editor · Saved"), "The workbench should show the saved branch.");

  // Round 2: another conflict on the original scenario; discard the browser's edits and reload the latest version.
  openSavedScenario(baseURL, scenarioKey, author, `${name} · v3`);
  fillLabel("Pieces ED-L1", "9");
  browser("press", "Enter");
  browser("wait", "--text", "Unsaved changes", "--timeout", "10000");
  const v4 = await saveAsOtherEditor(baseURL, scenarioKey, scenarioId, afterBranch, (doc) => { doc.orders.flatMap((o) => o.lines).find((l) => l.id === "ED-L2").ordered_pieces = 4 });
  clickButton("Save version");
  expectConflictChoices("discard round");
  clickButton(CONFLICT_ACTIONS[1]);
  browser("wait", "--text", "Version 4 · Other editor · Saved", "--timeout", "20000");
  const reloaded = String(parsedText());
  expect(!reloaded.includes("Unsaved changes") && !reloaded.includes("Another version was saved."), "Discard should leave no unsaved edits or conflict.");
  const cell = (label) => evalValue(`document.querySelector('input[aria-label=${JSON.stringify(label)}]')?.value ?? ''`);
  expect(String(cell("Pieces ED-L1")) === "7" && String(cell("Pieces ED-L2")) === "4", `Reload should show version 4 (7 and 4 pieces); shows ${cell("Pieces ED-L1")} and ${cell("Pieces ED-L2")}.`);
  const latest = await version(scenarioId);
  expect(latest.id === v4 && latest.revision === 4 && piecesOf(latest.document, "ED-L1") === 7, "Discarding must not save anything.");
  expect((await named()).length === 2, "Discarding must not create another branch.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("scenario editing");
  console.log(`  passed: v1 -> v2 edit, run kept v1, conflict offered branch/discard, branch ${branchRow.id.slice(0, 8)} of v2, discard reloaded v4`);
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
  await explorerReplayStep(baseURL, runKey);
}

// A small k explorer job on the same example, then its Python replay bundle from /explore/<id> (spec §13, M7).
async function explorerReplayStep(baseURL, runKey) {
  const access = `?key=${encodeURIComponent(runKey)}`;
  const created = await fetch(new URL("/api/v1/explorer", baseURL), { method: "POST", headers: { "content-type": "application/json", "x-run-key": runKey, "idempotency-key": randomUUID() }, body: JSON.stringify({ example: "allocation", settings: { ks: [2, 3], seeds: [0, 1], selected_k: 3, h3_resolutions: [] } }), signal: AbortSignal.timeout(8_000) });
  const job = await created.json().catch(() => null);
  expect(created.status === 201 && job?.id, `Explorer job was not created: HTTP ${created.status} ${JSON.stringify(job)}`);
  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${job.id}${access}`, runKey, "x-run-key"), (body) => body && !["queued", "claimed", "running"].includes(body.status), "Explorer job");
  expect(detail.status === "succeeded" && detail.explorer?.per_k?.length === 2, `Explorer job did not succeed with two k rows: ${JSON.stringify(detail.failure ?? detail.status)}`);
  open(`${baseURL}/explore/${job.id}${access}`);
  browser("wait", "--text", "Python replay bundle", "--timeout", "20000");
  const href = evalValue("document.querySelector('a[download][href*=\"format=python\"]')?.getAttribute('href') ?? ''");
  expect(href === `/api/v1/runs/${job.id}/export?format=python`, `Explorer replay link is unexpected: ${href}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  const file = join(downloadDir, `fillrate-run-${job.id.slice(0, 8)}-replay.zip`);
  expect(!existsSync(file), "Explorer replay bundle should be a new download.");
  browser("find", "role", "link", "click", "--name", "Python replay bundle");
  await poll(() => existsSync(file) && readFileSync(file).length > 0, Boolean, "Explorer replay bundle download", 15_000);
  const zip = readFileSync(file);
  const names = zip.toString("latin1");
  expect(zip.subarray(0, 2).toString() === "PK" && ["replay.py", "expected.json", "settings.json", "optimizer/uv.lock", "optimizer/src/fillrate_optimizer/explorer_replay.py"].every((name) => names.includes(name)), "Explorer replay bundle lacks its replay files.");
  checkBrowserDiagnostics("explorer replay");
  console.log(`  passed: explorer ${job.id.slice(0, 8)} (k 2, 3 × seeds 0, 1), replay bundle ${zip.length} bytes`);
}

function clickLink(name) { browser("find", "role", "link", "click", "--name", name, "--exact"); }
const pageNumber = (text, pattern, label) => {
  const match = text.match(pattern);
  expect(match, `Lesson page does not show ${label}.`);
  return Number(match[1].replaceAll(",", ""));
};
const milesOf = (summary) => Math.round(summary.totals.loaded_distance_m / 1609.344);
const partitionOf = (summary) => JSON.stringify(summary.clusters.map((c) => [...c.location_ids].sort()).sort((a, b) => (a.join() < b.join() ? -1 : 1)));

// The M7 lessons (capacity, seeds, time windows): each page's actions start real runs, and the observations it prints are checked
// against the persisted results (the stable facts services/optimizer/tests/test_lesson_*.py also assert).
async function lessonsFlow(baseURL, runKey) {
  console.log("Browser smoke: truck capacity, seed sensitivity and time windows lessons");
  beginBrowserFlow("lessons");
  browser("errors", "--clear");
  browser("console", "--clear");
  const access = `?key=${encodeURIComponent(runKey)}`;
  const runDetail = (id) => fetchOkJson(baseURL, `/api/v1/runs/${id}${access}`, runKey, "x-run-key");
  const doneRun = (id, label) => poll(() => runDetail(id), (body) => ["succeeded", "failed"].includes(body?.status), label);
  const doneSweep = (id, count, label) => poll(() => fetchOkJson(baseURL, `/api/v1/experiments/${id}${access}`, runKey, "x-run-key"),
    (body) => body?.runs?.length === count && body.runs.every((r) => !["queued", "claimed", "running"].includes(r.status)), label);
  const hrefIdOf = (prefix) => evalValue(`document.querySelector('a[href^="${prefix}/"]')?.getAttribute('href') ?? ''`).split("/").pop().split("?")[0];

  // Truck capacity
  open(`${baseURL}/learn/truck-capacity${access}`);
  expect(snapshot().includes('heading "Truck capacity"'), "Truck capacity lesson did not load.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  let page = String(parsedText());
  const bound = pageNumber(page, /so at least (\d+) trucks are needed/, "its capacity lower bound");
  expect(/more than two trailers by itself/.test(page), "Capacity lesson does not name the oversize stop.");
  clickButton("Run the pipeline");
  browser("wait", "--text", "Open run", "--timeout", "20000");
  const capacityRunId = hrefIdOf("/runs");
  expect(/^[0-9a-f-]{36}$/.test(capacityRunId), `Capacity run link is unexpected: ${capacityRunId}`);
  const capacityRun = await doneRun(capacityRunId, "Capacity lesson run");
  checkRun(capacityRun, "capacity lesson");
  const totals = capacityRun.summary.totals;
  expect(bound === totals.capacity_lower_bound && totals.trucks === bound, `Capacity lesson shows a lower bound of ${bound}; run used ${totals.trucks} trucks against ${totals.capacity_lower_bound}.`);
  expect(capacityRun.summary.trucks.every((t) => t.load <= 5300) && capacityRun.summary.unplanned.length === 0, "Capacity run has an overloaded truck or unplanned lines.");
  const byLocation = new Map();
  for (const truck of capacityRun.summary.trucks) for (const visit of truck.visits) byLocation.set(visit.location_id, [...(byLocation.get(visit.location_id) ?? []), truck.id]);
  const split = [...byLocation].filter(([, trucks]) => new Set(trucks).size > 1);
  expect(split.length === 1 && new Set(split[0][1]).size === 3, `Exactly one stop should be split across three shipments: ${JSON.stringify(split)}`);
  clickLink("Open run");
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  await checkTimeline(capacityRun, "capacity lesson run", { timing: "Estimated drive time (constant speed)" });
  open(`${baseURL}/learn/truck-capacity${access}`);
  browser("wait", "--text", "Compare how much freight there is", "--timeout", "20000");
  clickButton("Start 4 runs");
  browser("wait", "--text", "Open sweep", "--timeout", "20000");
  const capacitySweepId = hrefIdOf("/experiments");
  const capacitySweep = await doneSweep(capacitySweepId, 4, "Capacity inventory sweep");
  const byPercent = [...capacitySweep.runs].sort((a, b) => b.varied.inventory_percent - a.varied.inventory_percent);
  expect(stable(byPercent.map((r) => r.varied.inventory_percent)) === "[100,70,50,25]", `Unexpected sweep inventory percents: ${JSON.stringify(byPercent.map((r) => r.varied))}`);
  expect(byPercent.every((r) => r.status === "succeeded" && r.validity === "valid"), "Every inventory sweep run must be valid.");
  expect(stable(byPercent.map((r) => r.metrics.trucks)) === "[13,9,7,4]", `Inventory sweep should need 13, 9, 7 and 4 trucks; got ${byPercent.map((r) => r.metrics.trucks)}.`);
  expect(byPercent.every((r) => r.metrics.trucks === r.capacity_lower_bound), "Each inventory run should use exactly its capacity lower bound.");
  expect(new Set(byPercent.map((r) => r.signature)).size === 4, "Changed inventory assumptions should form separate cohorts.");
  page = String(parsedText());
  expect(page.includes("13, 9, 7 and 4"), "Capacity lesson no longer documents the 13, 9, 7 and 4 shipment counts.");
  clickLink("Open sweep");
  browser("wait", "--url", "**/experiments/**", "--timeout", "20000");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  open(`${baseURL}/learn/truck-capacity${access}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("truck capacity lesson");

  // Seed sensitivity
  open(`${baseURL}/learn/seed-sensitivity${access}`);
  expect(snapshot().includes('heading "Seeds and solver budgets"'), "Seed lesson did not load.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  page = String(parsedText());
  const seedBound = pageNumber(page, /at least (\d+) trucks, whatever the seed/, "its capacity lower bound");
  const lessonLow = pageNumber(page, /from about ([\d,]+) \(seed \d\)/, "its lowest loaded miles");
  const lessonHigh = pageNumber(page, /to about ([\d,]+) \(seed \d\)/, "its highest loaded miles");
  clickButton("Run the pipeline");
  browser("wait", "--text", "Open run", "--timeout", "20000");
  const seedRun = await doneRun(hrefIdOf("/runs"), "Seed lesson run");
  checkRun(seedRun, "seed lesson");
  expect(seedRun.summary.totals.capacity_lower_bound === seedBound && seedRun.summary.totals.trucks >= seedBound, `Seed run has ${seedRun.summary.totals.trucks} trucks against a displayed lower bound of ${seedBound}.`);
  expect(stable(seedRun.summary.clusters.map((c) => c.location_ids.length).sort((a, b) => a - b)) === "[8,11,13,13,15]", "Seed 0 should cut the stops into clusters of 8, 11, 13, 13 and 15.");
  clickButton("Start 6 runs");
  browser("wait", "--text", "Open sweep", "--timeout", "20000");
  const seedSweep = await doneSweep(hrefIdOf("/experiments"), 6, "Seed sweep");
  expect(seedSweep.runs.every((r) => r.status === "succeeded" && r.validity === "valid" && r.coverage === "complete"), "Every seed run must be valid and complete.");
  expect(new Set(seedSweep.runs.map((r) => r.signature)).size === 1 && seedSweep.runs.every((r) => r.eligible), "Seed runs are a method choice and must share one ranked cohort.");
  const seedRuns = await Promise.all(seedSweep.runs.map(async (r) => ({ seed: r.varied.kmeans_seed, ...(await runDetail(r.id)).summary, rank: r.rank })));
  expect(stable(seedRuns.map((r) => r.seed).sort((a, b) => a - b)) === "[0,1,2,3,4,5]", "Sweep should cover seeds 0 to 5.");
  expect(new Set(seedRuns.map(partitionOf)).size === 6, "Six seeds should give six distinct partitions.");
  const miles = seedRuns.map(milesOf);
  expect(Math.min(...miles) === lessonLow && Math.max(...miles) === lessonHigh, `Loaded miles range ${Math.min(...miles)} to ${Math.max(...miles)} differs from the lesson's ${lessonLow} to ${lessonHigh}.`);
  expect(seedRuns.every((r) => r.totals.trucks >= seedBound), "No seed may use fewer trucks than the lower bound.");
  const fewest = seedRuns.filter((r) => r.totals.trucks === Math.min(...seedRuns.map((x) => x.totals.trucks))).sort((a, b) => milesOf(a) - milesOf(b))[0];
  expect(fewest.seed === 4 && seedRuns.filter((r) => r.totals.trucks === 20).map((r) => r.seed).join() === "1", "Seed 4 should load the fewest miles at the fewest shipments and seed 1 alone needs 20.");
  expect(seedRuns.some((r) => r.rank === 1), "The sweep should name a Best option.");
  clickLink("Open sweep");
  browser("wait", "--url", "**/experiments/**", "--timeout", "20000");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  open(`${baseURL}/learn/seed-sensitivity${access}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("seed sensitivity lesson");

  // Time windows and waiting
  open(`${baseURL}/learn/time-windows${access}`);
  expect(snapshot().includes('heading "Time windows and waiting"'), "Time windows lesson did not load.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  page = String(parsedText());
  expect(page.includes("America/Chicago") && page.includes("13:00–15:00") && page.includes("any time"), "Time windows lesson does not list the timezone and customer windows.");
  clickButton("Run the pipeline");
  browser("wait", "--text", "Open run", "--timeout", "20000");
  const windowsRunId = hrefIdOf("/runs");
  const windowsRun = await doneRun(windowsRunId, "Time windows lesson run");
  checkRun(windowsRun, "time windows lesson");
  const windowVisits = windowsRun.summary.trucks.flatMap((t) => t.visits);
  expect(windowsRun.summary.totals.trucks === 2 && windowsRun.summary.totals.capacity_lower_bound === 1 && milesOf(windowsRun.summary) === 225, `Windows run should use 2 trucks against a lower bound of 1 and about 225 loaded miles: ${windowsRun.summary.totals.trucks} trucks, ${milesOf(windowsRun.summary)} mi.`);
  expect(windowVisits.every((v) => v.window_earliest_s == null || (v.start_s >= v.window_earliest_s && v.start_s <= v.window_latest_s)), "A windows-run service start is outside its window.");
  const bakery = windowVisits.find((v) => v.location_id === "TW-01");
  expect(bakery && Math.floor(bakery.wait_s / 60) === 137, `The bakery supply should wait 2 h 17 min; waited ${bakery?.wait_s} s.`);
  clickButton("Run without windows");
  browser("wait", "--text", "Open run without windows", "--timeout", "20000");
  const openRunId = evalValue(`[...document.querySelectorAll('a[href^="/runs/"]')].map((a) => a.getAttribute('href')).find((h) => !h.includes(${JSON.stringify(windowsRunId)})) ?? ''`).split("/").pop().split("?")[0];
  expect(/^[0-9a-f-]{36}$/.test(openRunId), `Run-without-windows link is unexpected: ${openRunId}`);
  const openRun = await doneRun(openRunId, "Time windows lesson run without windows");
  checkRun(openRun, "time windows lesson without windows");
  expect(openRun.summary.totals.trucks === 1 && milesOf(openRun.summary) === 177 && openRun.summary.trucks[0].wait_s_total === 0, `Run without windows should use 1 truck, about 177 loaded miles and no waiting: ${openRun.summary.totals.trucks} trucks, ${milesOf(openRun.summary)} mi.`);
  open(`${baseURL}/runs/${windowsRunId}${access}`);
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  browser("find", "role", "tab", "click", "--name", "Timeline", "--exact");
  browser("wait", "--text", "service durations and windows from the scenario", "--timeout", "15000");
  const windowsTimeline = String(parsedText());
  expect(windowsTimeline.includes("Wait") && windowsTimeline.includes("Service") && windowsTimeline.includes("Window") && windowsTimeline.includes("America/Chicago"), "Windows-run Timeline is missing wait, service, window or timezone content.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  open(`${baseURL}/learn/time-windows${access}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("time windows lesson");
  console.log(`  passed: capacity ${bound} trucks at the bound, split stop on 3 shipments, inventory sweep 13/9/7/4; seeds give 6 partitions, ${Math.min(...miles)}-${Math.max(...miles)} loaded miles; windows 2 trucks/225 mi vs 1 truck/177 mi without`);
}

// Manual plan evaluator (spec §10) and the manual versus optimized routes lesson: the lesson's dispatcher plans are
// evaluated through the page, then the run's Manual plan tab is edited from the keyboard and evaluated. Every
// number is checked against the persisted run and services/optimizer/tests/test_lesson_manual.py.
async function manualPlanFlow(baseURL, runKey) {
  console.log("Browser smoke: manual plan evaluator and manual routes lesson");
  beginBrowserFlow("manual-plan");
  browser("errors", "--clear");
  browser("console", "--clear");
  const access = `?key=${encodeURIComponent(runKey)}`;
  open(`${baseURL}/learn/manual-routes${access}`);
  expect(snapshot().includes('heading "Manual versus optimized routes"'), "Manual routes lesson did not load.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  clickButton("Run the pipeline");
  browser("wait", "--text", "Open run", "--timeout", "20000");
  const runId = evalValue(`document.querySelector('a[href^="/runs/"]')?.getAttribute('href') ?? ''`).split("/").pop().split("?")[0];
  expect(/^[0-9a-f-]{36}$/.test(runId), `Manual lesson run link is unexpected: ${runId}`);
  const run = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}${access}`, runKey, "x-run-key"), (body) => ["succeeded", "failed"].includes(body?.status), "Manual lesson run");
  checkRun(run, "manual lesson");
  expect(run.summary.totals.trucks === 3 && run.summary.totals.capacity_lower_bound === 3 && milesOf(run.summary) === 273, `Manual lesson run should use 3 trucks at the bound and about 273 mi: ${run.summary.totals.trucks}, ${milesOf(run.summary)} mi.`);

  clickButton("Evaluate the order-sequence plan");
  browser("wait", "--text", "Manual plan valid", "--timeout", "20000");
  let page = String(parsedText());
  expect(page.includes("714 mi") && page.includes("273 mi") && page.includes("Manual baseline, not a solver result"), "Order-sequence evaluation does not show 714 vs 273 loaded miles.");
  clickButton("Evaluate the east–west plan");
  browser("wait", "--text", "Over trailer capacity", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes("truck 2 load 6400 > capacity 5300") && page.includes("Manual plan invalid · 1 violation"), "East–west evaluation does not name the over-capacity shipment.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  // Access: anyone may read the public example run's plan context; evaluating needs the run key here.
  const context = await fetchJson(baseURL, `/api/v1/runs/${runId}/evaluate?cluster=C1`);
  expect(context.response.status === 200 && context.body.visits.length === 10 && context.body.reference_routes.length === 3, "Plan context for a public example run is wrong.");
  const keyless = await localFetch(new URL(`/api/v1/runs/${runId}/evaluate`, baseURL), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cluster_id: "C1", routes: context.body.reference_routes }) });
  expect(keyless.status === 403, `Keyless evaluation should be refused, got ${keyless.status}.`);

  // The run page's Manual plan tab, from the keyboard.
  open(`${baseURL}/runs/${runId}${access}`);
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  browser("find", "role", "tab", "click", "--name", "Manual plan", "--exact");
  browser("wait", "--text", "Start from this run", "--timeout", "15000");
  browser("wait", "[data-action=\"move\"]", "--timeout", "15000");
  browser("focus", "button:not([disabled])[aria-label^=\"Move \"][aria-label$=\" later\"]");
  const moved = evalValue("document.activeElement?.dataset.visit ?? ''");
  browser("press", "Enter");
  expect(evalValue("document.activeElement?.dataset.visit ?? ''") === moved, "Focus did not stay on the moved stop after a keyboard reorder.");
  browser("find", "role", "button", "click", "--name", "Reset", "--exact");
  // Builder yard (4 pallets) onto the other 10-pallet shipment overloads it: 5,600 > 5,300.
  const trucks = run.summary.trucks;
  const from = trucks.findIndex((t) => t.visits.some((v) => v.location_id === "MR-04"));
  const to = trucks.findIndex((t, i) => i !== from && t.load === 4000);
  expect(from >= 0 && to >= 0, "Lesson run has no 10-pallet shipment to overload.");
  browser("focus", "button[aria-label=\"Move Builder yard to another shipment\"]");
  browser("press", "Enter");
  browser("find", "role", "menuitem", "click", "--name", `To Shipment ${to + 1}`, "--exact");
  browser("focus", "button:not([disabled])[aria-label^=\"Move \"]");
  browser("find", "role", "button", "click", "--name", "Evaluate", "--exact");
  browser("wait", "--text", "Over trailer capacity", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes(`truck ${to + 1} load 5600 > capacity 5300`) && page.includes("Optimized (this run)"), `Manual plan tab does not show the over-capacity violation on shipment ${to + 1}.`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  browser("find", "role", "button", "click", "--name", "Reset", "--exact");
  expect(!String(parsedText()).includes("Over trailer capacity"), "Reset did not clear the evaluation.");
  browser("find", "role", "button", "click", "--name", "Evaluate", "--exact");
  browser("wait", "--text", "Manual plan valid", "--timeout", "20000");
  checkBrowserDiagnostics("manual plan");
  console.log(`  passed: run ${runId.slice(0, 8)} 3 trucks/273 mi; order-sequence plan valid at 714 mi; east-west plan over capacity; keyboard edit overloads shipment ${to + 1}`);
}

// Solver Lab (M6): a bundled planar example runs from /labs with the run key and its persisted, validated result is
// what the page renders and exports; then an operator edits the instance JSON in the page and runs it as their own.
async function labsFlow(baseURL, runKey, scenarioKey) {
  console.log("Browser smoke: Solver Lab");
  beginBrowserFlow("labs");
  browser("errors", "--clear");
  browser("console", "--clear");
  const keyed = `key=${encodeURIComponent(runKey)}`;
  open(`${baseURL}/labs?example=dimensions&${keyed}`);
  const landing = snapshot();
  expect(landing.includes('heading "Solver Lab"') && /(link|tab) "Labs"/.test(landing), `Solver Lab page or its header link did not load: ${landing.slice(0, 1500)}`);
  expect(browser("read").includes("Read-only: bundled examples run unchanged"), "A keyless visitor should see the example JSON as read-only.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  clickButton("Run example");
  browser("wait", "--url", "**/labs/**", "--timeout", "20000");
  const runId = browser("get", "url").match(/\/labs\/([0-9a-f-]{36})/i)?.[1];
  expect(runId, "Starting the lab example did not open its run page.");
  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/lab/runs/${runId}?${keyed}`, runKey, "x-run-key"), (body) => ["succeeded", "failed", "cancelled"].includes(body?.status), "Lab example run");
  expect(detail.status === "succeeded" && detail.kind === "lab" && detail.example === "dimensions", `Lab example run did not succeed: ${JSON.stringify(detail).slice(0, 800)}`);
  const result = detail.result;
  // The observations services/optimizer/tests/test_lab_examples.py asserts: weight sets the truck count.
  expect(result.validated_feasible && result.solver_feasible && result.violations.length === 0, "Lab example result is not validated feasible.");
  expect(result.totals.routes === 3 && result.routes.every((r) => r.load.weight <= 1200) && Math.max(...result.routes.map((r) => r.utilization.volume)) < 0.6, `Unexpected lab example routes: ${JSON.stringify(result.totals)}`);
  expect(result.proof === "heuristic" && result.objective.total === result.solver.nominal_cost, "Lab objective must be the recomputed nominal cost, labeled heuristic.");
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  const text = browser("read");
  expect(text.includes("PyVRP: feasible") && text.includes("not proven optimal"), "Lab page does not separate solver and validated feasibility or claims optimality.");
  expect(text.includes(result.problem_fingerprint) && text.includes(result.objective.total.toLocaleString("en-US")), "Lab page does not show the persisted fingerprint and objective.");
  expect(text.includes("not latitude/longitude, so no map") && !text.includes("OpenStreetMap"), "Planar lab plot must be labeled abstract and drawn without a map.");
  expect(Number(evalValue("document.querySelectorAll('svg polyline[data-route]').length")) === 3, "Lab plot should draw one path per route.");
  expect(Number(evalValue("document.querySelectorAll('[data-testid=\"lab-routes\"] tbody tr').length")) === 3, "Route table should list three routes.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);
  const file = join(downloadDir, `fillrate-lab-${runId.slice(0, 8)}.json`);
  clickLink("JSON");
  await poll(() => existsSync(file), Boolean, "Lab JSON export", 10_000);
  const exported = JSON.parse(readFileSync(file, "utf8"));
  expect(exported.run.id === runId && stable(exported.result) === stable(result) && exported.instance.name === detail.instance.name, "Lab JSON export does not match the persisted run.");
  const script = await (await localFetch(new URL(`/api/v1/lab/runs/${runId}/export?format=python&${keyed}`, baseURL), { headers: { "x-run-key": runKey }, signal: AbortSignal.timeout(8_000) })).text();
  expect(script.includes("fillrate_optimizer.lab.replay") && script.includes(result.problem_fingerprint), "Lab Python export is missing its replay call or fingerprint.");

  // Operator: edit the JSON (heavier trucks) and run it as an own instance; weight no longer binds, so 2 trucks.
  browser("eval", `document.cookie = "fillrate_operator=${encodeURIComponent(scenarioKey)}; path=/; SameSite=Lax"`);
  open(`${baseURL}/labs?example=dimensions`);
  const edited = { ...detail.instance, name: "Browser smoke: heavier trucks", vehicle_types: detail.instance.vehicle_types.map((v) => ({ ...v, capacity: { ...v.capacity, weight: 3000 } })) };
  fillCss("#lab-json", JSON.stringify(edited, null, 2));
  browser("wait", "--text", "Edited", "--timeout", "10000");
  clickButton("Run my instance");
  browser("wait", "--url", "**/labs/**", "--timeout", "20000");
  const ownId = browser("get", "url").match(/\/labs\/([0-9a-f-]{36})/i)?.[1];
  expect(ownId && ownId !== runId, "Running the edited instance did not open a new run.");
  const own = await poll(() => fetchOkJson(baseURL, `/api/v1/lab/runs/${ownId}`, scenarioKey), (body) => ["succeeded", "failed", "cancelled"].includes(body?.status), "Edited lab run");
  expect(own.status === "succeeded" && own.example === null && own.instance.name === edited.name, `Edited lab run did not succeed as an own instance: ${JSON.stringify(own).slice(0, 800)}`);
  expect(own.result.validated_feasible && own.result.totals.routes === 2 && own.result.problem_fingerprint !== result.problem_fingerprint, `Edited instance should need 2 trucks: ${JSON.stringify(own.result?.totals)}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  const denied = await fetchJson(baseURL, `/api/v1/lab/runs/${ownId}`);
  expect(denied.response.status === 404, `A keyless read of the operator's lab run should be 404; received ${denied.response.status}.`);
  const scenarios = await fetchOkJson(baseURL, "/api/v1/scenarios", scenarioKey);
  expect(!scenarios.scenarios.some((sc) => sc.name.includes("heavier trucks")), "A lab instance must not appear as a scenario.");
  assertViewport(393, 852);
  assertViewport(1440, 900);
  checkBrowserDiagnostics("Solver Lab");
  console.log(`  passed: example run ${runId.slice(0, 8)} (3 routes, objective ${result.objective.total}), edited run ${ownId.slice(0, 8)} (2 routes), JSON and Python exports`);
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
  const [webPort, internalPort, optimizerPort] = await Promise.all([freePort(), freePort(), freePort()]);
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
    OPTIMIZER_URL: `http://127.0.0.1:${optimizerPort}`,
    RUN_KEY: runKey,
    SCENARIO_KEY: scenarioKey,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  const web = launch(process.execPath, [join(standaloneAppDir, "server.js")], { cwd: standaloneAppDir, env: { ...commonEnv, PORT: String(webPort), HOSTNAME: "127.0.0.1" } });
  const baseURL = `http://127.0.0.1:${webPort}`;
  await waitForWeb(`${baseURL}/learn/fulfillment-pipeline?key=${encodeURIComponent(runKey)}`, web);
  // The optimizer as the container runs it: FastAPI on loopback (manual plan evaluation) with the worker supervisor.
  launch("uv", ["run", "--locked", "fillrate-optimizer"], {
    cwd: optimizerDir,
    env: { ...commonEnv, UV_PYTHON: "3.13", FILLRATE_WORKER: "1", OPTIMIZER_PORT: String(optimizerPort), FILLRATE_INTERNAL_URL: `http://127.0.0.1:${internalPort}`, WORKER_ID: `browser-smoke-${process.pid}`, WORKER_POLL_SECONDS: "0.2" },
  });
  for (const flow of flows) {
    if (flow === "lesson") await lessonFlow(baseURL, runKey);
    if (flow === "import") await importFlow(baseURL, scenarioKey);
    if (flow === "matrix") await matrixFlow(baseURL, scenarioKey);
    if (flow === "experiment") await experimentFlow(baseURL, runKey);
    if (flow === "lessons") await lessonsFlow(baseURL, runKey);
    if (flow === "time-windows") await timeWindowsFlow(baseURL, scenarioKey);
    if (flow === "manual-plan") await manualPlanFlow(baseURL, runKey);
    if (flow === "cancel") await cancelFlow(baseURL, scenarioKey);
    if (flow === "edit") await editFlow(baseURL, scenarioKey);
    if (flow === "labs") await labsFlow(baseURL, runKey, scenarioKey);
  }
  await stop();
} catch (error) {
  console.error(redact(error instanceof Error ? error.stack : error));
  await stop();
  process.exitCode = 1;
}
