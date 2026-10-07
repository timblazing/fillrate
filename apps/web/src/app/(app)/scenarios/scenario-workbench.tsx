"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import type { RunSettings, ScenarioDocument } from "@fillrate/contracts"
import type { GeocodeCapabilities, GeocodeJob, GeocodeOptions } from "@fillrate/db/geocode"
import type { CsvImportInput, CsvImportPreview, ImportFormat, OrderColumn, InventoryColumn } from "@fillrate/db/imports"
import { reviewScenario } from "@fillrate/db/review"
import { ChevronDownIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardPanel, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Field as FieldRoot, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { SweepBuilder } from "../experiments/sweep-builder"
import { USE_K_KEY } from "../explore/explorer-view"
import { CoordinateReview, DataReviewPanel, GeocodePanel } from "./data-review"
import { fleetProblems } from "@fillrate/db/fleet"
import { FleetEditor } from "./fleet-editor"
import { TravelMatrixPanel } from "./travel-matrix-panel"

const orderColumns: OrderColumn[] = ["order_id", "line_id", "order_date", "customer_id", "location_id", "location_label", "address", "latitude", "longitude", "product", "ordered_pieces", "net_value_per_piece", "linear_feet_per_piece", "priority"]
const inventoryColumns: InventoryColumn[] = ["product", "available_pieces"]
const templates = { orders: `${orderColumns.join(",")}\nO-1,L-1,2026-09-30,ACME,C-1,Customer 1,,35.1,-90.1,SKU-1,10,12.50,1.25,1\nO-2,L-2,2026-09-30,Beta,C-2,Beta Yard,"125 N Main St, Memphis, TN 38103",,,SKU-1,4,12.50,1.25,1\n`, inventory: "product,available_pieces\nSKU-1,100\n" }
// GeoJSON points use the CSV column names as properties; geometry is [longitude, latitude] or null for address-only stops.
const geojsonTemplate = JSON.stringify({ type: "FeatureCollection", features: [
  { type: "Feature", geometry: { type: "Point", coordinates: [-90.1, 35.1] }, properties: { order_id: "O-1", line_id: "L-1", order_date: "2026-09-30", customer_id: "ACME", location_id: "C-1", location_label: "Customer 1", product: "SKU-1", ordered_pieces: 10, net_value_per_piece: "12.50", linear_feet_per_piece: "1.25", priority: 1 } },
  { type: "Feature", geometry: null, properties: { order_id: "O-2", line_id: "L-2", order_date: "2026-09-30", customer_id: "Beta", location_id: "C-2", location_label: "Beta Yard", address: "125 N Main St, Memphis, TN 38103", product: "SKU-1", ordered_pieces: 4, net_value_per_piece: "12.50", linear_feet_per_piece: "1.25", priority: 1 } },
] }, null, 1)
const formats: [ImportFormat, string][] = [["csv", "CSV"], ["geojson", "GeoJSON points"], ["json", "Scenario JSON"]]
type Location = ScenarioDocument["locations"][number]
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
/** A correction keeps the location's first non-manual coordinate and its provenance (spec §6). */
function correct(loc: Location, next: Pick<Location, "lat" | "lon" | "coordinate_source" | "geocode">) {
  if (!loc.original && loc.coordinate_source !== "unresolved" && loc.coordinate_source !== "manual") loc.original = { lat: loc.lat, lon: loc.lon, coordinate_source: loc.coordinate_source, geocode: loc.geocode ?? null }
  Object.assign(loc, next)
}
type ScenarioRunSettings = Omit<RunSettings, "objective"> & { objective: "trucks_then_distance" | "weighted_distance" | "cost"; preflight: { missing_coordinates: "block" | "warn"; far_from_depot: "block" | "warn"; oversize_stop: "block" | "warn"; approximate_coordinates: "block" | "warn" }; excluded_line_ids: string[]; cost_per_truck_cents: number | null; cost_per_mile_cents: number | null }
const defaults: ScenarioRunSettings = { schema_version: 1, trailer_capacity: 5300, travel_circuity: 1.2, travel_snapshot_id: null, cluster_circuity: 1.2, max_leg_m: 804672, max_cluster_diameter_m: null, cluster_strategy: "kmeans", h3_resolution: 2, inventory_percent: 100, k: null, auto_k_cap: 25, kmeans_seed: 0, kmeans_n_init: 10, max_stops: 500, solver_seed: 0, solver_max_iterations: null, solver_time_limit_s: 10, objective: "trucks_then_distance", weighted_truck_penalty_m: null, preflight: { missing_coordinates: "block", far_from_depot: "block", oversize_stop: "warn", approximate_coordinates: "warn" }, excluded_line_ids: [], cost_per_truck_cents: null, cost_per_mile_cents: null, allocation_strategy: "order_date_then_value", fulfillment_policy: "piece", allocation_objective: "revenue", respect_order_date: false, allocation_time_limit_s: 10 }
type Saved = { id: string; scenarioId: string; revision: number; parentVersionId: string | null; author: string; document: ScenarioDocument; source: unknown }
type Listed = { id: string; name: string; revision: number; author: string; versionId: string; branchedFrom: string | null }
type PreflightFinding = { check: "missing_coordinates" | "far_from_depot" | "oversize_stop" | "far_via_stop" | "approximate_coordinates"; action: "block" | "warn"; location_ids: string[]; line_ids: string[]; message: string }
function Field({ label, children }: { label: string; children: ReactNode }) { return <FieldRoot className="min-w-0 items-stretch gap-1.5"><FieldLabel>{label}</FieldLabel>{children}</FieldRoot> }
/** A labelled coss Select over a fixed list of options. */
function Pick<T extends string>({ label, value, items, onChange }: { label: string; value: T; items: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <Field label={label}><Select value={value} items={items} onValueChange={next => { if (next !== null) onChange(next as T) }}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectPopup>{items.map(item => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectPopup></Select></Field>
}
/** A titled Card section; the heading stays an h2. */
function Section({ title, description, action, children, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return <Card className={className}><CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 flex-col gap-1"><CardTitle render={<h2 />}>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>{action}</CardHeader><CardPanel className="flex flex-col items-start gap-4 [&>*:not(button)]:self-stretch">{children}</CardPanel></Card>
}
const preflightItems = [{ value: "block" as const, label: "Block run" }, { value: "warn" as const, label: "Warn only" }]
const strategyItems = [{ value: "kmeans" as const, label: "k-means (default)" }, { value: "h3" as const, label: "H3 cells (deterministic baseline)" }, { value: "none" as const, label: "No clustering (baseline; needs every stop in one solve)" }]
const objectiveItems = [{ value: "trucks_then_distance" as const, label: "Fewest trucks, then miles" }, { value: "weighted_distance" as const, label: "Fewest miles with truck penalty" }, { value: "cost" as const, label: "Lowest cost" }]
const allocationItems = [{ value: "order_date_then_value" as const, label: "Order date, then value (default)" }, { value: "first_come" as const, label: "First come" }, { value: "priority" as const, label: "Priority, then order date" }, { value: "proportional" as const, label: "Fair share (heuristic)" }, { value: "optimized" as const, label: "Optimized revenue (CP-SAT)" }]
const fulfillmentItems = [{ value: "piece" as const, label: "Partial lines allowed (default)" }, { value: "whole_order" as const, label: "Whole orders only" }]
const optimizedItems = [{ value: "revenue:false", label: "Most revenue" }, { value: "revenue:true", label: "Most revenue, older orders first" }, { value: "priority_then_revenue:false", label: "Priority, then revenue" }, { value: "priority_then_revenue:true", label: "Priority, then revenue, older orders first" }]
function download(name: string, content: string, type = "text/csv") { const url = URL.createObjectURL(new Blob([content], { type })); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url) }
function decimal(raw: string) { if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error("Use at most two decimal places."); const [whole, fraction = ""] = raw.split("."); const n = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0")); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Value is too large."); return Number(n) }
/** A file picker and a paste box for one import text. */
function TextSource({ label, accept, value, limit, onRead, onError }: { label: string; accept: string; value: string; limit: number; onRead: (text: string) => void; onError: (message: string) => void }) {
  return <>
    <Input aria-label={`${label} file`} type="file" accept={accept} onChange={async e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > limit) { onError(`${label} exceeds ${limit / 1_000_000} MB.`); return } onRead(await file.text()) }} />
    <Textarea aria-label={`${label} content`} className="[&_textarea]:field-sizing-fixed [&_textarea]:min-h-32 [&_textarea]:font-mono [&_textarea]:text-xs" placeholder={`Paste ${label} here`} value={value} onChange={e => onRead(e.target.value)} />
  </>
}
function EditCell({ label, value, onCommit }: { label: string; value: string | number; onCommit: (value: string) => void }) {
  return <Input key={String(value)} aria-label={label} className="min-w-24" defaultValue={value} onBlur={e => onCommit(e.target.value)} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur() }} />
}
/** How this server grants scenario access: an account (hosted), nothing (local) or the operator key. */
export type WorkbenchAccess = { mode: "hosted" | "local" | "operator"; account: string | null }

export function ScenarioWorkbench({ access }: { access: WorkbenchAccess }) {
  const usesKey = access.mode === "operator";
  const router = useRouter();
  const [key, setKey] = useState(""); const [author, setAuthor] = useState(""); const [browserId, setBrowserId] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago"); const [planningDate, setPlanningDate] = useState("");
  const [list, setList] = useState<Listed[]>([]); const [saved, setSaved] = useState<Saved | null>(null); const [doc, setDoc] = useState<ScenarioDocument | null>(null);
  const [dirty, setDirty] = useState(false); const [conflict, setConflict] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [input, setInput] = useState<CsvImportInput>({ name: "New scenario", depot: { id: "depot", label: "Depot", lat: 35.1495, lon: -90.049 }, ordersCsv: "", inventoryCsv: "" });
  const [preview, setPreview] = useState<CsvImportPreview | null>(null); const [tab, setTab] = useState("orders"); const [page, setPage] = useState(0);
  const [settings, setSettings] = useState<ScenarioRunSettings>(defaults);
  const [findings, setFindings] = useState<PreflightFinding[]>([]); const [sweeping, setSweeping] = useState(false);
  const pendingSave = useRef<{ request: string; key: string } | null>(null);
  const [capabilities, setCapabilities] = useState<GeocodeCapabilities | null>(null); const [geocodeJob, setGeocodeJob] = useState<GeocodeJob | null>(null);
  const [undo, setUndo] = useState<{ label: string; doc: ScenarioDocument }[]>([]);
  // "Open scenario" from a failed, cancelled or interrupted run: ?scenario=&version=&run= opens that version with the run's settings.
  const [opening, setOpening] = useState<{ scenario: string; version: string; run: string | null } | null>(null); const opened = useRef(false);
  useEffect(() => { fetch("/api/v1/geocode", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(setCapabilities, () => setCapabilities(null)) }, []);
  // Poll a geocoding job; when it finishes, open the version it saved.
  useEffect(() => {
    if (!geocodeJob || (geocodeJob.status !== "queued" && geocodeJob.status !== "running")) return;
    const timer = window.setTimeout(async () => {
      try {
        const next = await api<GeocodeJob>(`/api/v1/geocode/jobs/${geocodeJob.id}`); setGeocodeJob(next);
        if (next.status === "succeeded" && next.resultScenarioId && next.resultVersionId) { await load(next.resultScenarioId, next.resultVersionId, true); setMessage(next.branched ? "Addresses resolved and saved as a branch (the scenario changed meanwhile)." : "Addresses resolved and saved as a new version.") }
      } catch (e) { setMessage(e instanceof Error ? e.message : "Could not read the geocoding job.") }
    }, 1500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geocodeJob]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setKey(sessionStorage.getItem("fillrate.scenario-key") ?? ""); setAuthor(localStorage.getItem("fillrate.author.v1") ?? "");
      const id = localStorage.getItem("fillrate.browser.v1") ?? crypto.randomUUID(); localStorage.setItem("fillrate.browser.v1", id); setBrowserId(id);
      // "Use this k" from an imported k explorer carries k and seed here (spec §8a, design review item 12).
      const picked = localStorage.getItem(USE_K_KEY); if (picked) { localStorage.removeItem(USE_K_KEY); const { k, seed } = JSON.parse(picked) as { k: number; seed: number }; setSettings(previous => ({ ...previous, cluster_strategy: "kmeans", k, kmeans_seed: seed })); setMessage(`Run settings: k = ${k}, k-means seed ${seed} from the k explorer. Load the scenario and run.`) }
      const query = new URLSearchParams(window.location.search); const scenario = query.get("scenario"), version = query.get("version");
      if (scenario && version) setOpening({ scenario, version, run: query.get("run") });
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone); const now = new Date(); setPlanningDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);
  useEffect(() => {
    if (!opening || opened.current || (usesKey && !key)) return;
    opened.current = true; const { scenario, version, run } = opening;
    void action(async () => {
      await load(scenario, version);
      if (!run) return;
      const detail = await api<{ settings: RunSettings & { warm_start?: unknown } }>(`/api/v1/runs/${run}`);
      const rest = { ...detail.settings }; delete rest.warm_start;
      setSettings({ ...defaults, ...(rest as Partial<ScenarioRunSettings>) });
      setMessage(`Opened the version and settings of run ${run.slice(0, 8)}. Fix the flagged data or settings, save, then run again.`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening, key]);
  async function api<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const response = await fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(usesKey ? { "x-scenario-key": key } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const data = await response.json(); if (!response.ok) { if (data.error?.code === "version_conflict") setConflict(true); throw new Error(data.error?.message ?? data.message ?? JSON.stringify(data)); } return data;
  }
  async function saveRequest(path: string, body: unknown) {
    const request = `${path}:${JSON.stringify(body)}`;
    if (pendingSave.current?.request !== request) pendingSave.current = { request, key: crypto.randomUUID() };
    return api<{ scenarioId: string; versionId: string }>(path, body, { "Idempotency-Key": pendingSave.current.key });
  }
  async function action(fn: () => Promise<void>) { setBusy(true); setMessage(""); try { await fn() } catch (e) { setMessage(e instanceof Error ? e.message : "Request failed.") } finally { setBusy(false) } }
  async function load(id: string, version?: string, keepJob = false) { const row = await api<Saved>(`/api/v1/scenarios/${id}${version ? `?version=${version}` : ""}`); setSaved(row); setDoc(row.document); setDirty(false); setConflict(false); setPage(0); setPreview(null); setFindings([]); setUndo([]); if (!keepJob) setGeocodeJob(null) }
  const metadata = { timezone, planningDate, browserId };
  const format = input.format ?? "csv";
  const importReady = format === "json" ? !!input.scenarioJson : !!(format === "geojson" ? input.ordersGeojson : input.ordersCsv) && !!input.inventoryCsv;
  const review = useMemo(() => doc ? reviewScenario(doc) : null, [doc]);
  function changeInput(patch: Partial<CsvImportInput>) { setInput(previous => ({ ...previous, ...patch })); setPreview(null) }
  function changeDocument(fn: (draft: ScenarioDocument) => void) { if (!doc) return; const draft = structuredClone(doc); try { fn(draft); setDoc(draft); setDirty(true); setFindings([]) } catch (e) { setMessage((e as Error).message) } }
  /** Coordinate edits keep an undo stack of whole documents (at most 50 steps). */
  function editLocation(id: string, label: string, fn: (loc: Location) => void) {
    if (!doc) return; const draft = structuredClone(doc); const loc = draft.locations.find(l => l.id === id); if (!loc) return;
    fn(loc); setUndo(previous => [...previous.slice(-49), { label: `${label} ${loc.label}`, doc }]); setDoc(draft); setDirty(true); setFindings([]);
  }
  function undoEdit() { const last = undo[undo.length - 1]; if (!last) return; setDoc(last.doc); setUndo(undo.slice(0, -1)); setDirty(true); setFindings([]); setMessage(`Undid: ${last.label}.`) }
  async function findAddress(id: string, address: string) {
    const found = await api<Pick<Location, "lat" | "lon" | "coordinate_source" | "geocode"> & { status?: string }>("/api/v1/geocode/address", { address, fallback: capabilities?.zcta ? "zcta" : "off" });
    if (found.lat === null || found.lon === null) { setMessage(`No match for ${address}${found.status ? ` (${found.status.replace("_", " ")})` : ""}. Place it on the map instead.`); return }
    editLocation(id, "found", loc => correct(loc, found)); setMessage(found.coordinate_source === "zcta" ? "Placed at the ZIP code's ZCTA internal point (approximate)." : "Placed at the Census match.");
  }
  async function startGeocode(options: GeocodeOptions) { if (!saved) return; setGeocodeJob(await api<GeocodeJob>("/api/v1/geocode/jobs", { versionId: saved.id, options, author, metadata }, { "Idempotency-Key": crypto.randomUUID() })) }
  async function save(branch = false) { if (!doc || !saved) return; const half = doc.locations.find(l => (l.lat === null) !== (l.lon === null)); if (half) throw new Error(`${half.label} has only one coordinate. Enter both or clear both.`); const ids = await saveRequest(`/api/v1/scenarios/${saved.scenarioId}`, { document: doc, author, metadata, source: saved.source, expectedVersionId: saved.id, branch }); await load(ids.scenarioId, ids.versionId); pendingSave.current = null; setMessage(branch ? "Branch saved." : "Version saved.") }
  const lines = useMemo(() => doc?.orders.flatMap((order, oi) => order.lines.map((line, li) => ({ order, line, oi, li }))) ?? [], [doc]);
  const count = tab === "orders" ? lines.length : tab === "inventory" ? doc?.inventory.length ?? 0 : doc?.locations.length ?? 0;
  const updateSetting = (name: keyof ScenarioRunSettings, value: number | null) => { setSettings(previous => ({ ...previous, [name]: value })); setFindings([]) };
  async function preflight(candidate = settings) { if (!saved) return []; const result = await api<{ findings: PreflightFinding[] }>("/api/v1/scenarios/preflight", { versionId: saved.id, settings: candidate }); setFindings(result.findings); return result.findings }
  async function submit(candidate: ScenarioRunSettings) { if (!saved) return; try { const run = await api<{ id: string }>("/api/v1/scenarios/runs", { versionId: saved.id, settings: candidate }, { "Idempotency-Key": crypto.randomUUID() }); router.push(`/runs/${run.id}`) } catch (error) { await preflight(candidate); throw error } }
  async function reviewAndRun(candidate = settings) { const checked = await preflight(candidate); if (checked.some(finding => finding.action === "block")) { setMessage("Resolve the blocking checks, exclude their lines, or change their policy to warn before running."); return } await submit(candidate) }
  return <div className="space-y-6">
    <Section title="Workspace access & authorship" description={<>{access.mode === "hosted" ? `Signed in as ${access.account}. Your scenarios, runs and results are private to your account.` : access.mode === "local" ? "Local mode: one account-free dataset stored on this machine." : "Production uses a shared operator key."} Your display name records authorship; it does not grant access.</>}><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {usesKey && <Field label="Operator key"><Input type="password" autoComplete="off" value={key} onChange={e => { setKey(e.target.value); sessionStorage.setItem("fillrate.scenario-key", e.target.value) }} /></Field>}
      <Field label="Display name"><Input value={author} onChange={e => { setAuthor(e.target.value); localStorage.setItem("fillrate.author.v1", e.target.value) }} /></Field>
      <Field label="Planning date"><Input type="date" value={planningDate} onChange={e => setPlanningDate(e.target.value)} /></Field><Field label="Timezone"><Input value={timezone} onChange={e => setTimezone(e.target.value)} /></Field>
    </div><Button disabled={busy} variant="outline" onClick={() => action(async () => setList((await api<{scenarios: Listed[]}>("/api/v1/scenarios")).scenarios))}>Load scenarios</Button>
      {list.length > 0 && <div className="flex flex-col items-start gap-2" aria-label="Saved scenarios">{list.map(row => <Button variant="outline" key={row.id} className="h-auto min-h-9 max-w-full justify-start whitespace-normal py-1.5 text-left sm:h-auto sm:min-h-8" disabled={busy || dirty} onClick={() => action(() => load(row.id))}>{row.name} · v{row.revision}{row.branchedFrom ? ` · branch of ${row.branchedFrom.slice(0, 8)}` : ""}</Button>)}</div>}
    </Section>
    <Section title="Import" action={<ToggleGroup aria-label="Import format" variant="outline" size="sm" className="flex-wrap" value={[format]} onValueChange={next => { if (next[0]) changeInput({ format: next[0] as ImportFormat }) }}>{formats.map(([value, label]) => <ToggleGroupItem key={value} value={value}>{label}</ToggleGroupItem>)}</ToggleGroup>}>
      <p className="text-sm text-muted-foreground">
        {format === "json" ? "A scenario JSON file, as written by Export JSON. Its name, depot, orders, stock and coordinate provenance are used as they are." : format === "geojson" ? "A GeoJSON FeatureCollection of points. Each feature's properties use the order-line CSV column names; the Point geometry ([longitude, latitude]) gives the coordinates, or use a null geometry and an address property. Stock is a CSV." : "Order lines and stock as CSV. Dollars and feet accept up to two decimals; quantities are whole pieces."}
        {" "}Preview is non-destructive. Addresses without coordinates are kept and can be resolved after saving (Census, then the ZIP fallback). A ZIP code and a Census ZCTA are different: the ZCTA only approximates the ZIP&apos;s area.
      </p>
      {format !== "json" && <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Field label="Scenario name"><Input value={input.name} onChange={e => changeInput({ name: e.target.value })} /></Field><Field label="Depot label"><Input value={input.depot.label} onChange={e => changeInput({ depot: { ...input.depot, label: e.target.value } })} /></Field><Field label="Depot latitude"><Input type="number" step="any" value={input.depot.lat} onChange={e => changeInput({ depot: { ...input.depot, lat: Number(e.target.value) } })} /></Field><Field label="Depot longitude"><Input type="number" step="any" value={input.depot.lon} onChange={e => changeInput({ depot: { ...input.depot, lon: Number(e.target.value) } })} /></Field></div>}
      {format === "json"
        ? <TextSource label="Scenario JSON" accept=".json,application/json" value={input.scenarioJson ?? ""} limit={10_000_000} onRead={text => changeInput({ scenarioJson: text })} onError={setMessage} />
        : <div className="grid gap-4 lg:grid-cols-2">{(["orders", "inventory"] as const).map(kind => {
          const geo = kind === "orders" && format === "geojson";
          const field = geo ? "ordersGeojson" : kind === "orders" ? "ordersCsv" : "inventoryCsv";
          return <div className="min-w-0 space-y-3" key={kind}>
            <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{kind === "orders" ? (geo ? "Order lines (GeoJSON)" : "Order lines") : "Inventory"}</h3><Button variant="ghost" onClick={() => geo ? download("orders-template.geojson", geojsonTemplate, "application/geo+json") : download(`${kind}-template.csv`, templates[kind])}>Download template</Button></div>
            <TextSource label={geo ? "orders GeoJSON" : `${kind} CSV`} accept={geo ? ".geojson,.json,application/geo+json,application/json" : ".csv,text/csv"} value={input[field] ?? ""} limit={5_000_000} onRead={text => changeInput({ [field]: text })} onError={setMessage} />
            {!geo && <Collapsible><CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">Column mapping<ChevronDownIcon className="size-4 transition-transform group-data-[panel-open]:rotate-180" aria-hidden /></CollapsibleTrigger><CollapsiblePanel><div className="grid p-1 pt-3 gap-2 sm:grid-cols-2">{(kind === "orders" ? orderColumns : inventoryColumns).map(column => <Field key={column} label={column.replaceAll("_", " ")}><Input placeholder={column} value={(kind === "orders" ? input.orderMapping : input.inventoryMapping)?.[column as never] ?? ""} onChange={e => changeInput(kind === "orders" ? { orderMapping: { ...input.orderMapping, [column]: e.target.value || undefined } } : { inventoryMapping: { ...input.inventoryMapping, [column]: e.target.value || undefined } })} /></Field>)}</div></CollapsiblePanel></Collapsible>}
          </div> })}</div>}
      <Button disabled={busy || !importReady} onClick={() => action(async () => setPreview(await api<CsvImportPreview>("/api/v1/imports/preview", input)))}>Preview import</Button>
      {preview && <div className="space-y-3"><p className="font-medium">{preview.valid ? `${preview.document?.name}: ${preview.document?.orders.length} orders ready to save` : `${preview.errors.length} import errors`}</p>
        {[...preview.errors, ...preview.warnings].slice(0, 50).map((item, i) => <p className="text-sm" key={i}>{item.file === "scenario" ? "Scenario" : `${item.file} ${preview.format === "geojson" && item.file === "orders" ? "feature" : "row"} ${item.row}`}{item.column ? `, ${item.column}` : ""}: {item.message}</p>)}
        {preview.review && <DataReviewPanel review={preview.review} />}
        {Object.entries(preview.samples).map(([kind, rows]) => rows.length > 0 && <div key={kind} className="overflow-x-auto"><h3 className="text-sm font-medium">{kind} sample</h3><Table><TableHeader><TableRow>{Object.keys(rows[0] ?? {}).map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, i) => <TableRow key={i}>{Object.entries(row).map(([h, value]) => <TableCell key={h}>{value}</TableCell>)}</TableRow>)}</TableBody></Table></div>)}
        <Button disabled={busy || !preview.valid || !author.trim() || dirty} onClick={() => action(async () => { const ids = await saveRequest("/api/v1/imports/commit", { ...input, author, metadata }); await load(ids.scenarioId, ids.versionId); pendingSave.current = null; setMessage("Import saved as version 1.") })}>Save import</Button></div>}
    </Section>
    {doc && saved && <Section title={doc.name} description={<>Version {saved.revision} · {saved.author} · {dirty ? "Unsaved changes" : "Saved"}{saved.parentVersionId ? ` · parent ${saved.parentVersionId.slice(0, 8)}` : ""}</>} action={<div className="flex flex-wrap gap-2">{!conflict && <><Button disabled={busy || !dirty || !author.trim()} onClick={() => action(() => save())}>Save version</Button><Button variant="outline" disabled={busy || !author.trim()} onClick={() => action(() => save(true))}>Save branch</Button><Button variant="outline" disabled={busy} onClick={() => action(() => load(saved.scenarioId))}>Discard changes</Button></>}<Button variant="outline" onClick={() => download(`${doc.name}.json`, JSON.stringify({ document: doc, source: saved.source, versionId: saved.id, metadata }, null, 2), "application/json")}>Export JSON</Button></div>}>
      {conflict && <Alert variant="error"><AlertDescription className="text-foreground"><p>Another version was saved. Choose how to resolve your edits.</p><div className="flex flex-wrap gap-2"><Button disabled={busy || !author.trim()} onClick={() => action(() => save(true))}>Save my edits as a new branch</Button><Button variant="outline" disabled={busy} onClick={() => action(() => load(saved.scenarioId))}>Discard my edits and reload</Button></div></AlertDescription></Alert>}
      <Field label="Scenario name"><Input value={doc.name} onChange={e => changeDocument(d => { d.name = e.target.value })} /></Field>
      {review && <DataReviewPanel review={review} />}
      {review && (dirty ? (capabilities?.census || capabilities?.zcta) && review.geocodable > 0 && <p className="text-muted-foreground text-sm">Save your edits as a version before resolving addresses.</p> : <GeocodePanel capabilities={capabilities} review={review} job={geocodeJob} busy={busy || !author.trim() || conflict} onStart={options => action(() => startGeocode(options))} />)}
      <ToggleGroup id="scenario-data" aria-label="Scenario data" variant="outline" size="sm" className="flex-wrap" value={[tab]} onValueChange={next => { if (next[0]) { setTab(next[0]); setPage(0) } }}>{["orders", "inventory", "locations"].map(value => <ToggleGroupItem key={value} value={value}>{value === "orders" ? "Order lines" : value === "inventory" ? "Inventory" : `Coordinates${review && review.coordinates.zcta + review.coordinates.unresolved ? ` (${review.coordinates.zcta + review.coordinates.unresolved} to review)` : ""}`}</ToggleGroupItem>)}</ToggleGroup>
      <p className="text-xs text-muted-foreground">Edits apply on Enter or when you leave a field. Save a version before running.</p>
      {tab === "locations"
        ? <CoordinateReview doc={doc} canFind={!!capabilities?.census || !!capabilities?.zcta} busy={busy} undoLabel={undo.length ? undo[undo.length - 1].label : null}
            onPlace={(id, lat, lon) => editLocation(id, "placed", loc => correct(loc, { lat: round6(lat), lon: round6(lon), coordinate_source: "manual", geocode: null }))}
            onAxis={(id, axis, value) => editLocation(id, "edited", loc => { const next = { lat: loc.lat, lon: loc.lon, [axis]: value }; correct(loc, { ...next, coordinate_source: next.lat !== null && next.lon !== null ? "manual" : "unresolved", geocode: null }) })}
            onFind={(id, address) => action(() => findAddress(id, address))} onUndo={undoEdit} onError={setMessage} />
        : <>
      <div className="overflow-x-auto"><Table><TableHeader><TableRow>{(tab === "orders" ? ["Order", "Date", "Product", "Pieces", "Value / piece ($)", "Feet / piece"] : ["Product", "Available pieces"]).map(h => <TableHead key={h}>{h}</TableHead>)}</TableRow></TableHeader><TableBody>
        {tab === "orders" && lines.slice(page * 25, (page + 1) * 25).map(({ order, line, oi, li }) => <TableRow key={line.id}><TableCell>{order.id}</TableCell><TableCell><EditCell label={`Date ${order.id}`} value={order.order_date} onCommit={value => changeDocument(d => { d.orders[oi].order_date = value })} /></TableCell><TableCell>{line.product_id}</TableCell><TableCell><EditCell label={`Pieces ${line.id}`} value={line.ordered_pieces} onCommit={value => changeDocument(d => { if (!/^\d+$/.test(value)) throw new Error("Pieces must be a nonnegative whole number."); d.orders[oi].lines[li].ordered_pieces = Number(value) })} /></TableCell><TableCell><EditCell label={`Value ${line.id}`} value={(line.net_value_per_piece_cents / 100).toFixed(2)} onCommit={value => changeDocument(d => { d.orders[oi].lines[li].net_value_per_piece_cents = decimal(value) })} /></TableCell><TableCell><EditCell label={`Feet ${line.id}`} value={((line.linear_feet_per_piece ?? doc.products.find(p => p.id === line.product_id)!.linear_feet_per_piece) / 100).toFixed(2)} onCommit={value => changeDocument(d => { d.orders[oi].lines[li].linear_feet_per_piece = decimal(value) })} /></TableCell></TableRow>)}
        {tab === "inventory" && doc.inventory.slice(page * 25, (page + 1) * 25).map((item, index) => <TableRow key={item.product_id}><TableCell>{item.product_id}</TableCell><TableCell><EditCell label={`Available ${item.product_id}`} value={item.available_pieces} onCommit={value => changeDocument(d => { if (!/^\d+$/.test(value)) throw new Error("Stock must be a nonnegative whole number."); d.inventory[page * 25 + index].available_pieces = Number(value) })} /></TableCell></TableRow>)}
      </TableBody></Table></div><div className="flex flex-wrap items-center gap-3"><Button variant="outline" size="sm" disabled={!page} onClick={() => setPage(page - 1)}>Previous</Button><span className="text-sm text-muted-foreground tabular-nums">{count ? page * 25 + 1 : 0}–{Math.min((page + 1) * 25, count)} of {count}</span><Button variant="outline" size="sm" disabled={(page + 1) * 25 >= count} onClick={() => setPage(page + 1)}>Next</Button></div>
        </>}
      <Collapsible defaultOpen><CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 rounded-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">Run settings<ChevronDownIcon className="size-4 transition-transform group-data-[panel-open]:rotate-180" aria-hidden /></CollapsibleTrigger><CollapsiblePanel><div className="space-y-4 p-1 pt-4"><TravelMatrixPanel accessMode={access.mode} operatorKey={key} document={doc} excludedLineIds={settings.excluded_line_ids} selectedId={settings.travel_snapshot_id} versionId={saved.id} versionSaved={!dirty} onSelect={id => { setSettings(previous => ({ ...previous, travel_snapshot_id: id })); setFindings([]) }} /><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{([["trailer_capacity", "Trailer capacity (hundredths ft)"], ["max_leg_m", "Maximum leg (meters)"], ["k", "Clusters (blank = auto)"], ["kmeans_seed", "Cluster seed"], ["solver_seed", "Solver seed"], ["solver_time_limit_s", "Time per cluster (seconds)"], ["inventory_percent", "Inventory available (%)"], ["h3_resolution", "H3 resolution (H3 method)"], ["solver_max_iterations", "Iterations (blank = time limit)"], ["max_cluster_diameter_m", "Optional cluster diameter (meters; blank = off)"], ["travel_circuity", "Travel circuity (estimated only)"], ["cluster_circuity", "Cluster circuity"], ["cost_per_truck_cents", "Cost per truck (cents)"], ["cost_per_mile_cents", "Cost per mile (cents)"]] as [keyof ScenarioRunSettings, string][]).map(([name, label]) => <Field key={name} label={label}><Input disabled={(name === "travel_circuity" && settings.travel_snapshot_id !== null) || (settings.fleet != null && (name === "trailer_capacity" || name === "cost_per_truck_cents" || name === "cost_per_mile_cents"))} type="number" min="0" step={name.includes("circuity") || name === "solver_time_limit_s" ? "any" : "1"} value={settings[name] == null ? "" : String(settings[name])} onChange={e => updateSetting(name, e.target.value === "" ? null : Number(e.target.value))} /></Field>)}</div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Pick label="Clustering method" value={settings.cluster_strategy} items={strategyItems} onChange={value => setSettings(previous => ({ ...previous, cluster_strategy: value }))} /><Pick label="Objective" value={settings.objective} items={objectiveItems} onChange={value => setSettings(previous => ({ ...previous, objective: value }))} /><Pick label="Allocation" value={settings.allocation_strategy} items={allocationItems} onChange={value => setSettings(previous => ({ ...previous, allocation_strategy: value }))} /><Pick label="Order fulfillment" value={settings.fulfillment_policy} items={fulfillmentItems} onChange={value => setSettings(previous => ({ ...previous, fulfillment_policy: value }))} />{settings.allocation_strategy === "optimized" && <Pick label="Optimized allocation" value={`${settings.allocation_objective}:${settings.respect_order_date}`} items={optimizedItems} onChange={value => { const [objective, respect] = value.split(":"); setSettings(previous => ({ ...previous, allocation_objective: objective as ScenarioRunSettings["allocation_objective"], respect_order_date: respect === "true" })) }} />}{settings.objective === "weighted_distance" && <Field label="Truck penalty (meters)"><Input type="number" min="0" value={settings.weighted_truck_penalty_m ?? ""} onChange={e => updateSetting("weighted_truck_penalty_m", e.target.value === "" ? null : Number(e.target.value))} /></Field>}{(["missing_coordinates", "far_from_depot", "oversize_stop", "approximate_coordinates"] as const).map(check => <Pick key={check} label={check === "approximate_coordinates" ? "ZIP-approximate stops" : check.replaceAll("_", " ")} value={settings.preflight[check]} items={preflightItems} onChange={value => setSettings(previous => ({ ...previous, preflight: { ...previous.preflight, [check]: value } }))} />)}</div>
        <details className="mt-4 rounded-xl border bg-card p-4" open={settings.fleet != null}><summary className="cursor-pointer font-medium">Fleet</summary><div className="mt-4"><FleetEditor fleet={settings.fleet ?? undefined} objective={settings.objective} onChange={fleet => { setSettings(previous => { const next = { ...previous, fleet }; if (fleet === undefined) delete next.fleet; return next }); setFindings([]) }} /></div></details>
        <p className="mt-3 text-xs text-muted-foreground">Cost objective requires both rates (or per-type rates with a fleet). Cluster diameter is optional and off by default; maximum leg limits each drive. Run settings are saved with each run.</p>
      </div>
      </CollapsiblePanel></Collapsible>
      <div className="flex flex-wrap gap-2"><Button disabled={busy || dirty || conflict || (settings.objective === "cost" && settings.fleet === undefined && (settings.cost_per_truck_cents === null || settings.cost_per_mile_cents === null)) || fleetProblems(settings).length > 0} onClick={() => action(() => reviewAndRun())}>Review and run saved version</Button><Button variant="outline" disabled={busy || dirty || conflict} onClick={() => action(async () => { await preflight(); setMessage("Preflight review updated.") })}>Review checks</Button><Button variant="outline" disabled={busy || dirty || conflict || settings.travel_snapshot_id !== null} title={settings.travel_snapshot_id ? "The k explorer uses estimated travel. Switch to estimated travel to explore k." : undefined} onClick={() => action(async () => { const ks = settings.k ? [settings.k, settings.k + 1] : [1, 2]; const run = await api<{ id: string }>("/api/v1/explorer", { versionId: saved.id, base: settings, settings: { ks, selected_k: ks[0] } }, { "Idempotency-Key": crypto.randomUUID() }); router.push(`/explore/${run.id}`) })}>Explore k</Button><Button variant="outline" disabled={busy || dirty || conflict} onClick={() => setSweeping(!sweeping)}>{sweeping ? "Hide sweep" : "Sweep…"}</Button></div>
      {sweeping && <SweepBuilder initialK={settings.k ?? 4} limit={25} versionId={saved.id} base={settings} scenarioKey={usesKey ? key : undefined} onCreated={id => router.push(`/experiments/${id}`)} />}
      {findings.length > 0 && <div className="space-y-3" aria-label="Preflight findings"><h3 className="font-medium">Preflight review</h3>{findings.map((finding, index) => <Alert role="group" variant={finding.action === "block" ? "error" : "warning"} key={`${finding.check}-${index}`}><AlertTitle>{finding.check.replaceAll("_", " ")} · {finding.action === "block" ? "Blocks run" : "Warning"}</AlertTitle><AlertDescription><p>{finding.message}</p><p className="break-all text-xs">{finding.line_ids.length} affected lines{finding.line_ids.length ? `: ${finding.line_ids.slice(0, 30).join(", ")}${finding.line_ids.length > 30 ? "…" : ""}` : ""}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setTab(finding.check === "oversize_stop" ? "orders" : "locations"); setPage(0); document.getElementById("scenario-data")?.scrollIntoView({ behavior: "smooth" }) }}>Edit data</Button>{finding.action === "block" && finding.line_ids.length > 0 && <Button size="sm" variant="outline" disabled={busy} onClick={() => action(async () => { const candidate = { ...settings, excluded_line_ids: [...new Set([...settings.excluded_line_ids, ...finding.line_ids])] }; setSettings(candidate); await reviewAndRun(candidate) })}>Exclude these lines and run</Button>}{finding.action === "block" && finding.check !== "far_via_stop" && <Button size="sm" variant="outline" onClick={() => { setSettings(previous => ({ ...previous, preflight: { ...previous.preflight, [finding.check]: "warn" } })); setFindings([]); setMessage("Policy changed to warn. Review checks again before running.") }}>Warn only</Button>}</div></AlertDescription></Alert>)}</div>}
    </Section>}
    <p role="status" aria-live="polite" className="whitespace-pre-wrap break-words text-sm text-muted-foreground empty:hidden">{busy ? "Working…" : message}</p>
  </div>
}
