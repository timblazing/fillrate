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
const flows = selected === "all" ? ["lesson", "import", "matrix", "experiment"] : [selected];
if (flows.some((flow) => !["lesson", "import", "matrix", "experiment"].includes(flow))) throw new Error("Use --flow=lesson, --flow=import, --flow=matrix, --flow=experiment, or --flow=all.");

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
  const response = await fetch(new URL(path, baseURL), { method: "POST", headers: { "content-type": "application/json", "x-scenario-key": key, "idempotency-key": randomUUID() }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
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
      expect(visit.leg_m !== meters[to][from], `Leg ${previous} -> ${visit.location_id} equals the reverse direction.`);
      expect(visit.leg_m !== Math.round(haversineM(nodes[from], nodes[to]) * 1.2), "Leg equals the haversine estimate instead of the matrix.");
      checked += 1; previous = visit.location_id;
    }
  }
  expect(checked >= 3, `Expected every stop leg to be checked; checked ${checked}.`);
  // Exports: schematic GeoJSON without the synthetic return, and the imported matrix with its node binding.
  const exportGet = (query, key = scenarioKey) => fetch(new URL(`/api/v1/runs/${runId}/export?${query}`, baseURL), { headers: key ? { "x-scenario-key": key } : {}, signal: AbortSignal.timeout(15_000) });
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
  const keyless = await fetch(new URL(`/api/v1/travel-snapshots/${snapshotId}?format=csv`, baseURL), { signal: AbortSignal.timeout(8_000) });
  expect(keyless.status >= 400, "Keyless snapshot download must be refused.");
  const snapshotJson = await (await fetch(new URL(`/api/v1/travel-snapshots/${snapshotId}?format=json`, baseURL), { headers: { "x-scenario-key": scenarioKey }, signal: AbortSignal.timeout(15_000) })).text();
  expect(createHash("sha256").update(snapshotJson).digest("hex") === snapshotId, "Downloaded snapshot JSON must hash to its identity.");
  browser("wait", "--text", "Validated, complete", "--timeout", "20000");
  assertViewport(1440, 900);
  assertViewport(393, 852);

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
    if (flow === "matrix") await matrixFlow(baseURL, scenarioKey);
    if (flow === "experiment") await experimentFlow(baseURL, runKey);
  }
  await stop();
} catch (error) {
  console.error(redact(error instanceof Error ? error.stack : error));
  await stop();
  process.exitCode = 1;
}
