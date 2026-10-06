import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const allFlows = ["lesson", "import", "matrix", "experiment", "lessons", "time-windows", "manual-plan", "cancel", "edit", "labs", "warm-start", "road-matrices", "lab-lessons", "lab-depots", "lab-reloads", "lab-prizes", "lab-groups", "lab-pairs", "baselines", "fleet", "road-geometry"];
const flows = selected === "all" ? allFlows : [selected];
if (flows.some((flow) => !allFlows.includes(flow))) throw new Error(`Use ${allFlows.map((flow) => `--flow=${flow}`).join(", ")}, or --flow=all.`);

const dataDir = mkdtempSync(join(tmpdir(), "fillrate-browser-smoke-"));
const downloadDir = join(dataDir, "downloads");
mkdirSync(downloadDir);
const children = new Set();
const sessions = new Set();
let session;
let stopping;
let smokeBaseURL;
let smokeOperatorKey;
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
    timeout: Number(process.env.AGENT_BROWSER_TIMEOUT_MS ?? 35_000),
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
function clickTab(name) { browser("find", "role", "tab", "click", "--name", name, "--exact"); }
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
  browser("open", smokeBaseURL);
  browser("eval", `document.cookie = "fillrate_operator=${encodeURIComponent(smokeOperatorKey)}; path=/; SameSite=Lax"`);
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
  console.log("Browser smoke: fulfillment lesson");
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
  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}`, runKey, "x-run-key"), (body) => body?.status === "succeeded" || body?.status === "failed", "Lesson run");
  checkRun(detail, "lesson");
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  const resultText = browser("read");
  expect(resultText.includes("Planned revenue") && resultText.includes("Shipments"), "Lesson result is missing revenue or shipment output.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  const exported = await downloadRunJson(runId);
  expect(exported.run.status === "succeeded" && exported.summary.validity === "valid" && exported.summary.coverage === "complete", "Lesson JSON export did not contain its valid complete run.");
  expect(exported.summary.totals.planned_cents > 0 && exported.summary.totals.trucks > 0, "Lesson JSON export has empty revenue or shipment totals.");
  expect(detail.summary.travel?.mode === "estimated" && detail.summary.trucks.every((t) => t.visits.every((v) => typeof v.leg_s === "number" && v.leg_s > 0)), "Lesson run should carry estimated travel with a duration on every leg.");
  await checkTimeline(detail, "lesson", { timing: "Estimated drive time (constant speed)" });
  await profileShipmentResults(baseURL, runKey, runId, detail.summary.totals.trucks);
  checkBrowserDiagnostics("lesson");
  console.log(`  passed: run ${runId.slice(0, 8)}, revenue ${exported.summary.totals.planned_cents} cents, ${exported.summary.totals.trucks} shipments, JSON export`);
}

// Records the large persisted-results tab transition at both frontend-spec viewports.
// The observer is intentionally armed after route load so this measures steady tab interactions.
async function profileShipmentResults(baseURL, runKey, runId, shipmentCount) {
  expect(shipmentCount === 443, `Performance workload expected 443 shipments, got ${shipmentCount}.`);
  open(`${baseURL}/runs/${runId}?key=${encodeURIComponent(runKey)}`);
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  // Capture the tab click in-page so command-line startup latency is excluded.
  const record = async (viewport, trial) => {
    browser("eval", `window.__shipmentClickMs=null; window.__shipmentLongTasks.length=0`);
    clickTab("Shipments (443)");
    browser("wait", "--fn", "window.__shipmentClickMs !== null", "--timeout", "15000");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const data = evalValue(`JSON.stringify({ms:window.__shipmentClickMs,inputDelay:window.__shipmentEventTiming[0]?.delay??0,response:Math.round((window.__shipmentClickMs+(window.__shipmentEventTiming[0]?.delay??0))*10)/10,rows:Math.max(...[...document.querySelectorAll('tbody')].map((body)=>body.rows.length)),nodes:document.getElementsByTagName('*').length,longTasks:window.__shipmentLongTasks.map((task)=>({...task,offset:Math.round((task.start-window.__shipmentClickStart)*10)/10}))})`);
    const values = typeof data === "string" ? JSON.parse(data) : data;
    console.log(`  profile ${viewport} trial ${trial}: ${JSON.stringify(values)}`);
    if (process.env.RESULT_PROFILE_SHOTS && trial === 1) {
      mkdirSync(process.env.RESULT_PROFILE_SHOTS, { recursive: true });
      browser("screenshot", "--full", join(process.env.RESULT_PROFILE_SHOTS, `run-2k-shipments-${viewport}.png`));
      browser("screenshot", join(process.env.RESULT_PROFILE_SHOTS, `run-2k-shipments-viewport-${viewport}.png`));
    }
    clickTab("Map");
    browser("wait", "--fn", `document.querySelector('[role="tab"][aria-selected="true"]')?.innerText.trim()==="Map"`, "--timeout", "15000");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
    return values;
  };
  browser("eval", `window.__shipmentLongTasks=[]; window.__shipmentEventTiming=[]; window.__shipmentClickMs=null; new PerformanceObserver((list)=>window.__shipmentLongTasks.push(...list.getEntries().map((e)=>({duration:Math.round(e.duration*10)/10,start:Math.round(e.startTime*10)/10})))).observe({type:"longtask",buffered:false}); new PerformanceObserver((list)=>window.__shipmentEventTiming.push(...list.getEntries().filter((e)=>e.name==='click').map((e)=>({delay:Math.round((e.processingStart-e.startTime)*10)/10,duration:Math.round(e.duration*10)/10})))).observe({type:"event",durationThreshold:16,buffered:false}); document.addEventListener('click',(event)=>{const target=event.target.closest('[role="tab"]'); if(target?.innerText.trim().startsWith('Shipments')){window.__shipmentClickStart=performance.now();window.__shipmentEventTiming.length=0;requestAnimationFrame(()=>requestAnimationFrame(()=>window.__shipmentClickMs=Math.round((performance.now()-window.__shipmentClickStart)*10)/10));}},true);`);
  for (let trial = 1; trial <= 3; trial++) await record("1440x900", trial);
  assertViewport(393, 852);
  browser("eval", `window.__shipmentLongTasks=[]`);
  for (let trial = 1; trial <= 3; trial++) await record("393x852", trial);
  clickTab("Shipments (443)");
  browser("wait", "--fn", `document.querySelector('[role="tab"][aria-selected="true"]')?.innerText.trim().startsWith('Shipments')`, "--timeout", "15000");
  const tableRegion = evalValue(`(()=>{const region=document.querySelector('[role="region"][aria-label="Shipment results table"]');region?.focus();return {focusable:region?.tabIndex===0,focused:document.activeElement===region,scrollable:region?.scrollWidth>region?.clientWidth}})()`);
  expect(tableRegion.focusable && tableRegion.focused && tableRegion.scrollable, `Shipment table region should be labeled, keyboard-focusable and scrollable: ${JSON.stringify(tableRegion)}.`);
  browser("press", "ArrowRight");
  expect(Number(evalValue(`document.querySelector('[role="region"][aria-label="Shipment results table"]').scrollLeft`)) > 0, "Keyboard arrow navigation should horizontally scroll the shipment table region.");
  clickButton("Next shipments");
  let pageStatus = String(parsedText()).match(/Showing.{0,50}shipments/)?.[0] ?? "no page status";
  expect(pageStatus === "Showing 51–100 of 443 shipments", `Next shipments should advance to rows 51–100; saw ${pageStatus}.`);
  expect(Number(evalValue("Math.max(...[...document.querySelectorAll('tbody')].map((body)=>body.rows.length))")) === 50, "The second shipment page should keep 50 table rows mounted.");
  browser("eval", `window.__scrollLongTasks=[]; new PerformanceObserver((list)=>window.__scrollLongTasks.push(...list.getEntries().map((e)=>Math.round(e.duration*10)/10))).observe({type:"longtask",buffered:false})`);
  for (const direction of ["down", "up", "down"]) {
    browser("scroll", direction, "450");
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  const scrollTasks = evalValue("JSON.stringify(window.__scrollLongTasks)");
  const scrollTaskValues = typeof scrollTasks === "string" ? JSON.parse(scrollTasks) : scrollTasks;
  expect(!scrollTaskValues.some((duration) => duration > 200), `Shipment-table scrolling observed a main-thread task over 200 ms: ${JSON.stringify(scrollTaskValues)}.`);
  console.log(`  profile steady scroll long tasks: ${JSON.stringify(scrollTaskValues)}`);
  clickButton("Previous shipments");
  const before = evalValue(`performance.getEntriesByType('resource').filter((e)=>new URL(e.name).pathname==='/api/v1/runs/${runId}').length`);
  browser("eval", `[...document.querySelectorAll('button')].find((button)=>/^Shipment 1\\b/.test(button.innerText.trim()))?.click()`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  const after = evalValue(`performance.getEntriesByType('resource').filter((e)=>new URL(e.name).pathname==='/api/v1/runs/${runId}').length`);
  expect(Number(after) === Number(before), `Selecting a shipment fetched the full run again (${before} → ${after}).`);
  console.log(`  profile selection resource check: full-result requests unchanged (${before} → ${after})`);
  clickButton("Next shipments");
  pageStatus = String(parsedText()).match(/Showing.{0,50}shipments/)?.[0] ?? "no page status";
  expect(pageStatus === "Showing 51–68 of 68 shipments", `The selected cluster should preserve its existing 68-shipment filter; saw ${pageStatus}.`);
  expect(String(parsedText()).includes("Open route: no return to the depot."), "Selection details should remain visible after changing shipment pages.");
  expect(Number(evalValue("Math.max(...[...document.querySelectorAll('tbody')].map((body)=>body.rows.length))")) === 18, "The selected cluster's final page should mount its remaining 18 table rows.");
  console.log("  profile pagination check: global page 51–100; selection keeps its cluster filter and details across the 51–68 page");
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
  if (process.env.MATRIX_PERF_PROFILE === "1") await profileLargeMatrixPreview(JSON.stringify(matrix));
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

async function profileLargeMatrixPreview(restoreText) {
  console.log("  profiling synthetic 1,001-node matrix preview at desktop and phone viewports");
  const nodes = Array.from({ length: 1001 }, (_, i) => ({ id: `P${i}`, lat: 35 + i / 10000, lon: -90 - i / 10000 }));
  const values = nodes.map((_, i) => nodes.map((__, j) => i === j ? 0 : (i * 3 + j * 5) % 1000 + 1));
  const matrix = {
    schema_version: 1, nodes, provider: "imported", provider_version: "m8-profile/1", dataset_revision: "synthetic-1001-v1", profile: "truck", options: {},
    distance_units: "meters", duration_units: "seconds", distances: values, durations: values, warnings: [], conversion: "nearest-integer-ties-to-even/v1",
  };
  const matrixText = JSON.stringify(matrix);
  const report = { generatedAt: new Date().toISOString(), payloadBytes: Buffer.byteLength(matrixText), nodes: nodes.length, trials: [] };
  const decodeEval = (expression) => { const result = evalValue(expression); return typeof result === "string" ? JSON.parse(result) : result; };
  browser("eval", `(() => {
    const state = window.__matrixProfile = { starts: [], completions: [], reserved: new Set(), longTasks: [], resources: [], fileLoads: [], visibleNodes: 0 };
    new PerformanceObserver(list => state.longTasks.push(...list.getEntries().map(e => ({ startTime: e.startTime, duration: e.duration }))))
      .observe({ type: "longtask", buffered: true });
    new PerformanceObserver(list => state.resources.push(...list.getEntries().filter(e => e.name.includes("/api/v1/travel-snapshots/preview")).map(e => ({ name: e.name, startTime: e.startTime, duration: e.duration, transferSize: e.transferSize, encodedBodySize: e.encodedBodySize, decodedBodySize: e.decodedBodySize }))))
      .observe({ type: "resource", buffered: true });
    document.querySelector('input[aria-label="Travel matrix JSON file"]').addEventListener('change', () => {
      const started = performance.now(); state.fileLoads.push({ start: started, end: null });
      const observer = new MutationObserver(() => {
        if (document.querySelector('p[role="status"]')?.textContent.includes('loaded. Preview it before saving.')) {
          state.fileLoads.at(-1).end = performance.now(); observer.disconnect();
        }
      }); observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    document.addEventListener('click', event => {
      if (event.target.closest('button')?.innerText.trim() === 'Preview matrix') state.starts.push(performance.now());
    }, true);
    const observer = new MutationObserver(() => {
      if (document.querySelector('p[role="status"]')?.textContent.includes('Matrix is valid. Review its direction, units, coverage, and sample before saving.')) {
        const end = performance.now(), start = state.starts[state.completions.length];
        if (start != null && !state.reserved.has(start)) { state.reserved.add(start); requestAnimationFrame(() => requestAnimationFrame(() => {
          state.completions.push({ start, end, paint: performance.now(), durationMs: end - start, clickToPaintMs: performance.now() - start });
          state.visibleNodes = document.querySelectorAll('body *').length;
        })); }
      }
    }); observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return true;
  })()`);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 393, height: 852 }]) {
    if (viewport.width === 393) { browser("set", "device", "iPhone 16"); browser("set", "viewport", "393", "852", "1"); }
    else setViewport(1440, 900);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const matrixPath = join(dataDir, `matrix-1001-profile-${viewport.width}-${attempt}.json`);
      writeFileSync(matrixPath, matrixText);
      browser("upload", 'input[aria-label="Travel matrix JSON file"]', matrixPath);
      browser("wait", "--text", "loaded. Preview it before saving.", "--timeout", "20000");
      browser("find", "text", "Preview matrix", "click", "--exact");
      browser("wait", "--fn", "Array.from(document.querySelectorAll('p')).some(p => p.textContent.startsWith('Valid snapshot · 1001 nodes')) || !!document.querySelector('[role=alert]')", "--timeout", "20000");
      const outcome = decodeEval("JSON.stringify({ success: Array.from(document.querySelectorAll('p')).some(p => p.textContent.startsWith('Valid snapshot · 1001 nodes')), error: document.querySelector('[role=alert]')?.textContent ?? null })");
      expect(outcome.success, `1,001-node matrix preview was rejected: ${outcome.error ?? "preview did not complete"}`);
      browser("wait", "--fn", `window.__matrixProfile && window.__matrixProfile.completions.length >= ${attempt + (viewport.width === 393 ? 3 : 0)}`, "--timeout", "10000");
      const trial = decodeEval(`JSON.stringify((() => {
        const s = window.__matrixProfile, start = s.starts.at(-1), completion = s.completions.at(-1);
        const taskEnd = completion?.paint ?? performance.now();
        return { viewport: ${JSON.stringify(`${viewport.width}x${viewport.height}`)}, attempt: ${attempt}, fileLoadMs: s.fileLoads.at(-1)?.end - s.fileLoads.at(-1)?.start,
          previewMs: completion?.durationMs, clickToPaintMs: completion?.clickToPaintMs,
          mainThreadTasks: s.longTasks.filter(t => t.startTime < taskEnd && t.startTime + t.duration > start),
          previewResources: s.resources.filter(r => r.startTime >= start), visibleDomNodes: s.visibleNodes };
      })())`);
      report.trials.push(trial);
      console.log(`    ${trial.viewport} trial ${attempt}: file ${trial.fileLoadMs?.toFixed(1)} ms; preview ${trial.previewMs?.toFixed(1)} ms; click-to-paint ${trial.clickToPaintMs?.toFixed(1)} ms; tasks ${trial.mainThreadTasks.map(t => t.duration.toFixed(1)).join(",") || "none"} ms`);
      if (attempt === 1) {
        const shotDir = process.env.MATRIX_PROFILE_SHOTS;
        if (shotDir) { mkdirSync(shotDir, { recursive: true }); browser("screenshot", "--full", join(shotDir, `matrix-1001-${viewport.width}.png`)); }
      }
    }
  }
  const output = process.env.MATRIX_PROFILE_OUT;
  if (output) { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`); }
  fillCss('textarea[aria-label="Travel matrix JSON content"]', restoreText);
  browser("find", "text", "Preview matrix", "click", "--exact");
  browser("wait", "--fn", "Array.from(document.querySelectorAll('p')).some(p => p.textContent.startsWith('Valid snapshot · 4 nodes'))", "--timeout", "20000");
  console.log(`  profile payload: ${report.payloadBytes.toLocaleString()} bytes; captured ${report.trials.length} trials`);
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

// M6 verified warm starts: a finished example run is re-run from its page, warm-started from itself. Every cluster of
// the identical problem must start from the source plan, never end above its starting objective, and say so on the page.
async function warmStartFlow(baseURL, runKey) {
  console.log("Browser smoke: warm-started rerun");
  beginBrowserFlow("warm-start");
  browser("errors", "--clear");
  browser("console", "--clear");
  const started = await localFetch(new URL("/api/v1/runs", baseURL), { method: "POST", headers: { "content-type": "application/json", "x-run-key": runKey, "idempotency-key": randomUUID() }, body: JSON.stringify({ example: "allocation" }) });
  const source = await started.json();
  expect(started.status === 201 && source?.id, `Source run was not queued: ${JSON.stringify(source)}`);
  const sourceDetail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${source.id}`, runKey, "x-run-key"), (body) => ["succeeded", "failed"].includes(body?.status), "Warm-start source run");
  expect(sourceDetail.status === "succeeded" && sourceDetail.summary?.validity === "valid", `Source run did not validate: ${JSON.stringify(sourceDetail.summary?.validity)}`);
  const key = `?key=${encodeURIComponent(runKey)}`;
  open(`${baseURL}/runs/${source.id}${key}`);
  browser("wait", "--text", "Re-run warm-started", "--timeout", "20000");
  clickButton("Re-run warm-started");
  const path = await poll(() => evalValue("location.pathname"), (p) => typeof p === "string" && /^\/runs\/[0-9a-f-]+$/i.test(p) && !p.endsWith(source.id), "Warm rerun navigation", 20_000);
  const runId = path.split("/").at(-1);
  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}`, runKey, "x-run-key"), (body) => ["succeeded", "failed"].includes(body?.status), "Warm-started run");
  expect(detail.status === "succeeded", `Warm-started run failed: ${JSON.stringify(detail.failure)}`);
  const warm = detail.summary.warm_start;
  const outcomes = detail.summary.clusters.filter((c) => c.warm_start).map((c) => c.warm_start);
  expect(detail.settings.warm_start?.run_id === source.id && warm?.source?.run_id === source.id, "Warm-started run does not name its source.");
  expect(outcomes.length > 0 && warm.used === outcomes.length && warm.skipped === 0, `Identical rerun should use every cluster: ${JSON.stringify(outcomes)}`);
  expect(outcomes.every((o) => o.status === "used" && o.final_cost <= o.initial_cost), `A warm-started cluster ended above its starting objective: ${JSON.stringify(outcomes)}`);
  expect(detail.stages.some((s) => s.stage === "warm_start") && detail.summary.validity === "valid", "Warm-started run lacks its warm_start stage or validity.");
  expect(detail.summary.totals.trucks <= sourceDetail.summary.totals.trucks, "Warm-started run needs more trucks than its source.");
  browser("wait", "--text", "started from its validated plan", "--timeout", "20000");
  const text = String(parsedText());
  expect(text.includes(`${warm.used} of ${warm.used} solved`) && (text.match(/\bUsed\b/g) ?? []).length >= outcomes.length, "Run page does not show the per-cluster warm-start outcome.");
  expect(text.includes(`warm-started from run ${source.id.slice(0, 8)}`) || text.includes(source.id.slice(0, 8)), "Run page does not link the warm-start source.");
  expect(text.includes("Re-run warm-started"), "A run that finished while its page was open should offer the warm rerun.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("warm start");
  console.log(`  passed: run ${runId.slice(0, 8)} warm-started from ${source.id.slice(0, 8)}, ${warm.used} cluster(s) used, objective never higher`);
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

// The road matrix lesson (M7): both runs start from the page on the bundled synthetic scenario, one on estimated travel and
// one on the bundled synthetic recorded matrix; the page's comparison and the run page are checked against the persisted
// runs (the facts services/optimizer/tests/test_lesson_matrix.py asserts), and the recorded run's exports carry its matrix.
async function roadMatricesFlow(baseURL, runKey) {
  console.log("Browser smoke: Haversine versus recorded road matrices lesson");
  beginBrowserFlow("road-matrices");
  browser("errors", "--clear");
  browser("console", "--clear");
  const access = `?key=${encodeURIComponent(runKey)}`;
  const doneRun = (id, label) => poll(() => fetchOkJson(baseURL, `/api/v1/runs/${id}${access}`, runKey, "x-run-key"), (body) => ["succeeded", "failed"].includes(body?.status), label);
  const runLinks = () => evalValue(`JSON.stringify([...document.querySelectorAll('a[href^="/runs/"]')].map((a) => a.getAttribute('href').split('/').pop().split('?')[0]))`);
  const linkIds = () => { const raw = runLinks(); return typeof raw === "string" ? JSON.parse(raw) : raw; };
  open(`${baseURL}/learn/road-matrices${access}`);
  expect(snapshot().includes('heading "Haversine versus recorded road matrices"'), "Road matrix lesson did not load.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  let page = String(parsedText());
  expect(page.includes("Synthetic") && page.includes("It is not real roads"), "Road matrix lesson does not label its matrix as synthetic.");
  expect(/Memphis DC → Ridge resort\s+470 mi\s+633 mi/.test(page) && /Grocery warehouse → Hardware store\s+60 mi\s+321 mi/.test(page), "Road matrix lesson's detour table is missing the ridge or westbound pair.");

  clickButton("Run on estimated travel");
  browser("wait", "--text", "Open estimated run", "--timeout", "20000");
  const [estimatedId] = linkIds();
  expect(/^[0-9a-f-]{36}$/.test(estimatedId ?? ""), `Estimated run link is unexpected: ${estimatedId}`);
  const estimated = await doneRun(estimatedId, "Road matrix lesson, estimated run");
  checkRun(estimated, "road matrix lesson, estimated");
  const est = estimated.summary;
  expect(est.travel?.mode === "estimated" && estimated.settings.travel_snapshot_id === null && est.totals.trucks === 2 && milesOf(est) === 724 && est.unplanned.length === 0,
    `Estimated run should plan every stop on 2 trucks, about 724 estimated miles: ${est.totals.trucks} trucks, ${milesOf(est)} mi.`);

  clickButton("Run on the recorded matrix");
  browser("wait", "--text", "Open recorded-matrix run", "--timeout", "20000");
  const recordedId = linkIds().find((id) => id !== estimatedId);
  expect(/^[0-9a-f-]{36}$/.test(recordedId ?? ""), `Recorded-matrix run link is unexpected: ${recordedId}`);
  const recorded = await doneRun(recordedId, "Road matrix lesson, recorded-matrix run");
  const rec = recorded.summary;
  const snapshotId = recorded.settings.travel_snapshot_id;
  expect(recorded.status === "succeeded" && rec.validity === "valid" && rec.coverage === "partial", `Recorded-matrix run should be valid and partial: ${recorded.status} ${rec?.validity} ${rec?.coverage}`);
  expect(/^[0-9a-f]{64}$/.test(snapshotId ?? "") && rec.travel?.mode === "snapshot" && rec.travel.snapshot_id === snapshotId && rec.travel.provider === "imported" && rec.travel.dataset_revision.includes("not real roads"),
    `Recorded-matrix run does not record the bundled synthetic snapshot: ${JSON.stringify(rec.travel)}`);
  expect(stable(rec.unplanned.map((u) => [u.location_id, u.reason, u.pieces])) === stable([["RM-07", "unreachable", 4]]), `Only the ridge resort should be unshipped, as unreachable: ${JSON.stringify(rec.unplanned)}`);
  expect(rec.totals.trucks === 1 && milesOf(rec) === 488, `Recorded-matrix run should use 1 truck and about 488 matrix miles: ${rec.totals.trucks} trucks, ${milesOf(rec)} mi.`);
  expect(rec.trucks[0].visits.map((v) => v.location_id).join() === "RM-02,RM-01,RM-03,RM-04,RM-06,RM-05", `Recorded-matrix truck should serve the west bank first: ${rec.trucks[0].visits.map((v) => v.location_id)}`);
  expect(stable(rec.clusters.map((c) => c.location_ids)) === stable(est.clusters.map((c) => c.location_ids)), "Travel must not change the clusters.");

  // The page's side-by-side comparison reads the same persisted runs.
  browser("wait", "--text", "Not interchangeable", "--timeout", "20000");
  page = String(parsedText());
  for (const needle of [`${milesOf(est)} mi (estimated miles)`, `${milesOf(rec)} mi (recorded-matrix miles)`, "Ridge resort: 4 (unreachable)", "valid, complete", "valid, partial", "Recorded matrix (imported, synthetic)"])
    expect(page.includes(needle), `Road matrix comparison is missing "${needle}".`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("road matrix lesson");

  // The recorded run's page labels its miles and drive times by the matrix, and its exports carry the matrix.
  open(`${baseURL}/runs/${recordedId}${access}`);
  browser("wait", "--text", "Validated, partial coverage", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes("From the recorded matrix (synthetic-lesson-network") && !page.includes("Estimated: haversine"), "Recorded-matrix run page does not label its miles by the matrix.");
  await checkTimeline(recorded, "road matrix lesson", { timing: "Imported matrix durations" });
  const exportGet = (query) => localFetch(new URL(`/api/v1/runs/${recordedId}/export?${query}`, baseURL), { headers: { "x-run-key": runKey }, signal: AbortSignal.timeout(15_000) });
  const matrixExport = await (await exportGet("format=matrix&as=json")).json();
  expect(matrixExport.snapshot_id === snapshotId && matrixExport.snapshot?.options?.synthetic === true && matrixExport.binding?.every((b) => b.in_snapshot && b.coordinates_match), "Recorded run's matrix export does not carry the bundled synthetic snapshot.");
  const bundle = await exportGet("format=python");
  expect(bundle.status === 200 && Buffer.from(await bundle.arrayBuffer()).includes("travel-snapshot.json"), "Recorded run's replay bundle should include travel-snapshot.json.");
  expect((await localFetch(new URL(`/api/v1/runs/${estimatedId}/export?format=matrix`, baseURL), { headers: { "x-run-key": runKey } })).status === 409, "The estimated run has no recorded matrix to export.");
  checkBrowserDiagnostics("road matrix lesson run");
  console.log(`  passed: estimated 2 trucks/${milesOf(est)} mi complete; recorded matrix ${snapshotId.slice(0, 10)} 1 truck/${milesOf(rec)} mi, ridge resort unreachable; comparison, timeline and exports`);
}

// Solver Lab lessons (spec §13): the load dimension and heterogeneous fleet lessons start their two bundled lab
// examples from the page. The page's comparison table is read back and checked against the persisted lab runs, whose
// observations are asserted in services/optimizer/tests/test_lab_examples.py.
async function labLessonsFlow(baseURL, runKey) {
  console.log("Browser smoke: Solver Lab lessons (load dimensions, heterogeneous fleets)");
  beginBrowserFlow("lab-lessons");
  browser("errors", "--clear");
  browser("console", "--clear");
  const access = `?key=${encodeURIComponent(runKey)}`;
  const jsonEval = (js) => { const raw = evalValue(js); return typeof raw === "string" ? JSON.parse(raw) : raw; };
  const labRunIds = () => jsonEval(`JSON.stringify([...document.querySelectorAll('a[href^="/labs/"]')].map((a) => a.getAttribute('href').split('/').pop().split('?')[0]))`);
  const doneRun = (id, label) => poll(() => fetchOkJson(baseURL, `/api/v1/lab/runs/${id}${access}`, runKey, "x-run-key"), (body) => ["succeeded", "failed", "cancelled"].includes(body?.status), label);
  const pct = (ratio) => `${(ratio * 100).toFixed(0)}%`;
  const num = (n) => n.toLocaleString("en-US");
  const maxUtil = (result, dimension, type) => { const v = result.routes.filter((r) => !type || r.vehicle_type === type).map((r) => r.utilization[dimension]).filter((u) => u !== undefined); return v.length ? Math.max(...v) : null; };
  const pctOrDash = (ratio) => (ratio === null ? "—" : pct(ratio));
  const tableRows = () => Object.fromEntries(jsonEval(`JSON.stringify([...document.querySelectorAll('[data-testid="lab-compare"] tr[data-row]')].map((tr) => [tr.dataset.row, [...tr.cells].slice(1).map((c) => c.innerText.trim())]))`));

  async function lesson({ path, heading, buttons, links, examples, check, expectRows }) {
    open(`${baseURL}/learn/${path}${access}`);
    expect(snapshot().includes(`heading "${heading}"`), `${heading} lesson did not load.`);
    assertViewport(1440, 900);
    assertViewport(393, 852);
    setViewport(1440, 900);
    expect(!String(parsedText()).includes("Side by side"), `${heading}: the comparison should wait for both runs.`);
    const details = [];
    for (const [i, example] of examples.entries()) {
      clickButtonCentered(buttons[i]);
      browser("wait", "--text", links[i], "--timeout", "20000");
      const ids = labRunIds().filter((id) => !details.some((d) => d.id === id));
      expect(/^[0-9a-f-]{36}$/.test(ids[0] ?? ""), `${heading}: run link for ${example} is unexpected: ${ids}`);
      const detail = await doneRun(ids[0], `${heading}, ${example} lab run`);
      expect(detail.status === "succeeded" && detail.kind === "lab" && detail.example === example, `${heading}: ${example} run did not succeed: ${JSON.stringify(detail).slice(0, 600)}`);
      expect(detail.result.validated_feasible && detail.result.solver_feasible && detail.result.violations.length === 0 && detail.result.proof === "heuristic", `${heading}: ${example} result is not validated feasible.`);
      details.push(detail);
    }
    const [first, second] = details.map((d) => d.result);
    check(first, second);
    browser("wait", "--text", "Side by side", "--timeout", "20000");
    const rows = tableRows();
    const expected = expectRows(first, second);
    for (const [key, cells] of Object.entries(expected)) expect(stable(rows[key]) === stable(cells), `${heading}: comparison row "${key}" shows ${JSON.stringify(rows[key])}, persisted runs say ${JSON.stringify(cells)}.`);
    expect(Object.keys(rows).length === Object.keys(expected).length, `${heading}: comparison has rows ${Object.keys(rows)}.`);
    const text = String(parsedText());
    expect(text.includes("Editable starter") && text.includes("Model fields this lesson uses") && text.includes("Not modeled:"), `${heading}: starter or model fields are missing.`);
    assertViewport(1440, 900);
    assertViewport(393, 852);
    setViewport(1440, 900);
    // The run is remembered across a reload, and Reset forgets it.
    browser("reload");
    browser("wait", "--text", "Side by side", "--timeout", "20000");
    clickButtonCentered("Reset lesson");
    browser("wait", "--text", "Run steps 1 and 2 first", "--timeout", "10000");
    expect(!String(parsedText()).includes("Side by side"), `${heading}: reset should clear the comparison.`);
    expect(labRunIds().length === 0, `${heading}: reset should forget the started runs.`);
    return details;
  }

  const dims = await lesson({
    path: "load-dimensions",
    heading: "Multiple load dimensions",
    buttons: ["Run with weight and volume", "Run with volume only"],
    links: ["Open two-dimension run", "Open volume-only run"],
    examples: ["dimensions", "dimensions_volume"],
    check(both, volume) {
      expect(both.totals.routes === 3 && both.totals.load.weight === 2860 && both.routes.every((r) => r.load.weight <= 1200), `Two-dimension run should need 3 trucks for 2,860 kg: ${JSON.stringify(both.totals)}`);
      expect(maxUtil(both, "weight") >= 0.85 && maxUtil(both, "volume") < 0.6 && both.objective.fixed_cost === 300, "Weight should bind and volume stay under 60%.");
      expect(volume.totals.routes === 2 && maxUtil(volume, "volume") < 0.7 && volume.objective.fixed_cost === 200 && volume.objective.total < both.objective.total && volume.problem_fingerprint !== both.problem_fingerprint, "Volume-only run should need 2 trucks, all under 70% volume, at a lower objective.");
    },
    expectRows: (both, volume) => Object.fromEntries([
      ["feasible", ["yes", "yes"]],
      ["trucks", [num(both.totals.routes), num(volume.totals.routes)]],
      ["weight", [pctOrDash(maxUtil(both, "weight")), pctOrDash(maxUtil(volume, "weight"))]],
      ["volume", [pctOrDash(maxUtil(both, "volume")), pctOrDash(maxUtil(volume, "volume"))]],
      ["load", [`${num(both.totals.load.weight)} kg, ${num(both.totals.load.volume)} L`, `${num(volume.totals.load.volume)} L`]],
      ["fixed", [num(both.objective.fixed_cost), num(volume.objective.fixed_cost)]],
      ["distance", [num(both.objective.distance_cost), num(volume.objective.distance_cost)]],
      ["objective", [num(both.objective.total), num(volume.objective.total)]],
    ]),
  });
  checkBrowserDiagnostics("load dimensions lesson");

  const fleet = await lesson({
    path: "heterogeneous-fleet",
    heading: "Heterogeneous fleets",
    buttons: ["Run the mixed fleet", "Run trucks only"],
    links: ["Open mixed-fleet run", "Open trucks-only run"],
    examples: ["fleet", "fleet_trucks"],
    check(mixed, trucks) {
      const used = (r) => stable(Object.fromEntries(r.fleet.map((f) => [f.vehicle_type, [f.used, f.available]])));
      expect(used(mixed) === stable({ "box-truck": [1, 3], van: [3, 3] }) && mixed.objective.fixed_cost === 85_000 && mixed.units.distance === "meters", `Mixed fleet should use every van and one truck: ${used(mixed)}`);
      expect(maxUtil(mixed, "pallets", "van") === 1 && maxUtil(mixed, "pallets", "box-truck") < 1, "A van should be full and the box truck not.");
      expect(used(trucks) === stable({ "box-truck": [3, 3] }) && trucks.objective.fixed_cost === 120_000 && maxUtil(trucks, "pallets") < 0.8, `Trucks-only run should use 3 trucks, none above 80%: ${used(trucks)}`);
      expect(mixed.totals.load.pallets === 30 && trucks.totals.load.pallets === 30 && trucks.objective.total > mixed.objective.total, "Trucks only should cost more for the same 30 pallets.");
    },
    expectRows: (mixed, trucks) => {
      const types = (r) => r.fleet.map((f) => `${f.vehicle_type} ${f.used} of ${f.available}`).join(", ");
      const miles = (r) => `${num(Math.round(r.totals.distance / 1609.344))} mi`;
      return Object.fromEntries([
        ["feasible", ["yes", "yes"]],
        ["vehicles", [num(mixed.totals.routes), num(trucks.totals.routes)]],
        ["types", [types(mixed), types(trucks)]],
        ["load", ["30 pallets", "30 pallets"]],
        ["van-util", [pctOrDash(maxUtil(mixed, "pallets", "van")), pctOrDash(maxUtil(trucks, "pallets", "van"))]],
        ["truck-util", [pctOrDash(maxUtil(mixed, "pallets", "box-truck")), pctOrDash(maxUtil(trucks, "pallets", "box-truck"))]],
        ["distance", [miles(mixed), miles(trucks)]],
        ["fixed", [num(mixed.objective.fixed_cost), num(trucks.objective.fixed_cost)]],
        ["distance-cost", [num(mixed.objective.distance_cost), num(trucks.objective.distance_cost)]],
        ["objective", [num(mixed.objective.total), num(trucks.objective.total)]],
      ]);
    },
  });
  checkBrowserDiagnostics("heterogeneous fleet lesson");

  // The starter links preselect the example in the Solver Lab, and the lessons are linked from the index.
  open(`${baseURL}/labs?example=fleet_trucks&key=${encodeURIComponent(runKey)}`);
  browser("wait", "--text", "trucks only", "--timeout", "10000");
  expect(String(parsedText()).includes("Heterogeneous fleet, trucks only"), "/labs?example=fleet_trucks should preselect the trucks-only example.");
  open(`${baseURL}/learn${access}`);
  const index = snapshot();
  expect(index.includes('link "Multiple load dimensions"') && index.includes('link "Heterogeneous fleets"'), "The lessons index should link both Solver Lab lessons.");
  assertViewport(393, 852);
  assertViewport(1440, 900);
  checkBrowserDiagnostics("Solver Lab lessons");
  console.log(`  passed: dimensions ${dims[0].result.totals.routes} then ${dims[1].result.totals.routes} trucks; fleet ${fleet[0].result.totals.routes} vehicles (3 vans + 1 truck) then ${fleet[1].result.totals.routes} box trucks; comparisons match persisted runs`);
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

// Solver Lab multiple depots (M6): the lesson starts the two-depot example and its one-depot twin from the page; the
// persisted validated results are what the page compares, and the lab run page shows depots and per-route depots.
// Every number is checked against services/optimizer/tests/test_lab_examples.py.
async function labDepotsFlow(baseURL, runKey) {
  console.log("Browser smoke: Solver Lab multiple depots lesson");
  beginBrowserFlow("lab-depots");
  browser("errors", "--clear");
  browser("console", "--clear");
  const keyed = `key=${encodeURIComponent(runKey)}`;
  const doneRun = (id, label) => poll(() => fetchOkJson(baseURL, `/api/v1/lab/runs/${id}?${keyed}`, runKey, "x-run-key"), (body) => ["succeeded", "failed", "cancelled"].includes(body?.status), label);
  const labLinks = () => { const raw = evalValue(`JSON.stringify([...document.querySelectorAll('a[href^="/labs/"]')].map((a) => a.getAttribute('href').split('/').pop().split('?')[0]))`); return typeof raw === "string" ? JSON.parse(raw) : raw; };
  open(`${baseURL}/learn/multiple-depots?${keyed}`);
  expect(snapshot().includes('heading "Multiple depots"'), "Multiple depots lesson did not load.");
  let page = String(parsedText());
  expect(page.includes("West depot") && page.includes("East depot") && page.includes("start_depot, end_depot") && page.includes("Not modeled:"), "Lesson is missing its depot table or model fields.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  clickButtonCentered("Run with two depots");
  browser("wait", "--text", "Open two-depot run", "--timeout", "20000");
  const [twoId] = labLinks();
  expect(/^[0-9a-f-]{36}$/.test(twoId ?? ""), `Two-depot run link is unexpected: ${twoId}`);
  const two = await doneRun(twoId, "Two-depot lab run");
  expect(two.status === "succeeded" && two.example === "depots", `Two-depot run did not succeed: ${JSON.stringify(two).slice(0, 800)}`);
  const a = two.result;
  expect(a.validated_feasible && a.solver_feasible && a.violations.length === 0 && a.totals.routes === 4 && a.objective.total === 689 && a.objective.fixed_cost === 400 && a.totals.distance === 289,
    `Two-depot plan should be 4 routes, objective 689 (400 fixed): ${JSON.stringify(a.objective)} ${JSON.stringify(a.totals)}`);
  for (const route of a.routes) {
    const west = route.vehicle_type === "west-van";
    expect(route.start_depot === (west ? "west" : "east") && route.end_depot === route.start_depot && route.visits.length === 3 && route.visits.every((v) => v.client_id.startsWith(west ? "W-" : "E-")),
      `Route ${route.index} should stay on its own depot's side: ${JSON.stringify([route.vehicle_type, route.start_depot, route.end_depot, route.visits.map((v) => v.client_id)])}`);
  }

  clickButtonCentered("Run from one depot");
  browser("wait", "--text", "Open one-depot run", "--timeout", "20000");
  const oneId = labLinks().find((id) => id !== twoId);
  expect(/^[0-9a-f-]{36}$/.test(oneId ?? ""), `One-depot run link is unexpected: ${oneId}`);
  const one = await doneRun(oneId, "One-depot lab run");
  expect(one.status === "succeeded" && one.example === "depots_single", `One-depot run did not succeed: ${JSON.stringify(one).slice(0, 800)}`);
  const b = one.result;
  expect(b.validated_feasible && b.totals.routes === 4 && b.objective.fixed_cost === 400 && b.objective.total === 1096 && b.problem_fingerprint !== a.problem_fingerprint && b.routes.every((r) => r.start_depot === "west"),
    `One-depot plan should be 4 routes from West, objective 1096: ${JSON.stringify(b.objective)}`);
  const east = b.routes.filter((r) => r.visits.every((v) => v.client_id.startsWith("E-")));
  expect(east.length === 2 && east.every((r) => r.distance > 200), `Two routes should drive out to the East stops: ${JSON.stringify(b.routes.map((r) => [r.distance, r.visits.map((v) => v.client_id)]))}`);

  // The page's side-by-side comparison reads the same persisted runs.
  browser("wait", "--text", "Side by side", "--timeout", "20000");
  const cell = (key, id) => String(evalValue(`document.querySelector('[data-testid="depots-${key}-${id}"]')?.innerText ?? ""`));
  expect(cell("two", "objective") === "689" && cell("one", "objective") === "1,096" && cell("two", "fixed") === "400" && cell("one", "fixed") === "400" && cell("two", "routes") === "4" && cell("one", "routes") === "4",
    `Comparison cells do not match the persisted results: ${cell("two", "objective")} / ${cell("one", "objective")}`);
  expect(cell("two", "distance") === a.totals.distance.toLocaleString("en-US") && cell("one", "distance") === b.totals.distance.toLocaleString("en-US"), "Comparison distances differ from the persisted results.");
  expect(cell("two", "routes-by-depot").includes("west: ") && cell("two", "routes-by-depot").includes("east: ") && !cell("one", "routes-by-depot").includes("east: "), "Comparison should name each route's depot.");
  expect(Number(evalValue("document.querySelectorAll('svg rect[data-depot]').length")) === 3, "The two plots should mark 2 + 1 depots.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("multiple depots lesson");

  // The run page shows the depots, each route's depot and a plot with a marker per depot.
  open(`${baseURL}/labs/${twoId}?${keyed}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes("2 depots") && page.includes("Vehicles based here") && page.includes("west-van 2 / 2") && page.includes("east-van 2 / 2"), "Lab run page does not show its depots and the fleet per depot.");
  expect(Number(evalValue("document.querySelectorAll('svg rect[data-depot]').length")) === 2 && Number(evalValue("document.querySelectorAll('svg polyline[data-route]').length")) === 4, "Lab plot should mark both depots and draw 4 routes.");
  const rows = JSON.parse(String(evalValue(`JSON.stringify([...document.querySelectorAll('[data-testid="lab-routes"] tbody tr')].map((tr) => tr.children[2].innerText.trim()))`)));
  expect(stable(rows.sort()) === stable(["east", "east", "west", "west"]), `Route table depots: ${JSON.stringify(rows)}`);
  expect(Number(evalValue("document.querySelector('[data-testid=\"lab-depot-west\"] td:nth-child(3)').innerText")) === 2, "West depot should list 2 routes.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);

  // Reset forgets the started runs but keeps them stored.
  open(`${baseURL}/learn/multiple-depots?${keyed}`);
  browser("wait", "--text", "Open two-depot run", "--timeout", "20000");
  clickButtonCentered("Reset lesson");
  browser("wait", "--text", "Run steps 1 and 2 first", "--timeout", "10000");
  expect(!String(parsedText()).includes("Open two-depot run"), "Reset should forget the started runs.");
  checkBrowserDiagnostics("multiple depots run page");
  console.log(`  passed: two depots 4 routes objective ${a.objective.total} (each depot serves its side); one depot objective ${b.objective.total}; comparison, run page and reset`);
}

// Solver Lab reloads (M6): the lesson starts the reloading example and its no-reload twin from the page; the persisted
// validated results are what the page compares, and the lab run page shows trips, per-trip loads and the reload depot.
// Every number is checked against services/optimizer/tests/test_lab_examples.py.
async function labReloadsFlow(baseURL, runKey) {
  console.log("Browser smoke: Solver Lab reloads lesson");
  beginBrowserFlow("lab-reloads");
  browser("errors", "--clear");
  browser("console", "--clear");
  const keyed = `key=${encodeURIComponent(runKey)}`;
  const doneRun = (id, label) => poll(() => fetchOkJson(baseURL, `/api/v1/lab/runs/${id}?${keyed}`, runKey, "x-run-key"), (body) => ["succeeded", "failed", "cancelled"].includes(body?.status), label);
  const labLinks = () => { const raw = evalValue(`JSON.stringify([...document.querySelectorAll('a[href^="/labs/"]')].map((a) => a.getAttribute('href').split('/').pop().split('?')[0]))`); return typeof raw === "string" ? JSON.parse(raw) : raw; };
  open(`${baseURL}/learn/reloads?${keyed}`);
  expect(snapshot().includes('heading "Reloads and multiple trips"'), "Reloads lesson did not load.");
  let page = String(parsedText());
  expect(page.includes("Reload yard") && page.includes("reload_depots") && page.includes("max_reloads") && page.includes("Not modeled:"), "Lesson is missing its depot table or model fields.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  clickButtonCentered("Run with reloads");
  browser("wait", "--text", "Open reload run", "--timeout", "20000");
  const [onId] = labLinks();
  expect(/^[0-9a-f-]{36}$/.test(onId ?? ""), `Reload run link is unexpected: ${onId}`);
  const on = await doneRun(onId, "Reload lab run");
  expect(on.status === "succeeded" && on.example === "reloads", `Reload run did not succeed: ${JSON.stringify(on).slice(0, 800)}`);
  const a = on.result;
  expect(a.validated_feasible && a.solver_feasible && a.violations.length === 0 && a.totals.routes === 1 && a.objective.total === 533 && a.objective.fixed_cost === 100 && a.totals.distance === 433,
    `Reload plan should be one route, objective 533: ${JSON.stringify(a.objective)} ${JSON.stringify(a.totals)}`);
  const [route] = a.routes;
  expect(route.trips.length === 4 && route.load.parcels === 40 && route.trips.every((t) => t.load.parcels === 10 && t.client_ids.length === 2) && route.trips.map((t) => t.from_depot).join() === "dc,yard,yard,yard" && route.trips.map((t) => t.to_depot).join() === "yard,yard,yard,dc",
    `The van should make 4 full trips through the yard: ${JSON.stringify(route.trips.map((t) => [t.from_depot, t.to_depot, t.client_ids, t.load]))}`);

  clickButtonCentered("Run without reloads");
  browser("wait", "--text", "Open no-reload run", "--timeout", "20000");
  const offId = labLinks().find((id) => id !== onId);
  expect(/^[0-9a-f-]{36}$/.test(offId ?? ""), `No-reload run link is unexpected: ${offId}`);
  const off = await doneRun(offId, "No-reload lab run");
  expect(off.status === "succeeded" && off.example === "reloads_off", `No-reload run did not succeed: ${JSON.stringify(off).slice(0, 800)}`);
  const b = off.result;
  expect(b.validated_feasible && b.totals.routes === 4 && b.objective.fixed_cost === 400 && b.objective.total === 1180 && b.totals.distance === 780 && b.problem_fingerprint !== a.problem_fingerprint && b.routes.every((r) => r.trips.length === 1),
    `No-reload plan should be 4 vans, objective 1180: ${JSON.stringify(b.objective)}`);
  expect(route.duration > Math.max(...b.routes.map((r) => r.duration)), "The reloading van should work for longer than any single-trip van.");

  // The page's side-by-side comparison reads the same persisted runs.
  browser("wait", "--text", "Side by side", "--timeout", "20000");
  const cell = (key, id) => String(evalValue(`document.querySelector('[data-testid="reloads-${key}-${id}"]')?.innerText ?? ""`));
  expect(cell("on", "objective") === "533" && cell("off", "objective") === "1,180" && cell("on", "fixed") === "100" && cell("off", "fixed") === "400" && cell("on", "routes") === "1" && cell("off", "routes") === "4" && cell("on", "trips") === "4" && cell("off", "trips") === "4",
    `Comparison cells do not match the persisted results: ${cell("on", "objective")} / ${cell("off", "objective")}`);
  expect(cell("on", "distance") === "433" && cell("off", "distance") === "780", "Comparison distances differ from the persisted results.");
  expect(cell("on", "trip-list").includes("dc → yard: ") && cell("on", "trip-list").includes("yard → dc: ") && !cell("off", "trip-list").includes("yard"), "Comparison should list each trip's depots.");
  expect(Number(evalValue("document.querySelectorAll('svg rect[data-reload=\"yard\"]').length")) === 1, "The reloading plot should mark the yard as a reload depot.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("reloads lesson");

  // The run page shows the trips, their loads and the reload depot.
  open(`${baseURL}/labs/${onId}?${keyed}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes("Trips (load resets at every reload)"), "Lab run page does not show its Trips table.");
  expect(Number(evalValue("document.querySelectorAll('[data-testid=\"lab-trips\"] tbody tr').length")) === 4, "The Trips table should list 4 trips.");
  expect(String(evalValue("document.querySelector('[data-testid=\"lab-trip-0-1\"]').innerText")).includes("yard → yard") && String(evalValue("document.querySelector('[data-testid=\"lab-trip-0-3\"]').innerText")).includes("10 / 10"), "Trip rows should show reload depots and a full 10 / 10 load.");
  expect(page.includes("Dashed square: a reload depot") && Number(evalValue("document.querySelectorAll('svg polyline[data-route]').length")) === 1 && Number(evalValue("document.querySelectorAll('svg rect[data-depot]').length")) === 2, "Plot should draw one route and mark both depots with the reload depot ringed.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  assertViewport(1440, 900);

  // Reset forgets the started runs but keeps them stored.
  open(`${baseURL}/learn/reloads?${keyed}`);
  browser("wait", "--text", "Open reload run", "--timeout", "20000");
  clickButtonCentered("Reset lesson");
  browser("wait", "--text", "Run steps 1 and 2 first", "--timeout", "10000");
  expect(!String(parsedText()).includes("Open reload run"), "Reset should forget the started runs.");
  checkBrowserDiagnostics("reloads run page");
  console.log(`  passed: reloads 1 van/4 trips objective ${a.objective.total}; no reloads 4 vans objective ${b.objective.total}; comparison, run page and reset`);
}

// Solver Lab optional clients (M6): the lesson starts the low-prize example and its high-prize twin from the page; the
// persisted validated results are what the page compares, and the lab run page lists visited and skipped clients and
// separates the nominal cost from uncollected prizes. Every number is checked against tests/test_lab_examples.py.
async function labPrizesFlow(baseURL, runKey) {
  console.log("Browser smoke: Solver Lab optional visits lesson");
  beginBrowserFlow("lab-prizes");
  browser("errors", "--clear");
  browser("console", "--clear");
  const keyed = `key=${encodeURIComponent(runKey)}`;
  const doneRun = (id, label) => poll(() => fetchOkJson(baseURL, `/api/v1/lab/runs/${id}?${keyed}`, runKey, "x-run-key"), (body) => ["succeeded", "failed", "cancelled"].includes(body?.status), label);
  const labLinks = () => { const raw = evalValue(`JSON.stringify([...document.querySelectorAll('a[href^="/labs/"]')].map((a) => a.getAttribute('href').split('/').pop().split('?')[0]))`); return typeof raw === "string" ? JSON.parse(raw) : raw; };
  open(`${baseURL}/learn/optional-visits?${keyed}`);
  expect(snapshot().includes('heading "Optional visits and prizes"'), "Optional visits lesson did not load.");
  let page = String(parsedText());
  expect(page.includes("optional, prize 60") && page.includes("clients[].prize") && page.includes("Not modeled:"), "Lesson is missing its client table or model fields.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  clickButtonCentered("Run with prize 60");
  browser("wait", "--text", "Open low-prize run", "--timeout", "20000");
  const [lowId] = labLinks();
  expect(/^[0-9a-f-]{36}$/.test(lowId ?? ""), `Low-prize run link is unexpected: ${lowId}`);
  const low = await doneRun(lowId, "Low-prize lab run");
  expect(low.status === "succeeded" && low.example === "prizes", `Low-prize run did not succeed: ${JSON.stringify(low).slice(0, 800)}`);
  const a = low.result, ao = a.objective;
  expect(a.validated_feasible && a.solver_feasible && a.violations.length === 0 && a.totals.routes === 1 && a.totals.clients_served === 5 && a.skipped.map((x) => x.client_id).join() === "P-6,P-7,P-8" && ao.total === 315 && ao.uncollected_prizes === 180 && ao.prizes_collected === 0 && ao.objective_with_prizes === 495 && a.solver.nominal_cost === 315,
    `Low-prize plan should skip the 3 remote stops, nominal 315 + 180 uncollected: ${JSON.stringify(ao)} ${JSON.stringify(a.skipped)}`);

  clickButtonCentered("Run with prize 400");
  browser("wait", "--text", "Open high-prize run", "--timeout", "20000");
  const highId = labLinks().find((id) => id !== lowId);
  expect(/^[0-9a-f-]{36}$/.test(highId ?? ""), `High-prize run link is unexpected: ${highId}`);
  const high = await doneRun(highId, "High-prize lab run");
  expect(high.status === "succeeded" && high.example === "prizes_high", `High-prize run did not succeed: ${JSON.stringify(high).slice(0, 800)}`);
  const b = high.result, bo = b.objective;
  expect(b.validated_feasible && b.skipped.length === 0 && b.totals.clients_served === 8 && b.totals.routes === 2 && bo.total === 800 && bo.uncollected_prizes === 0 && bo.prizes_collected === 1200 && b.problem_fingerprint !== a.problem_fingerprint,
    `High-prize plan should visit all 8 stops, nominal 800: ${JSON.stringify(bo)}`);

  // The page's side-by-side comparison reads the same persisted runs.
  browser("wait", "--text", "Side by side", "--timeout", "20000");
  const cell = (key, id) => String(evalValue(`document.querySelector('[data-testid="prizes-${key}-${id}"]')?.innerText ?? ""`));
  expect(cell("low", "nominal") === "315" && cell("high", "nominal") === "800" && cell("low", "uncollected") === "180" && cell("high", "uncollected") === "0" && cell("low", "objective") === "495" && cell("high", "objective") === "800" && cell("low", "visited") === "5 of 8" && cell("high", "visited") === "8 of 8" && cell("low", "skipped") === "P-6, P-7, P-8" && cell("high", "collected") === "1,200",
    `Comparison cells do not match the persisted results: ${cell("low", "nominal")} / ${cell("high", "nominal")}`);
  expect(Number(evalValue("document.querySelectorAll('svg circle[data-skipped]').length")) === 3, "The low-prize plot should draw 3 skipped clients as dashed circles.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("optional visits lesson");

  // The run page lists visited and skipped optional clients and separates prizes from the nominal cost.
  open(`${baseURL}/labs/${lowId}?${keyed}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes("Optional clients: 0 visited, 3 skipped") && page.includes("Skipped: prize missed") && page.includes("Objective PyVRP minimizes"), "Run page does not show skipped clients and the prize terms.");
  const text = (id) => String(evalValue(`document.querySelector('[data-testid="${id}"]')?.innerText ?? ""`));
  expect(text("lab-objective-total") === "315" && text("lab-uncollected-prizes") === "180" && text("lab-objective-with-prizes") === "495" && text("lab-prizes-collected") === "0", "Run page prize terms do not match the persisted result.");
  expect(text("lab-optional-P-7").includes("Skipped") && Number(evalValue("document.querySelectorAll('[data-testid=\"lab-optional\"] tbody tr').length")) === 3, "Optional clients table should list 3 skipped stops.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  open(`${baseURL}/labs/${highId}?${keyed}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes("Optional clients: 3 visited, 0 skipped") && text("lab-prizes-collected") === "1,200" && text("lab-optional-P-6").includes("Visited") && text("lab-uncollected-prizes") === "0", "High-prize run page should show the 3 optional stops visited.");
  assertViewport(1440, 900);

  // Reset forgets the started runs but keeps them stored.
  open(`${baseURL}/learn/optional-visits?${keyed}`);
  browser("wait", "--text", "Open low-prize run", "--timeout", "20000");
  clickButtonCentered("Reset lesson");
  browser("wait", "--text", "Run steps 1 and 2 first", "--timeout", "10000");
  expect(!String(parsedText()).includes("Open low-prize run"), "Reset should forget the started runs.");
  checkBrowserDiagnostics("optional visits run page");
  console.log(`  passed: prize 60 skips 3 stops (nominal ${ao.total} + ${ao.uncollected_prizes} uncollected); prize 400 visits all (nominal ${bo.total}); comparison, run pages and reset`);
}

// Solver Lab client groups (M6): the lesson starts the north-side example and its south-side twin from the page; the
// persisted validated results are what the page compares, and the lab run page's Groups table names the member that
// served the group. Every number is checked against tests/test_lab_examples.py.
async function labGroupsFlow(baseURL, runKey) {
  console.log("Browser smoke: Solver Lab alternative groups lesson");
  beginBrowserFlow("lab-groups");
  browser("errors", "--clear");
  browser("console", "--clear");
  const keyed = `key=${encodeURIComponent(runKey)}`;
  const doneRun = (id, label) => poll(() => fetchOkJson(baseURL, `/api/v1/lab/runs/${id}?${keyed}`, runKey, "x-run-key"), (body) => ["succeeded", "failed", "cancelled"].includes(body?.status), label);
  const labLinks = () => { const raw = evalValue(`JSON.stringify([...document.querySelectorAll('a[href^="/labs/"]')].map((a) => a.getAttribute('href').split('/').pop().split('?')[0]))`); return typeof raw === "string" ? JSON.parse(raw) : raw; };
  open(`${baseURL}/learn/alternative-groups?${keyed}`);
  expect(snapshot().includes('heading "Alternative service groups"'), "Alternative groups lesson did not load.");
  let page = String(parsedText());
  expect(page.includes("Acme, north dock") && page.includes("groups[].members") && page.includes("Not modeled:"), "Lesson is missing its client table or model fields.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  clickButtonCentered("Run with stops in the north");
  browser("wait", "--text", "Open north run", "--timeout", "20000");
  const [northId] = labLinks();
  expect(/^[0-9a-f-]{36}$/.test(northId ?? ""), `North run link is unexpected: ${northId}`);
  const north = await doneRun(northId, "North lab run");
  expect(north.status === "succeeded" && north.example === "groups", `North run did not succeed: ${JSON.stringify(north).slice(0, 800)}`);
  const a = north.result;
  const visits = (r) => r.routes.flatMap((x) => x.visits.map((v) => v.client_id));
  expect(a.validated_feasible && a.solver_feasible && a.violations.length === 0 && a.totals.routes === 1 && a.objective.total === 312 && a.skipped.length === 0 && a.groups.length === 1 && a.groups[0].served_by === "acme-north" && visits(a).length === 5 && !visits(a).includes("acme-south"),
    `North plan should serve Acme at its north dock only, nominal 312: ${JSON.stringify(a.groups)} ${JSON.stringify(a.objective)}`);

  clickButtonCentered("Run with stops in the south");
  browser("wait", "--text", "Open south run", "--timeout", "20000");
  const southId = labLinks().find((id) => id !== northId);
  expect(/^[0-9a-f-]{36}$/.test(southId ?? ""), `South run link is unexpected: ${southId}`);
  const south = await doneRun(southId, "South lab run");
  expect(south.status === "succeeded" && south.example === "groups_south", `South run did not succeed: ${JSON.stringify(south).slice(0, 800)}`);
  const b = south.result;
  expect(b.validated_feasible && b.totals.routes === 1 && b.objective.total === 312 && b.groups[0].served_by === "acme-south" && visits(b).length === 5 && !visits(b).includes("acme-north") && b.problem_fingerprint !== a.problem_fingerprint,
    `South plan should serve Acme at its south dock only: ${JSON.stringify(b.groups)}`);

  // The page's side-by-side comparison reads the same persisted runs.
  browser("wait", "--text", "Side by side", "--timeout", "20000");
  const cell = (key, id) => String(evalValue(`document.querySelector('[data-testid="groups-${key}-${id}"]')?.innerText ?? ""`));
  expect(cell("north", "served") === "acme-north" && cell("south", "served") === "acme-south" && cell("north", "nominal") === "312" && cell("south", "nominal") === "312" && cell("north", "routes") === "1" && cell("north", "visited") === "5 of 6" && cell("north", "distance") === String(a.totals.distance),
    `Comparison cells do not match the persisted results: ${cell("north", "served")} / ${cell("south", "served")}`);
  expect(Number(evalValue("document.querySelectorAll('svg circle[data-skipped]').length")) === 2, "Each plot should draw the unused dock as a dashed circle.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("alternative groups lesson");

  // The run page names the member that served the group.
  open(`${baseURL}/labs/${northId}?${keyed}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes("Alternative groups (at most one member is visited)") && !page.includes("Optional clients:"), "Run page does not show the Groups table (and should not list members as optional clients).");
  const group = String(evalValue("document.querySelector('[data-testid=\"lab-group-acme\"]').innerText"));
  expect(group.includes("exactly one") && group.includes("acme-north, acme-south") && group.includes("acme-north"), `Groups row is unexpected: ${group}`);
  expect(String(evalValue("document.querySelector('[data-testid=\"lab-group-acme\"] td:last-child').innerText")).trim() === "acme-north", "Groups table should name the north dock as the server.");
  expect(Number(evalValue("document.querySelectorAll('svg circle[data-skipped]').length")) === 1 && page.includes("Dashed circles"), "Plot should mark the unused alternative.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  open(`${baseURL}/labs/${southId}?${keyed}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  expect(String(evalValue("document.querySelector('[data-testid=\"lab-group-acme\"] td:last-child').innerText")).trim() === "acme-south", "Groups table should name the south dock as the server.");
  assertViewport(1440, 900);

  // Reset forgets the started runs but keeps them stored.
  open(`${baseURL}/learn/alternative-groups?${keyed}`);
  browser("wait", "--text", "Open north run", "--timeout", "20000");
  clickButtonCentered("Reset lesson");
  browser("wait", "--text", "Run steps 1 and 2 first", "--timeout", "10000");
  expect(!String(parsedText()).includes("Open north run"), "Reset should forget the started runs.");
  checkBrowserDiagnostics("alternative groups run page");
  console.log(`  passed: stops north -> ${a.groups[0].served_by}, stops south -> ${b.groups[0].served_by} (nominal ${a.objective.total} both); comparison, run pages and reset`);
}

// Solver Lab pickup-delivery pairs (M6): the lesson starts the capacity-12 example and its capacity-6 twin from the page;
// the persisted validated results are what the page compares, and the lab run page's Pairs table and load chart show
// which pairs ride together and the load on board. Every number is checked against tests/test_lab_examples.py.
async function labPairsFlow(baseURL, runKey) {
  console.log("Browser smoke: Solver Lab pickup-delivery pairs lesson");
  beginBrowserFlow("lab-pairs");
  browser("errors", "--clear");
  browser("console", "--clear");
  const keyed = `key=${encodeURIComponent(runKey)}`;
  const doneRun = (id, label) => poll(() => fetchOkJson(baseURL, `/api/v1/lab/runs/${id}?${keyed}`, runKey, "x-run-key"), (body) => ["succeeded", "failed", "cancelled"].includes(body?.status), label);
  const labLinks = () => { const raw = evalValue(`JSON.stringify([...document.querySelectorAll('a[href^="/labs/"]')].map((a) => a.getAttribute('href').split('/').pop().split('?')[0]))`); return typeof raw === "string" ? JSON.parse(raw) : raw; };
  open(`${baseURL}/learn/pickup-delivery-pairs?${keyed}`);
  expect(snapshot().includes('heading "Pickup-delivery pairs"'), "Pickup-delivery pairs lesson did not load.");
  let page = String(parsedText());
  expect(page.includes("pick-1") && page.includes("pairs[].amount") && page.includes("Not modeled:") && !/shipments? pair/i.test(page), "Lesson is missing its pairs table or model fields.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  clickButtonCentered("Run with capacity 12");
  browser("wait", "--text", "Open capacity-12 run", "--timeout", "20000");
  const [bigId] = labLinks();
  expect(/^[0-9a-f-]{36}$/.test(bigId ?? ""), `Capacity-12 run link is unexpected: ${bigId}`);
  const big = await doneRun(bigId, "Capacity-12 lab run");
  expect(big.status === "succeeded" && big.example === "pairs", `Capacity-12 run did not succeed: ${JSON.stringify(big).slice(0, 800)}`);
  const a = big.result;
  const order = (r) => r.routes.map((x) => x.visits.filter((v) => v.kind !== "client").map((v) => v.kind[0]).join(""));
  expect(a.validated_feasible && a.solver_feasible && a.violations.length === 0 && a.totals.pairs_total === 6 && a.totals.pairs_served === 6 && a.totals.routes === 3 && a.objective.total === 1226 && a.objective.fixed_cost === 300 && a.totals.distance === 926,
    `Capacity-12 plan should serve 6 pairs on 3 vans, nominal 1226: ${JSON.stringify(a.objective)} ${JSON.stringify(a.totals)}`);
  expect(a.routes.every((r) => r.peak_load.parcels === 12 && r.distance <= 450) && order(a).every((o) => o === "ppdd") && a.pairs.every((p) => p.shared_with.length === 1 && p.pickup_position < p.delivery_position),
    `Every van should carry two pairs at once, pickups first: ${JSON.stringify(order(a))}`);

  clickButtonCentered("Run with capacity 6");
  browser("wait", "--text", "Open capacity-6 run", "--timeout", "20000");
  const smallId = labLinks().find((id) => id !== bigId);
  expect(/^[0-9a-f-]{36}$/.test(smallId ?? ""), `Capacity-6 run link is unexpected: ${smallId}`);
  const small = await doneRun(smallId, "Capacity-6 lab run");
  expect(small.status === "succeeded" && small.example === "pairs_small", `Capacity-6 run did not succeed: ${JSON.stringify(small).slice(0, 800)}`);
  const b = small.result;
  expect(b.validated_feasible && b.totals.pairs_served === 6 && b.totals.routes === 5 && b.objective.total === 2069 && b.totals.distance === 1569 && b.pairs.every((p) => p.shared_with.length === 0) && b.routes.every((r) => r.peak_load.parcels <= 6 && r.distance <= 450) && b.problem_fingerprint !== a.problem_fingerprint,
    `Capacity-6 plan should need 5 vans, nominal 2069: ${JSON.stringify(b.objective)}`);

  // The page's side-by-side comparison reads the same persisted runs.
  browser("wait", "--text", "Side by side", "--timeout", "20000");
  const cell = (key, id) => String(evalValue(`document.querySelector('[data-testid="pairs-${key}-${id}"]')?.innerText ?? ""`));
  expect(cell("big", "served") === "6 of 6" && cell("small", "served") === "6 of 6" && cell("big", "shared") === "6 of 6" && cell("small", "shared") === "0 of 6" && cell("big", "routes") === "3" && cell("small", "routes") === "5" && cell("big", "peak") === "12" && cell("small", "peak") === "6" && cell("big", "nominal") === "1,226" && cell("small", "nominal") === "2,069",
    `Comparison cells do not match the persisted results: ${cell("big", "nominal")} / ${cell("small", "nominal")}`);
  expect(Number(evalValue("document.querySelectorAll('svg polygon[data-kind=\"pickup\"]').length")) === 12 && Number(evalValue("document.querySelectorAll('svg polygon[data-kind=\"delivery\"]').length")) === 12, "Both plots should draw 6 pickup and 6 delivery markers.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("pickup-delivery pairs lesson");

  // The run page: Pairs table, ▲/▼ visits and the load chart reaching capacity at the peak.
  open(`${baseURL}/labs/${bigId}?${keyed}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  page = String(parsedText());
  expect(page.includes("Pickup-delivery pairs (6 of 6 served)") && page.includes("Load on board along each route") && !/shipment/i.test(page), "Run page does not show the Pairs table and load chart (or says shipment).");
  expect(Number(evalValue("document.querySelectorAll('[data-testid=\"lab-pairs\"] tbody tr').length")) === 6 && !String(evalValue("document.querySelector('[data-testid=\"lab-pair-pair-1\"]').innerText")).includes("alone"), "The Pairs table should list 6 pairs, each riding with another.");
  const chart = (r) => evalValue(`JSON.stringify([document.querySelector('[data-testid="lab-profile-${r}-parcels"]')?.dataset.peak, document.querySelector('[data-testid="lab-profile-${r}-parcels"]')?.dataset.capacity])`);
  expect(String(chart(0)).includes('"12","12"') && Number(evalValue("document.querySelectorAll('[data-testid^=\"lab-profile-\"]').length")) === 3, `Load charts should peak at the 12-parcel capacity: ${chart(0)}`);
  expect(Number(evalValue("document.querySelectorAll('svg polygon[data-kind]').length")) === 12 && page.includes("Up triangle: pickup"), "Plot should draw pair stops as triangles.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  open(`${baseURL}/labs/${smallId}?${keyed}`);
  browser("wait", "--text", "Validated feasible", "--timeout", "20000");
  expect(Number(evalValue("document.querySelectorAll('[data-testid^=\"lab-profile-\"]').length")) === 5 && String(evalValue("document.querySelector('[data-testid=\"lab-pair-pair-1\"]').innerText")).includes("alone"), "Capacity-6 run should have 5 route charts and pairs riding alone.");
  assertViewport(1440, 900);

  // Reset forgets the started runs but keeps them stored.
  open(`${baseURL}/learn/pickup-delivery-pairs?${keyed}`);
  browser("wait", "--text", "Open capacity-12 run", "--timeout", "20000");
  clickButtonCentered("Reset lesson");
  browser("wait", "--text", "Run steps 1 and 2 first", "--timeout", "10000");
  expect(!String(parsedText()).includes("Open capacity-12 run"), "Reset should forget the started runs.");
  checkBrowserDiagnostics("pickup-delivery pairs run page");
  console.log(`  passed: capacity 12 -> 3 vans, pairs ride together (nominal ${a.objective.total}); capacity 6 -> 5 vans (nominal ${b.objective.total}); comparison, run pages and reset`);
}

// Saved manual baselines (spec §10, M6): hand-edited plans on the manual routes lesson's run are saved from the Manual
// plan tab (the operator owns them), survive a reload, list with their validity, load back into the editor, and a valid
// one re-runs the scenario warm-started from the saved plan. An invalid one is saved but never offered as a start.
async function baselinesFlow(baseURL, runKey, scenarioKey) {
  console.log("Browser smoke: saved manual baselines");
  beginBrowserFlow("baselines");
  browser("errors", "--clear");
  browser("console", "--clear");
  const access = `?key=${encodeURIComponent(runKey)}`;
  const operator = { "x-scenario-key": scenarioKey };
  const started = await localFetch(new URL("/api/v1/runs", baseURL), { method: "POST", headers: { "content-type": "application/json", "x-run-key": runKey, "idempotency-key": randomUUID() }, body: JSON.stringify({ example: "manual" }) });
  const source = await started.json();
  expect(started.status === 201 && source?.id, `Baseline source run was not queued: ${JSON.stringify(source)}`);
  const run = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${source.id}`, runKey, "x-run-key"), (body) => ["succeeded", "failed"].includes(body?.status), "Baseline source run");
  expect(run.status === "succeeded" && run.summary.totals.trucks === 3, `Baseline source run is unexpected: ${run.status}`);

  // Baselines belong to the operator: without the scenario key they are not readable or saveable, and there is nothing to list.
  const keylessList = await localFetch(new URL(`/api/v1/runs/${source.id}/baselines`, baseURL), { headers: { "x-run-key": runKey } });
  expect(keylessList.status === 403, `A run key alone must not list baselines, got ${keylessList.status}.`);
  const keylessSave = await localFetch(new URL(`/api/v1/runs/${source.id}/baselines`, baseURL), { method: "POST", headers: { "content-type": "application/json", "x-run-key": runKey, "idempotency-key": randomUUID() }, body: JSON.stringify({ name: "x", plan: { cluster_id: "C1", routes: [["a"]] } }) });
  expect(keylessSave.status === 403, `A run key alone must not save baselines, got ${keylessSave.status}.`);

  open(`${baseURL}/runs/${source.id}${access}`);
  browser("eval", `document.cookie = "fillrate_operator=${encodeURIComponent(scenarioKey)}; path=/; SameSite=Lax"`);
  open(`${baseURL}/runs/${source.id}${access}`);
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  browser("find", "role", "tab", "click", "--name", "Manual plan", "--exact");
  browser("wait", "--text", "Saved baselines", "--timeout", "15000");
  browser("wait", '[data-action="move"]', "--timeout", "15000");
  expect(String(parsedText()).includes("No baselines saved on this run yet."), "A fresh run should list no baselines.");

  // 1. A valid hand edit: one stop later in its shipment. Saved with a name; the server evaluates it first.
  browser("focus", 'button:not([disabled])[aria-label^="Move "][aria-label$=" later"]');
  browser("press", "Enter");
  fillCss('input[aria-label="Baseline name"]', "Dispatcher plan");
  clickButtonCentered("Save as baseline");
  browser("wait", "[data-baseline]", "--timeout", "20000");
  let list = (await fetchOkJson(baseURL, `/api/v1/runs/${source.id}/baselines`, scenarioKey)).baselines;
  expect(list.length === 1 && list[0].name === "Dispatcher plan" && list[0].valid === true && list[0].cluster_id === "C1", `Valid baseline was not saved: ${JSON.stringify(list)}`);
  const good = list[0];
  expect(JSON.stringify(good.plan.routes) !== JSON.stringify(run.summary.trucks.map((t) => t.visits.map((v) => v.visit_id))), "The saved plan should differ from the optimized routes.");

  // 2. An invalid plan (a shipment overloaded to 5,600 of 5,300) is saved too, marked invalid.
  browser("find", "role", "button", "click", "--name", "Reset", "--exact");
  const trucks = run.summary.trucks;
  const from = trucks.findIndex((t) => t.visits.some((v) => v.location_id === "MR-04"));
  const to = trucks.findIndex((t, i) => i !== from && t.load === 4000);
  expect(from >= 0 && to >= 0, "Lesson run has no 10-pallet shipment to overload.");
  browser("focus", 'button[aria-label="Move Builder yard to another shipment"]');
  browser("press", "Enter");
  browser("find", "role", "menuitem", "click", "--name", `To Shipment ${to + 1}`, "--exact");
  fillCss('input[aria-label="Baseline name"]', "Overloaded");
  // The first save's toast still sits over the lower right of the page; wait it out rather than click through it.
  await poll(() => evalValue(`!document.body.innerText.includes("Baseline saved")`), (gone) => gone === true, "Save toast dismissal", 20_000);
  clickButtonCentered("Save as baseline");
  await poll(async () => (await fetchOkJson(baseURL, `/api/v1/runs/${source.id}/baselines`, scenarioKey)).baselines, (b) => b.length === 2, "Invalid baseline save", 20_000);
  list = (await fetchOkJson(baseURL, `/api/v1/runs/${source.id}/baselines`, scenarioKey)).baselines;
  const bad = list.find((b) => b.name === "Overloaded");
  expect(bad && bad.valid === false && bad.violations.some((v) => v.code === "over_capacity"), `Invalid baseline should be saved and marked invalid: ${JSON.stringify(bad)}`);
  const detail = await fetchOkJson(baseURL, `/api/v1/baselines/${good.id}`, scenarioKey);
  expect(detail.evaluation.manual.valid === true && detail.evaluation.manual.trucks.length === 3, "A baseline's detail should carry the evaluator's outcome at save time.");

  // 3. Reload: both are listed, labeled, and only the valid one offers the warm rerun.
  open(`${baseURL}/runs/${source.id}${access}`);
  browser("find", "role", "tab", "click", "--name", "Manual plan", "--exact");
  browser("wait", "[data-baseline]", "--timeout", "20000");
  const rows = evalValue(`JSON.stringify([...document.querySelectorAll("[data-baseline]")].map((r) => ({ id: r.dataset.baseline, valid: r.dataset.valid, text: r.innerText, rerun: [...r.querySelectorAll("button")].some((b) => b.innerText.includes("Re-run warm-started from this baseline")) })))`);
  const found = typeof rows === "string" ? JSON.parse(rows) : rows;
  expect(found.length === 2, `Reload should list both baselines: ${JSON.stringify(found)}`);
  const goodRow = found.find((r) => r.id === good.id), badRow = found.find((r) => r.id === bad.id);
  expect(goodRow.valid === "true" && goodRow.text.includes("Dispatcher plan") && goodRow.text.includes("Valid") && goodRow.rerun, `Valid row is wrong: ${JSON.stringify(goodRow)}`);
  expect(badRow.valid === "false" && badRow.text.includes("Overloaded") && badRow.text.includes("Invalid") && badRow.text.includes("Over trailer capacity") && !badRow.rerun, `Invalid row must be labeled and offer no warm start: ${JSON.stringify(badRow)}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  // Load puts the saved plan back in the editor (Reset becomes available: it differs from the optimized routes).
  browser("eval", `document.querySelector('[data-baseline="${good.id}"] button').click()`);
  expect(evalValue(`[...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Reset")?.disabled === false`) === true, "Loading a baseline did not change the editor.");
  browser("find", "role", "button", "click", "--name", "Evaluate", "--exact");
  browser("wait", "--text", "Manual plan valid", "--timeout", "20000");

  // The server refuses to start from the invalid one, and keyless callers get nothing.
  const refuse = await localFetch(new URL("/api/v1/runs", baseURL), { method: "POST", headers: { "content-type": "application/json", ...operator, "idempotency-key": randomUUID() }, body: JSON.stringify({ example: "manual", settings: { warm_start: { kind: "manual_baseline", baseline_id: bad.id } } }) });
  const refused = await refuse.json();
  expect(refuse.status === 409 && refused.error.code === "warm_start_baseline_invalid", `Invalid baseline must not start a run: ${refuse.status} ${JSON.stringify(refused)}`);
  expect((await localFetch(new URL(`/api/v1/baselines/${good.id}`, baseURL), { headers: { "x-run-key": runKey } })).status === 404, "A keyless read of a baseline should be 404.");

  // 4. Warm-start from the valid baseline.
  clickButtonCentered("Re-run warm-started from this baseline");
  const path = await poll(() => evalValue("location.pathname"), (p) => typeof p === "string" && /^\/runs\/[0-9a-f-]+$/i.test(p) && !p.endsWith(source.id), "Baseline warm rerun navigation", 20_000);
  const runId = path.split("/").at(-1);
  const warmRun = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}`, scenarioKey), (body) => ["succeeded", "failed"].includes(body?.status), "Baseline warm-started run");
  expect(warmRun.status === "succeeded", `Warm-started run failed: ${JSON.stringify(warmRun.failure)}`);
  const warm = warmRun.summary.warm_start;
  const outcome = warmRun.summary.clusters.find((c) => c.id === "C1")?.warm_start;
  expect(warmRun.settings.warm_start?.kind === "manual_baseline" && warmRun.settings.warm_start.baseline_id === good.id && warm?.source?.baseline_id === good.id, "Warm-started run does not name the baseline.");
  expect(warm.used === 1 && warm.skipped === 0 && outcome?.status === "used" && outcome.final_cost <= outcome.initial_cost, `The saved plan should start its cluster and never end above its objective: ${JSON.stringify(outcome)}`);
  expect(warmRun.stages.some((s) => s.stage === "warm_start") && warmRun.summary.validity === "valid", "Warm-started run lacks its warm_start stage or validity.");
  browser("wait", "--text", "started from its validated plan", "--timeout", "20000");
  const text = String(parsedText());
  expect(text.includes("From saved manual baseline") && text.includes(good.id.slice(0, 8)) && text.includes("1 of 1 solved cluster started"), "Run page does not show the baseline warm-start panel.");
  expect(evalValue(`document.querySelector('[aria-label="Warm start"]')?.dataset.warmSource`) === "manual_baseline", "Warm start panel does not record its source kind.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  // 5. Delete from the source run's page.
  open(`${baseURL}/runs/${source.id}${access}`);
  browser("find", "role", "tab", "click", "--name", "Manual plan", "--exact");
  browser("wait", "[data-baseline]", "--timeout", "20000");
  browser("find", "role", "button", "click", "--name", "Delete baseline Overloaded", "--exact");
  await poll(async () => (await fetchOkJson(baseURL, `/api/v1/runs/${source.id}/baselines`, scenarioKey)).baselines, (b) => b.length === 1 && b[0].id === good.id, "Baseline deletion", 20_000);
  expect((await localFetch(new URL(`/api/v1/baselines/${bad.id}`, baseURL), { headers: operator })).status === 404, "A deleted baseline should be 404.");
  checkBrowserDiagnostics("saved baselines");
  console.log(`  passed: run ${source.id.slice(0, 8)}: valid and invalid baselines saved, listed after reload, valid one warm-started run ${runId.slice(0, 8)} (1 cluster used), invalid refused, delete`);
}

// Heterogeneous fleet (M6): an operator sets a fleet in the workbench (validation, Basic/Advanced disclosure), runs it, and the
// run page, shipment sheet and manual plan tab show the persisted per-type results measured against each truck's own capacity.
async function fleetFlow(baseURL, scenarioKey) {
  console.log("Browser smoke: heterogeneous fleet");
  beginBrowserFlow("fleet");
  browser("errors", "--clear");
  browser("console", "--clear");
  const author = "Fleet smoke", name = "Fleet browser run";
  // Six stops of 24 ft each: a 26 ft box truck carries one, a 53 ft trailer two.
  const stops = [["A", 35.15, -89.0], ["B", 35.15, -88.5], ["C", 35.6, -89.5], ["D", 34.6, -89.7], ["E", 35.9, -90.2], ["F", 34.9, -90.9]];
  await importInWorkbench(baseURL, scenarioKey, { author, name, inventory: "product,available_pieces\nFL-SKU,100\n", orders: stops.map(([id, lat, lon], i) => `FL-${i + 1},FL-L${i + 1},2026-10-01,Cust ${id},FL-${id},Stop ${id},${lat},${lon},FL-SKU,6,25.00,4.00,1`) });
  openSavedScenario(baseURL, scenarioKey, author, `${name} · v1`);
  fillLabel("Clusters (blank = auto)", "1");
  fillLabel("Time per cluster (seconds)", "2");

  // Fleet section: off by default, then one trailer; Advanced shows ID and rates.
  expect(evalValue(`document.querySelector('[data-testid="fleet-editor"]') === null || document.querySelector('[data-testid="fleet-row"]') === null`) === true, "A scenario should start without a fleet.");
  browser("eval", `[...document.querySelectorAll('summary')].find((s) => s.textContent.trim() === 'Fleet')?.click()`);
  browser("wait", '[data-testid="fleet-enabled"]', "--timeout", "10000");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  browser("eval", `document.querySelector('[data-testid="fleet-enabled"]').scrollIntoView({ block: "center" })`);
  browser("click", '[data-testid="fleet-enabled"]');
  browser("wait", '[data-testid="fleet-row"]', "--timeout", "10000");
  expect(evalValue(`document.querySelectorAll('[data-testid="fleet-row"]').length`) === 1, "Enabling the fleet should add one 53 ft trailer.");
  expect(evalValue(`document.querySelector('[data-testid="fleet-capacity"]').value`) === "53", "The default type should be 53 ft long.");
  // Validation: a zero count is refused with a message, and the run button waits.
  fillCss('[data-testid="fleet-count"]', "0");
  browser("wait", '[data-testid="fleet-problems"]', "--timeout", "10000");
  expect(String(parsedText()).includes("the count is a whole number from 1 to 100,000"), "A zero count should be explained.");
  expect(evalValue(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Review and run saved version').disabled`) === true, "An invalid fleet should disable the run button.");
  fillCss('[data-testid="fleet-count"]', "1");
  browser("wait", "--fn", `document.querySelector('[data-testid="fleet-problems"]') === null`, "--timeout", "10000");
  // A second type: a 26 ft box truck, unlimited. The trailer is limited to one.
  browser("click", '[data-testid="fleet-add"]');
  browser("wait", "--fn", `document.querySelectorAll('[data-testid="fleet-row"]').length === 2`, "--timeout", "10000");
  fillCss('[data-testid="fleet-row"]:nth-child(2) [data-testid="fleet-label"]', "26 ft box truck");
  fillCss('[data-testid="fleet-row"]:nth-child(2) [data-testid="fleet-capacity"]', "26");
  browser("eval", `document.querySelector('[data-testid="fleet-row"]:nth-child(2) summary').click()`);
  browser("wait", '[data-testid="fleet-row"]:nth-child(2) [data-testid="fleet-id"]', "--timeout", "10000");
  fillCss('[data-testid="fleet-row"]:nth-child(2) [data-testid="fleet-id"]', "box-26");
  expect(evalValue(`document.querySelector('[data-testid="fleet-row"]:nth-child(2) [data-testid="fleet-capacity"]').value`) === "26", "The box truck length was not kept.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  clickButtonCentered("Review and run saved version");
  browser("wait", "--url", "**/runs/**", "--timeout", "25000");
  const runId = browser("get", "url").match(/\/runs\/([0-9a-f-]+)/i)?.[1];
  expect(runId, "Fleet run did not open its run page.");

  const detail = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${runId}`, scenarioKey), (body) => ["succeeded", "failed"].includes(body?.status), "Fleet run");
  checkRun(detail, "fleet");
  const summary = detail.summary;
  expect(stable(detail.settings.fleet.map((t) => [t.id, t.count ?? null, t.capacity])) === stable([["trailer-53", 1, 5300], ["box-26", null, 2600]]), `The persisted fleet is not what the workbench set: ${JSON.stringify(detail.settings.fleet)}`);
  const persisted = Object.fromEntries(summary.fleet_usage.map((u) => [u.id, u.trucks]));
  expect(stable(persisted) === stable({ "box-26": 4, "trailer-53": 1 }), `Expected 1 trailer and 4 box trucks: ${JSON.stringify(persisted)}`);
  const capacityOf = Object.fromEntries(detail.settings.fleet.map((t) => [t.id, t.capacity]));
  expect(summary.trucks.every((t) => t.load <= capacityOf[t.vehicle_type_id] && Math.abs(t.fill - t.load / capacityOf[t.vehicle_type_id]) < 1e-12), "A truck exceeds or is measured against the wrong capacity.");

  // The run page renders exactly the persisted per-type results.
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  browser("wait", '[data-testid="fleet-usage"]', "--timeout", "15000");
  for (const [id, trucks] of Object.entries(persisted)) {
    expect(evalValue(`document.querySelector('[data-testid="fleet-usage-${id}"]')?.dataset.trucks`) === String(trucks), `The fleet table shows a different truck count for ${id}.`);
  }
  const usageText = String(evalValue(`document.querySelector('[data-testid="fleet-usage"]').innerText`));
  expect(usageText.includes("1 / 1") && usageText.includes("4 / unlimited"), `The fleet table should show used / available: ${usageText}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);
  browser("find", "role", "tab", "click", "--name", `Shipments (${summary.trucks.length})`, "--exact");
  browser("wait", '[data-testid="shipment-vehicle"]', "--timeout", "15000");
  const shown = evalValue(`JSON.stringify([...document.querySelectorAll('[data-testid="shipment-vehicle"]')].map((c) => c.dataset.vehicle))`);
  expect(stable(JSON.parse(shown)) === stable(summary.trucks.map((t) => t.vehicle_type_id)), `The shipment table's vehicle types differ from the persisted run: ${shown}`);
  expect(String(parsedText()).includes("Fill (own capacity)"), "Fill should be labelled as measured against each truck's own capacity.");
  const box = summary.trucks.find((t) => t.vehicle_type_id === "box-26");
  browser("eval", `document.querySelector('[data-testid="shipment-vehicle"][data-vehicle="box-26"]').closest('tr').querySelector('button[aria-pressed]').click()`);
  browser("wait", '[data-testid="shipment-detail-vehicle"]', "--timeout", "10000");
  expect(String(evalValue(`document.querySelector('[data-testid="shipment-detail-vehicle"]').innerText`)) === "26 ft box truck", "The shipment detail should name its vehicle type.");
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  // The printable sheet names the type and draws the bar against the truck's own capacity.
  open(`${baseURL}/runs/${runId}/sheet?shipment=${encodeURIComponent(box.id)}`);
  browser("wait", '[data-testid="sheet-vehicle"]', "--timeout", "15000");
  const sheet = String(parsedText());
  expect(sheet.includes("26 ft box truck") && sheet.includes(`${Math.round(box.fill * 100)}% of 26 ft`), `Shipment sheet does not show the box truck against 26 ft: ${sheet.slice(0, 400)}`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  setViewport(1440, 900);

  // Manual plan: each shipment keeps its type; the run's own plan is valid; a trailer load typed as a box is refused.
  open(`${baseURL}/runs/${runId}`);
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  browser("find", "role", "tab", "click", "--name", "Manual plan", "--exact");
  browser("wait", '[data-testid="manual-vehicle-type"]', "--timeout", "15000");
  expect(evalValue(`document.querySelectorAll('[data-testid="manual-vehicle-type"]').length`) === summary.trucks.length, "Every manual shipment should offer its vehicle type.");
  clickButtonCentered("Evaluate");
  browser("wait", "--text", "Manual plan valid", "--timeout", "20000");
  const context = await fetchOkJson(baseURL, `/api/v1/runs/${runId}/evaluate?cluster=C1`, scenarioKey);
  expect(stable(context.vehicle_types.map((t) => t.id)) === stable(["trailer-53", "box-26"]) && stable(context.reference_vehicle_types) === stable(summary.trucks.map((t) => t.vehicle_type_id)), "Plan context does not carry the run's fleet and route types.");
  const wrong = context.reference_vehicle_types.map(() => "box-26");
  const refused = await localFetch(new URL(`/api/v1/runs/${runId}/evaluate`, baseURL), { method: "POST", headers: { "content-type": "application/json", "x-scenario-key": scenarioKey }, body: JSON.stringify({ cluster_id: "C1", routes: context.reference_routes, vehicle_types: wrong }) });
  const refusedBody = await refused.json();
  expect(refused.status === 200 && refusedBody.manual.valid === false && refusedBody.manual.violations.some((v) => v.code === "over_capacity"), `A trailer load typed as a box should be over capacity: ${JSON.stringify(refusedBody).slice(0, 400)}`);
  const missing = await localFetch(new URL(`/api/v1/runs/${runId}/evaluate`, baseURL), { method: "POST", headers: { "content-type": "application/json", "x-scenario-key": scenarioKey }, body: JSON.stringify({ cluster_id: "C1", routes: context.reference_routes }) });
  expect(missing.status === 422, `A fleet plan without vehicle types should be refused, got ${missing.status}.`);
  assertViewport(1440, 900);
  assertViewport(393, 852);
  checkBrowserDiagnostics("fleet");
  console.log(`  passed: run ${runId.slice(0, 8)} ${summary.totals.trucks} shipments (1 trailer, 4 box trucks) match the persisted run; invalid fleet blocked; wrong-type plan refused`);
}

// The Valhalla environment the road-geometry flow needs (a live deployment; see docs/valhalla.md). Without it the flow is skipped.
const VALHALLA_ENV = ["VALHALLA_URL", "VALHALLA_VERSION", "VALHALLA_DATASET_REVISION", "VALHALLA_GRAPH_CONFIG_HASH", "VALHALLA_COSTING_OPTIONS"];
const valhallaEnv = () => Object.fromEntries([...VALHALLA_ENV, "VALHALLA_MAX_MATRIX_DISTANCE_M", "VALHALLA_MAX_MATRIX_PAIRS", "VALHALLA_MAX_MATRIX_LOCATIONS", "VALHALLA_MAX_ROUTE_LOCATIONS", "VALHALLA_BLOCK_SIZE"].filter((name) => process.env[name]).map((name) => [name, process.env[name]]));
const valhallaConfigured = () => VALHALLA_ENV.every((name) => process.env[name]?.trim());

// Inspected-route road geometry (spec §4, §7, §10, §13): build a Valhalla snapshot from the browser, run on it, fetch one
// truck's roads, check the labels, legend, timeline cursor and GeoJSON, at desktop and phone sizes. Needs a live Valhalla.
async function roadGeometryFlow(baseURL, scenarioKey, runKey) {
  console.log("Browser smoke: Valhalla road geometry for an inspected truck");
  beginBrowserFlow("road-geometry");
  browser("errors", "--clear");
  browser("console", "--clear");
  const author = "Road geometry smoke", name = "Road geometry TN-MS-AR";
  // Memphis depot (the import default) and six stops in Tennessee, Mississippi and Arkansas.
  const stops = [["RG-NAS", "Nashville", 36.1627, -86.7816], ["RG-JTN", "Jackson TN", 35.6145, -88.8139], ["RG-TUP", "Tupelo", 34.2576, -88.7034],
    ["RG-JMS", "Jackson MS", 32.2988, -90.1848], ["RG-LIT", "Little Rock", 34.7465, -92.2896], ["RG-JON", "Jonesboro", 35.8423, -90.7043]];
  await importInWorkbench(baseURL, scenarioKey, { author, name, inventory: "product,available_pieces\nRG-SKU,1000\n",
    orders: stops.map(([id, label, lat, lon], i) => `RG-${i + 1},RG-L${i + 1},2026-10-01,Cust ${i + 1},${id},${label},${lat},${lon},RG-SKU,10,25.00,1.00,1`) });
  expect(snapshot().includes("Build road matrix (Valhalla)"), "The workbench does not offer a Valhalla matrix build; is the Valhalla environment passed to the server?");
  clickButtonCentered("Build road matrix (Valhalla)");
  await poll(() => evalValue("(document.querySelector('select[aria-label=\"Run travel mode\"]')?.value ?? 'estimated').length > 20"), (built) => built === true, "Valhalla matrix build", 120_000);
  const snapshotId = String(evalValue("document.querySelector('select[aria-label=\"Run travel mode\"]').value"));
  expect(/^[0-9a-f]{64}$/.test(snapshotId), `The built Valhalla matrix was not selected: ${snapshotId}`);
  const runId = runFromWorkbench(10);
  const detailOf = () => fetchOkJson(baseURL, `/api/v1/runs/${runId}`, scenarioKey);
  const detail = await poll(detailOf, (body) => ["succeeded", "failed"].includes(body?.status), "Valhalla-backed run");
  expect(detail.status === "succeeded" && detail.summary.validity === "valid", `Valhalla-backed run did not succeed: ${detail.status} ${JSON.stringify(detail.failure)}`);
  const summary = detail.summary;
  expect(summary.travel?.mode === "snapshot" && summary.travel.provider === "valhalla" && summary.travel.snapshot_id === snapshotId, `Run does not record the Valhalla snapshot: ${JSON.stringify(summary.travel)}`);
  const truck = summary.trucks[0];
  const visits = [...truck.visits].sort((a, b) => a.sequence - b.sequence);
  const geometryUrl = (query = "") => new URL(`/api/v1/runs/${runId}/geometry${query}`, baseURL);
  const owner = { "x-scenario-key": scenarioKey };

  // API: eligible, nothing fetched yet; access follows the run's owner; refusals use the documented codes.
  const status = await fetchOkJson(baseURL, `/api/v1/runs/${runId}/geometry`, scenarioKey);
  expect(status.eligible === true && status.fetched_trucks.length === 0 && status.provider?.version === process.env.VALHALLA_VERSION && status.provider?.dataset_revision === process.env.VALHALLA_DATASET_REVISION, `Geometry status is wrong: ${JSON.stringify(status)}`);
  const unfetched = await localFetch(geometryUrl(`?truck=${encodeURIComponent(truck.id)}`), { headers: owner });
  expect(unfetched.status === 404 && (await unfetched.json()).error?.code === "geometry_not_fetched", "An unfetched truck should answer 404 geometry_not_fetched.");
  const anonymous = await localFetch(geometryUrl(), { method: "POST", headers: { "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ truck: truck.id }) });
  expect(anonymous.status === 404, `An anonymous caller must not reach another owner's run geometry; got ${anonymous.status}.`);
  const keyless = await localFetch(geometryUrl(), { method: "POST", headers: { ...owner, "content-type": "application/json" }, body: JSON.stringify({ truck: truck.id }) });
  expect(keyless.status === 400 && (await keyless.json()).error?.code === "invalid_idempotency_key", "Fetching without an Idempotency-Key should be refused.");

  // Browser: the run page. The Timeline tab shows the control for its selected truck.
  browser("eval", `document.cookie = "fillrate_operator=${encodeURIComponent(scenarioKey)}; path=/; SameSite=Lax"`);
  open(`${baseURL}/runs/${runId}`);
  browser("wait", "--text", "Validated", "--timeout", "30000");
  setViewport(1440, 900);
  browser("find", "role", "tab", "click", "--name", "Timeline", "--exact");
  browser("wait", "--fn", "!!document.querySelector('[data-testid=\"road-geometry-button\"]')", "--timeout", "20000");
  browser("wait", "--fn", "!!document.querySelector('[data-testid=\"route-legend\"]')", "--timeout", "30000");
  let text = String(parsedText());
  expect(text.includes("Schematic straight-line path") && text.includes("Schematic straight line"), `Before fetching, the Timeline should be labeled schematic: ${text.slice(-1500)}`);
  expect(Number(evalValue("document.querySelectorAll('[data-layer=\"valhalla_road\"]').length")) === 0, "No road layer should be listed before geometry is fetched.");
  clickButtonCentered("Show road geometry");
  browser("wait", "--fn", "!!document.querySelector('[data-testid=\"road-geometry-notes\"]')", "--timeout", "30000");
  const dataset = process.env.VALHALLA_DATASET_REVISION;
  const label = `Road geometry (Valhalla truck, ${dataset})`;
  text = String(parsedText());
  expect(text.includes(label), `Road geometry label "${label}" is missing.`);
  expect(text.includes("not proof of what the solver used") && text.includes("optimized on the recorded travel matrix"), "The road-geometry explanation is missing.");
  expect(text.includes("no live traffic or GPS") && text.includes("Simulation along planned leg durations"), "The simulation label is missing.");
  const legend = evalValue("JSON.stringify([...document.querySelectorAll('[data-testid=\"route-legend\"] li')].map((li) => [li.dataset.layer, li.innerText.trim(), li.querySelector('svg line')?.getAttribute('stroke-dasharray') ?? null]))");
  const layers = JSON.parse(typeof legend === "string" ? legend : JSON.stringify(legend));
  expect(layers.length === 1 && layers[0][0] === "valhalla_road" && layers[0][1].includes(label) && layers[0][2] === null, `Legend should list only the solid road layer: ${JSON.stringify(layers)}`);
  expect(evalValue("document.querySelector('[data-testid=\"route-legend\"]').getAttribute('aria-label')") === "Route layers", "The route legend needs an accessible label.");
  const rows = Number(evalValue("document.querySelectorAll('[data-testid=\"road-geometry-legs\"] tbody tr').length"));
  expect(rows === visits.length, `Discrepancy table should list ${visits.length} legs, got ${rows}.`);
  browser("find", "role", "button", "click", "--name", "Hide road geometry", "--exact");
  browser("wait", "--fn", "document.querySelectorAll('[data-layer=\"valhalla_road\"]').length === 0 && !!document.querySelector('[data-layer=\"schematic_straight_line\"]')", "--timeout", "10000");
  clickButtonCentered("Show road geometry");
  browser("wait", "--fn", "document.querySelectorAll('[data-layer=\"valhalla_road\"]').length === 1", "--timeout", "10000");

  // Cursor: it moves along the road line (the drive state reports a road position).
  const stateText = () => String(evalValue("document.querySelector('[data-testid=\"timeline-map-state\"]')?.innerText ?? ''"));
  const markerAt = () => String(evalValue("(() => { const m = document.querySelector('[data-testid=\"timeline-cursor-marker\"]'); const r = m?.getBoundingClientRect(); return r ? Math.round(r.x) + ',' + Math.round(r.y) : ''; })()"));
  browser("find", "role", "button", "click", "--name", "Next stop", "--exact");
  const atStop = markerAt();
  browser("focus", 'input[type="range"]');
  for (let i = 0; i < 4; i++) browser("press", "PageUp");
  browser("wait", "--fn", "(document.querySelector('[data-testid=\"timeline-map-state\"]')?.innerText ?? '').includes('Driving')", "--timeout", "10000");
  expect(stateText().includes("Driving") && stateText().includes("No live traffic or GPS"), `The map should show the driving state and the simulation label: ${stateText()}`);
  expect(markerAt() !== atStop && markerAt() !== "", `The cursor marker did not move along the road (at stop ${atStop}, now ${markerAt()}).`);
  for (const [width, height] of [[1440, 900], [393, 852]]) {
    assertViewport(width, height);
    const box = JSON.parse(String(evalValue("JSON.stringify((() => { const l = document.querySelector('[data-testid=\"route-legend\"]').getBoundingClientRect(); const m = document.querySelector('[data-testid=\"timeline-cursor-marker\"]')?.closest('.maplibregl-map, .relative')?.getBoundingClientRect(); const v = document.documentElement.clientWidth; return { left: l.left, right: l.right, width: v, mapRight: m?.right ?? v }; })())")));
    expect(box.left >= 0 && box.right <= box.width + 1, `Route legend overflows the ${width}px viewport: ${JSON.stringify(box)}`);
    browser("eval", "document.querySelector('[data-testid=\"route-legend\"]')?.scrollIntoView({ block: 'center' })");
  }
  setViewport(1440, 900);

  // API: the cached geometry matches the planned legs, with every discrepancy recorded.
  const geometry = await fetchOkJson(baseURL, `/api/v1/runs/${runId}/geometry?truck=${encodeURIComponent(truck.id)}`, scenarioKey);
  expect(geometry.kind === "valhalla_road" && geometry.snapshot_id === snapshotId && geometry.legs.length === visits.length && geometry.chunks.resequenced === false, "Cached geometry is not this truck's legs in order.");
  expect(geometry.provider.version === process.env.VALHALLA_VERSION && geometry.provider.graph_config_hash === process.env.VALHALLA_GRAPH_CONFIG_HASH && geometry.provider.costing === "truck", "Cached geometry does not record the provider context.");
  const previousIds = ["depot", ...visits.map((v) => v.location_id)];
  geometry.legs.forEach((leg, i) => {
    expect(leg.to_id === visits[i].location_id && leg.status === "ok" && leg.coordinates.length > 2, `Leg ${i} is not the validated stop sequence or has no road line: ${JSON.stringify({ ...leg, coordinates: leg.coordinates?.length })}`);
    expect(leg.matrix_m === visits[i].leg_m && leg.matrix_s === visits[i].leg_s, `Leg ${i} should carry the run's matrix values (${visits[i].leg_m} m, ${visits[i].leg_s} s), not ${leg.matrix_m} m, ${leg.matrix_s} s.`);
    expect(Math.abs(leg.relative_m) < 0.15, `Leg ${i} road length differs from the matrix by ${(leg.relative_m * 100).toFixed(1)}%.`);
  });
  const lastPoint = geometry.legs.at(-1).coordinates.at(-1);
  expect(Math.abs(lastPoint[0] - stops.find((st) => st[0] === visits.at(-1).location_id)[3]) < 0.01, "The last leg must end at the last stop; there is no return leg.");
  console.log(`  legs: ${geometry.legs.map((l, i) => `${previousIds[i]}>${l.to_id} matrix ${(l.matrix_m / 1000).toFixed(1)} km road ${(l.route_m / 1000).toFixed(1)} km (${(l.relative_m * 100).toFixed(1)}%)`).join("; ")}`);
  const again = await localFetch(geometryUrl(), { method: "POST", headers: { ...owner, "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ truck: truck.id }) });
  expect(again.status === 200 && (await again.json()).cached === true, "Fetching an already fetched truck should be served from the cache.");

  // GeoJSON: the default export stays schematic; road geometry is opt-in and labeled.
  const plain = await (await localFetch(new URL(`/api/v1/runs/${runId}/export?format=geojson`, baseURL), { headers: owner })).json();
  expect(plain.fillrate.geometry === "schematic_straight_line" && plain.features.every((f) => f.properties.geometry !== "valhalla_road"), "The default GeoJSON export must stay schematic.");
  const file = join(downloadDir, `fillrate-run-${runId.slice(0, 8)}.geojson`);
  expect(!existsSync(file), "The GeoJSON download should be new.");
  clickButtonCentered("Export");
  clickMenuItem("GeoJSON routes with fetched road geometry");
  await poll(() => existsSync(file), Boolean, "Road GeoJSON download", 15_000);
  const road = JSON.parse(readFileSync(file, "utf8"));
  const roadLegs = road.features.filter((f) => f.properties.role === "route_leg");
  expect(road.fillrate.geometry === "mixed" && roadLegs.length === visits.length && roadLegs.every((f) => f.properties.geometry === "valhalla_road" && f.properties.dataset_revision === dataset && f.properties.graph_config_hash === process.env.VALHALLA_GRAPH_CONFIG_HASH && f.properties.costing === "truck" && String(f.properties.note).includes("do not prove which roads the solver used")), "Road GeoJSON legs are not labeled valhalla_road with provider context.");
  const schematicRoutes = road.features.filter((f) => f.properties.role === "route");
  expect(schematicRoutes.length === summary.trucks.length - 1 && schematicRoutes.every((f) => f.properties.truck_id !== truck.id && f.properties.geometry === "schematic_straight_line") && road.features.filter((f) => f.properties.role === "stop").length === stops.length, "Road GeoJSON should replace the fetched truck's schematic line and keep the stops.");

  // Reload: the fetched truck is remembered server-side, and the Map tab draws road lines with the legend.
  open(`${baseURL}/runs/${runId}`);
  browser("wait", "--text", "Validated", "--timeout", "30000");
  expect((await fetchOkJson(baseURL, `/api/v1/runs/${runId}/geometry`, scenarioKey)).fetched_trucks.join() === truck.id, "The fetched truck should be listed after a reload.");
  browser("find", "role", "tab", "click", "--name", "Map", "--exact");
  browser("wait", "--fn", "!!document.querySelector('[data-testid=\"road-geometry-button\"]')", "--timeout", "20000");
  for (const [width, height] of [[393, 852], [1440, 900]]) assertViewport(width, height);

  // An estimated run has no road geometry, and nothing is fetched for it.
  const started = await localFetch(new URL("/api/v1/runs", baseURL), { method: "POST", headers: { "content-type": "application/json", "x-run-key": runKey, "idempotency-key": randomUUID() }, body: JSON.stringify({ example: "matrix_estimated" }) });
  const estimatedId = (await started.json()).id;
  expect(started.status < 300 && estimatedId, `Could not start the estimated example run: ${started.status}`);
  const estimated = await poll(() => fetchOkJson(baseURL, `/api/v1/runs/${estimatedId}?key=${encodeURIComponent(runKey)}`, runKey, "x-run-key"), (body) => ["succeeded", "failed"].includes(body?.status), "Estimated example run");
  const refused = await localFetch(new URL(`/api/v1/runs/${estimatedId}/geometry?truck=${encodeURIComponent(estimated.summary.trucks[0].id)}`, baseURL), { headers: { "x-run-key": runKey } });
  const refusal = await refused.json();
  expect(refused.status === 409 && refusal.error.code === "geometry_unavailable" && refusal.error.reason === "estimated_travel", `An estimated run must refuse road geometry: ${refused.status} ${JSON.stringify(refusal)}`);
  open(`${baseURL}/runs/${estimatedId}?key=${encodeURIComponent(runKey)}`);
  browser("wait", "--fn", "!!document.querySelector('[data-testid=\"road-geometry-ineligible\"]')", "--timeout", "30000");
  expect(String(parsedText()).includes("No road geometry: this run used estimated travel") && !hasButton("Show road geometry"), "An estimated run page should explain that it has no road geometry and offer no fetch.");
  assertViewport(393, 852);
  assertViewport(1440, 900);
  checkBrowserDiagnostics("road geometry");
  console.log(`  passed: run ${runId.slice(0, 8)} on snapshot ${snapshotId.slice(0, 10)}, ${visits.length} road legs with discrepancies, labels, legend, cursor, GeoJSON; estimated run refused`);
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
  // Valhalla settings reach the web and optimizer processes only for the road-geometry flow (it needs a live deployment).
  const roadGeometrySelected = flows.includes("road-geometry");
  const roadGeometryReady = roadGeometrySelected && valhallaConfigured();
  if (roadGeometrySelected && !roadGeometryReady) console.log(`Browser smoke: road geometry SKIPPED. Set ${VALHALLA_ENV.join(", ")} (and optionally VALHALLA_MAX_ROUTE_LOCATIONS) to a live Valhalla deployment to run it.`);
  if (roadGeometryReady) Object.assign(commonEnv, valhallaEnv());
  const web = launch(process.execPath, [join(standaloneAppDir, "server.js")], { cwd: standaloneAppDir, env: { ...commonEnv, PORT: String(webPort), HOSTNAME: "127.0.0.1" } });
  const baseURL = `http://127.0.0.1:${webPort}`;
  smokeBaseURL = baseURL;
  smokeOperatorKey = scenarioKey;
  await waitForWeb(`${baseURL}/learn/fulfillment-pipeline?key=${encodeURIComponent(runKey)}`, web);
  // The optimizer as the container runs it: FastAPI on loopback (manual plan evaluation) with the worker supervisor.
  launch("uv", ["run", "--locked", "fillrate-optimizer"], {
    cwd: optimizerDir,
    env: { ...commonEnv, UV_PYTHON: process.env.UV_PYTHON ?? "3.13", FILLRATE_WORKER: "1", OPTIMIZER_PORT: String(optimizerPort), FILLRATE_INTERNAL_URL: `http://127.0.0.1:${internalPort}`, WORKER_ID: `browser-smoke-${process.pid}`, WORKER_POLL_SECONDS: "0.2" },
  });
  for (const flow of flows) {
    if (flow === "lesson") await lessonFlow(baseURL, runKey);
    if (flow === "import") await importFlow(baseURL, scenarioKey);
    if (flow === "matrix") await matrixFlow(baseURL, scenarioKey);
    if (flow === "experiment") await experimentFlow(baseURL, runKey);
    if (flow === "lessons") await lessonsFlow(baseURL, runKey);
    if (flow === "time-windows") await timeWindowsFlow(baseURL, scenarioKey);
    if (flow === "road-matrices") await roadMatricesFlow(baseURL, runKey);
    if (flow === "manual-plan") await manualPlanFlow(baseURL, runKey);
    if (flow === "cancel") await cancelFlow(baseURL, scenarioKey);
    if (flow === "edit") await editFlow(baseURL, scenarioKey);
    if (flow === "labs") await labsFlow(baseURL, runKey, scenarioKey);
    if (flow === "warm-start") await warmStartFlow(baseURL, runKey);
    if (flow === "lab-lessons") await labLessonsFlow(baseURL, runKey);
    if (flow === "lab-depots") await labDepotsFlow(baseURL, runKey);
    if (flow === "lab-reloads") await labReloadsFlow(baseURL, runKey);
    if (flow === "lab-prizes") await labPrizesFlow(baseURL, runKey);
    if (flow === "lab-groups") await labGroupsFlow(baseURL, runKey);
    if (flow === "lab-pairs") await labPairsFlow(baseURL, runKey);
    if (flow === "baselines") await baselinesFlow(baseURL, runKey, scenarioKey);
    if (flow === "fleet") await fleetFlow(baseURL, scenarioKey);
    if (flow === "road-geometry" && roadGeometryReady) await roadGeometryFlow(baseURL, scenarioKey, runKey);
  }
  await stop();
} catch (error) {
  console.error(redact(error instanceof Error ? error.stack : error));
  await stop();
  process.exitCode = 1;
}
