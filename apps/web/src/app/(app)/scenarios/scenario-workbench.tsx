"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import type { RunSettings, ScenarioDocument } from "@fillrate/contracts"
import type { GeocodeCapabilities, GeocodeJob, GeocodeOptions } from "@fillrate/db/geocode"
import type { CsvImportInput, CsvImportPreview } from "@fillrate/db/imports"
import { reviewScenario } from "@fillrate/db/review"
import { ChevronDownIcon } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { runDefaults as defaults, type ScenarioRunSettings } from "@/lib/run-defaults"
import { SweepBuilder } from "../experiments/sweep-builder"
import { USE_K_KEY } from "../explore/explorer-view"
import { DataTables } from "./data-tables"
import { CoordinateReview, DataReviewPanel, GeocodePanel } from "./data-review"
import { ImportPanel } from "./import-panel"
import { RunSettingsPanel } from "./run-settings"
import { EditCell, Field, Section, download } from "./workbench-ui"

type Location = ScenarioDocument["locations"][number]
const round6 = (n: number) => Math.round(n * 1e6) / 1e6
// Local Fillrate is single-user; versions still record an author.
const author = "Local"
/** A correction keeps the location's first non-manual coordinate and its provenance (spec §6). */
function correct(loc: Location, next: Pick<Location, "lat" | "lon" | "coordinate_source" | "geocode">) {
  if (!loc.original && loc.coordinate_source !== "unresolved" && loc.coordinate_source !== "manual") {
    loc.original = { lat: loc.lat, lon: loc.lon, coordinate_source: loc.coordinate_source, geocode: loc.geocode ?? null }
  }
  Object.assign(loc, next)
}
type Saved = { id: string; scenarioId: string; revision: number; parentVersionId: string | null; author: string; document: ScenarioDocument; source: unknown }
type Listed = {
  id: string
  name: string
  revision: number
  versionId: string
  branchedFrom: string | null
  createdAt: number
  depotLabel: string | null
  orderCount: number
}
type PreflightFinding = {
  check: "missing_coordinates" | "far_from_depot" | "oversize_stop" | "far_via_stop" | "approximate_coordinates"
  action: "block" | "warn"
  location_ids: string[]
  line_ids: string[]
  message: string
}

export function ScenarioWorkbench() {
  const router = useRouter()
  const [browserId, setBrowserId] = useState("")
  const [timezone, setTimezone] = useState("America/Chicago")
  const [planningDate, setPlanningDate] = useState("")
  const [list, setList] = useState<Listed[]>([])
  const [saved, setSaved] = useState<Saved | null>(null)
  const [doc, setDoc] = useState<ScenarioDocument | null>(null)
  const [dirty, setDirty] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [input, setInput] = useState<CsvImportInput>({
    name: "New scenario",
    depot: { id: "depot", label: "", lat: Number.NaN, lon: Number.NaN },
    ordersCsv: "",
    inventoryCsv: "",
  })
  // The depot is entered per import (no default): raw text keeps a half-typed number from being coerced.
  const [depotRaw, setDepotRaw] = useState({ lat: "", lon: "" })
  const [preview, setPreview] = useState<CsvImportPreview | null>(null)
  const [tab, setTab] = useState("orders")
  const [page, setPage] = useState(0)
  const [settings, setSettings] = useState<ScenarioRunSettings>(defaults)
  const [findings, setFindings] = useState<PreflightFinding[]>([])
  const [sweeping, setSweeping] = useState(false)
  const [capabilities, setCapabilities] = useState<GeocodeCapabilities | null>(null)
  const [geocodeJob, setGeocodeJob] = useState<GeocodeJob | null>(null)
  const [undo, setUndo] = useState<{ label: string; doc: ScenarioDocument }[]>([])
  // With a scenario open the import form is folded away; loading a scenario closes it again.
  const [importOpen, setImportOpen] = useState(false)
  // "Open scenario" from a failed, cancelled or interrupted run: ?scenario=&version=&run= opens that version with the run's settings.
  const [opening, setOpening] = useState<{ scenario: string; version: string; run: string | null } | null>(null)
  const opened = useRef(false)
  const [examples, setExamples] = useState<{ id: string; label: string; orders: number }[]>([])
  useEffect(() => {
    fetch("/api/v1/geocode", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(setCapabilities, () => setCapabilities(null))
  }, [])
  useEffect(() => {
    fetch("/api/v1/scenarios", { cache: "no-store" })
      .then(r => (r.ok ? r.json() : { scenarios: [] }))
      .then(
        data => setList(data.scenarios),
        () => setList([]),
      )
    fetch("/api/v1/examples")
      .then(r => r.json())
      .then(
        data => setExamples(data.examples),
        () => setExamples([]),
      )
  }, [])
  // Poll a geocoding job; when it finishes, open the version it saved.
  useEffect(() => {
    if (!geocodeJob || (geocodeJob.status !== "queued" && geocodeJob.status !== "running")) return
    const timer = window.setTimeout(async () => {
      try {
        const next = await api<GeocodeJob>(`/api/v1/geocode/jobs/${geocodeJob.id}`)
        setGeocodeJob(next)
        if (next.status === "succeeded" && next.resultScenarioId && next.resultVersionId) {
          await load(next.resultScenarioId, next.resultVersionId, true)
          setMessage(next.branched ? "Addresses resolved and saved as a branch (the scenario changed meanwhile)." : "Addresses resolved and saved as a new version.")
        }
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not read the geocoding job.")
      }
    }, 1500)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geocodeJob])
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const id = localStorage.getItem("fillrate.browser.v1") ?? crypto.randomUUID()
      localStorage.setItem("fillrate.browser.v1", id)
      setBrowserId(id)
      // "Use this k" from an imported k explorer carries k and seed here (spec §8a, design review item 12).
      const picked = localStorage.getItem(USE_K_KEY)
      if (picked) {
        localStorage.removeItem(USE_K_KEY)
        const { k, seed } = JSON.parse(picked) as { k: number; seed: number }
        setSettings(previous => ({ ...previous, cluster_strategy: "kmeans", k, kmeans_seed: seed }))
        setMessage(`Run settings: k = ${k}, k-means seed ${seed} from the k explorer. Load the scenario and run.`)
      }
      const query = new URLSearchParams(window.location.search)
      const scenario = query.get("scenario"),
        version = query.get("version")
      if (scenario && version) setOpening({ scenario, version, run: query.get("run") })
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
      const now = new Date()
      setPlanningDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`)
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [])
  useEffect(() => {
    if (!opening || opened.current) return
    opened.current = true
    const { scenario, version, run } = opening
    void action(async () => {
      await load(scenario, version)
      if (!run) return
      const detail = await api<{ settings: RunSettings }>(`/api/v1/runs/${run}`)
      setSettings({ ...defaults, ...(detail.settings as Partial<ScenarioRunSettings>) })
      setMessage(`Opened the version and settings of run ${run.slice(0, 8)}. Fix the flagged data or settings, save, then run again.`)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opening])
  async function api<T>(path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const response = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    })
    const data = await response.json()
    if (!response.ok) {
      if (data.error?.code === "version_conflict") setConflict(true)
      throw new Error(data.error?.message ?? data.message ?? JSON.stringify(data))
    }
    return data
  }
  const saveRequest = (path: string, body: unknown) => api<{ scenarioId: string; versionId: string }>(path, body)
  async function action(fn: () => Promise<void>) {
    setBusy(true)
    setMessage("")
    try {
      await fn()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Request failed.")
    } finally {
      setBusy(false)
    }
  }
  async function listScenarios() {
    try {
      setList((await api<{ scenarios: Listed[] }>("/api/v1/scenarios")).scenarios)
    } catch {
      setList([])
    }
  }
  async function openExample(id: string) {
    const { scenario, settings: exampleSettings } = await api<{ scenario: ScenarioDocument; settings: Partial<ScenarioRunSettings> }>(
      `/api/v1/examples?id=${id}`,
    )
    const ids = await saveRequest("/api/v1/imports/commit", {
      format: "json",
      scenarioJson: JSON.stringify(scenario),
      name: scenario.name,
      depot: scenario.depot,
      author,
      metadata,
    })
    await load(ids.scenarioId, ids.versionId)
    setSettings({ ...defaults, ...exampleSettings })
    setMessage("Example saved as a new scenario. Edit it or run it.")
  }
  async function load(id: string, version?: string, keepJob = false) {
    void listScenarios()
    const row = await api<Saved>(`/api/v1/scenarios/${id}${version ? `?version=${version}` : ""}`)
    setSaved(row)
    setDoc(row.document)
    setDirty(false)
    setConflict(false)
    setPage(0)
    setPreview(null)
    setFindings([])
    setUndo([])
    setImportOpen(false)
    if (!keepJob) setGeocodeJob(null)
  }
  const metadata = { timezone, planningDate, browserId }
  const format = input.format ?? "csv"
  const depotValid =
    input.depot.label.trim() !== "" &&
    depotRaw.lat.trim() !== "" &&
    depotRaw.lon.trim() !== "" &&
    Number.isFinite(input.depot.lat) &&
    Math.abs(input.depot.lat) <= 90 &&
    Number.isFinite(input.depot.lon) &&
    Math.abs(input.depot.lon) <= 180
  const importReady =
    (format === "json" || depotValid) &&
    (format === "json" ? !!input.scenarioJson : !!(format === "geojson" ? input.ordersGeojson : input.ordersCsv) && !!input.inventoryCsv)
  const review = useMemo(() => (doc ? reviewScenario(doc) : null), [doc])
  function changeInput(patch: Partial<CsvImportInput>) {
    setInput(previous => ({ ...previous, ...patch }))
    setPreview(null)
  }
  function changeDocument(fn: (draft: ScenarioDocument) => void) {
    if (!doc) return
    const draft = structuredClone(doc)
    try {
      fn(draft)
      setDoc(draft)
      setDirty(true)
      setFindings([])
    } catch (e) {
      setMessage((e as Error).message)
    }
  }
  /** Coordinate edits keep an undo stack of whole documents (at most 50 steps). */
  function editLocation(id: string, label: string, fn: (loc: Location) => void) {
    if (!doc) return
    const draft = structuredClone(doc)
    const loc = draft.locations.find(l => l.id === id)
    if (!loc) return
    fn(loc)
    setUndo(previous => [...previous.slice(-49), { label: `${label} ${loc.label}`, doc }])
    setDoc(draft)
    setDirty(true)
    setFindings([])
  }
  function undoEdit() {
    const last = undo[undo.length - 1]
    if (!last) return
    setDoc(last.doc)
    setUndo(undo.slice(0, -1))
    setDirty(true)
    setFindings([])
    setMessage(`Undid: ${last.label}.`)
  }
  async function findAddress(id: string, address: string) {
    const found = await api<Pick<Location, "lat" | "lon" | "coordinate_source" | "geocode"> & { status?: string }>("/api/v1/geocode/address", {
      address,
      fallback: capabilities?.zcta ? "zcta" : "off",
    })
    if (found.lat === null || found.lon === null) {
      setMessage(`No match for ${address}${found.status ? ` (${found.status.replace("_", " ")})` : ""}. Place it on the map instead.`)
      return
    }
    editLocation(id, "found", loc => correct(loc, found))
    setMessage(found.coordinate_source === "zcta" ? "Placed at the ZIP code's ZCTA internal point (approximate)." : "Placed at the Census match.")
  }
  async function startGeocode(options: GeocodeOptions) {
    if (!saved) return
    setGeocodeJob(await api<GeocodeJob>("/api/v1/geocode/jobs", { versionId: saved.id, options, author, metadata }))
  }
  async function save(branch = false) {
    if (!doc || !saved) return
    const half = doc.locations.find(l => (l.lat === null) !== (l.lon === null))
    if (half) throw new Error(`${half.label} has only one coordinate. Enter both or clear both.`)
    const ids = await saveRequest(`/api/v1/scenarios/${saved.scenarioId}`, {
      document: doc,
      author,
      metadata,
      source: saved.source,
      expectedVersionId: saved.id,
      branch,
    })
    await load(ids.scenarioId, ids.versionId)
    setMessage(branch ? "Branch saved." : "Version saved.")
  }
  const updateSetting = (name: keyof ScenarioRunSettings, value: number | null) => {
    setSettings(previous => ({ ...previous, [name]: value }))
    setFindings([])
  }
  async function preflight(candidate = settings) {
    if (!saved) return []
    const result = await api<{ findings: PreflightFinding[] }>("/api/v1/scenarios/preflight", { versionId: saved.id, settings: candidate })
    setFindings(result.findings)
    return result.findings
  }
  async function submit(candidate: ScenarioRunSettings) {
    if (!saved) return
    try {
      const run = await api<{ id: string }>("/api/v1/scenarios/runs", { versionId: saved.id, settings: candidate })
      router.push(`/runs/${run.id}`)
    } catch (error) {
      await preflight(candidate)
      throw error
    }
  }
  async function reviewAndRun(candidate = settings) {
    const checked = await preflight(candidate)
    if (checked.some(finding => finding.action === "block")) {
      setMessage("Resolve the blocking checks, exclude their lines, or change their policy to warn before running.")
      return
    }
    await submit(candidate)
  }

  const importPanel = (
    <ImportPanel
      input={input}
      depotRaw={depotRaw}
      preview={preview}
      busy={busy}
      dirty={dirty}
      depotValid={depotValid}
      importReady={importReady}
      onChange={changeInput}
      onDepotRaw={patch => setDepotRaw(previous => ({ ...previous, ...patch }))}
      onPreview={() => action(async () => setPreview(await api<CsvImportPreview>("/api/v1/imports/preview", input)))}
      onSave={() =>
        action(async () => {
          const ids = await saveRequest("/api/v1/imports/commit", { ...input, author, metadata })
          await load(ids.scenarioId, ids.versionId)
          setMessage("Import saved as version 1.")
        })
      }
      onError={setMessage}
    />
  )

  return (
    <div className="space-y-6">
      <Section
        title="Saved scenarios"
        description="Open a saved scenario, or start from a bundled synthetic example."
        action={
          <div className="flex flex-wrap gap-2">
            {examples.map(example => (
              <Button key={example.id} variant="outline" size="sm" disabled={busy || dirty} onClick={() => action(() => openExample(example.id))}>
                Open {example.label.toLowerCase()}
              </Button>
            ))}
          </div>
        }
      >
        {list.length > 0 ? (
          <div className="flex flex-col items-start gap-2" aria-label="Saved scenarios">
            {list.map(row => (
              <Button
                variant="outline"
                key={row.id}
                className="h-auto min-h-9 max-w-full justify-start whitespace-normal py-1.5 text-left sm:h-auto sm:min-h-8"
                disabled={busy || dirty}
                onClick={() => action(() => load(row.id))}
              >
                {row.name} · v{row.revision} · {row.depotLabel ?? "Depot"} · {row.orderCount ?? 0} orders · {new Date(row.createdAt).toLocaleString()}
                {row.branchedFrom ? ` · branch of ${row.branchedFrom.slice(0, 8)}` : ""}
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">No saved scenarios yet. Import orders and inventory below, or open an example.</p>
        )}
      </Section>
      {doc && saved && (
        <Section
          title={doc.name}
          description={
            <>
              Version {saved.revision} · {dirty ? "Unsaved changes" : "Saved"}
              {saved.parentVersionId ? ` · parent ${saved.parentVersionId.slice(0, 8)}` : ""}
            </>
          }
          action={
            <div className="flex flex-wrap gap-2">
              {!conflict && (
                <>
                  <Button disabled={busy || !dirty} onClick={() => action(() => save())}>
                    Save version
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => action(() => save(true))}>
                    Save branch
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => action(() => load(saved.scenarioId))}>
                    Discard changes
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={() =>
                  download(`${doc.name}.json`, JSON.stringify({ document: doc, source: saved.source, versionId: saved.id, metadata }, null, 2), "application/json")
                }
              >
                Export JSON
              </Button>
            </div>
          }
        >
          {conflict && (
            <Alert variant="error">
              <AlertDescription className="text-foreground">
                <p>Another version was saved. Choose how to resolve your edits.</p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => action(() => save(true))}>
                    Save my edits as a new branch
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => action(() => load(saved.scenarioId))}>
                    Discard my edits and reload
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
          <Field label="Scenario name">
            <Input
              value={doc.name}
              onChange={e =>
                changeDocument(d => {
                  d.name = e.target.value
                })
              }
            />
          </Field>
          <div className="space-y-2 rounded-lg border p-3" aria-label="Depot">
            <h3 className="text-sm font-medium">
              Depot: {doc.depot.label}{" "}
              <span className="text-muted-foreground font-mono text-xs">
                ({doc.depot.lat}, {doc.depot.lon})
              </span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Depot name">
                <EditCell
                  label="Depot name"
                  value={doc.depot.label}
                  onCommit={value =>
                    changeDocument(d => {
                      if (!value.trim()) throw new Error("The depot needs a name.")
                      d.depot.label = value.trim()
                    })
                  }
                />
              </Field>
              <Field label="Latitude">
                <EditCell
                  label="Depot latitude (loaded)"
                  value={doc.depot.lat}
                  onCommit={value =>
                    changeDocument(d => {
                      const n = Number(value)
                      if (value.trim() === "" || !Number.isFinite(n) || Math.abs(n) > 90) throw new Error("Depot latitude must be between -90 and 90.")
                      d.depot.lat = round6(n)
                    })
                  }
                />
              </Field>
              <Field label="Longitude">
                <EditCell
                  label="Depot longitude (loaded)"
                  value={doc.depot.lon}
                  onCommit={value =>
                    changeDocument(d => {
                      const n = Number(value)
                      if (value.trim() === "" || !Number.isFinite(n) || Math.abs(n) > 180) throw new Error("Depot longitude must be between -180 and 180.")
                      d.depot.lon = round6(n)
                    })
                  }
                />
              </Field>
            </div>
            <p className="text-muted-foreground text-xs">
              Trucks start here. Editing it saves as a new version; road matrices recorded for the old depot become stale.
            </p>
          </div>
          {review && <DataReviewPanel review={review} />}
          {review &&
            (dirty ? (
              (capabilities?.census || capabilities?.zcta) &&
              review.geocodable > 0 && <p className="text-muted-foreground text-sm">Save your edits as a version before resolving addresses.</p>
            ) : (
              <GeocodePanel
                capabilities={capabilities}
                review={review}
                job={geocodeJob}
                busy={busy || conflict}
                onStart={options => action(() => startGeocode(options))}
              />
            ))}
          <ToggleGroup
            id="scenario-data"
            aria-label="Scenario data"
            variant="outline"
            size="sm"
            className="flex-wrap"
            value={[tab]}
            onValueChange={next => {
              if (next[0]) {
                setTab(next[0])
                setPage(0)
              }
            }}
          >
            {["orders", "inventory", "locations"].map(value => (
              <ToggleGroupItem key={value} value={value}>
                {value === "orders"
                  ? "Order lines"
                  : value === "inventory"
                    ? "Inventory"
                    : `Coordinates${review && review.coordinates.zcta + review.coordinates.unresolved ? ` (${review.coordinates.zcta + review.coordinates.unresolved} to review)` : ""}`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">Edits apply on Enter or when you leave a field. Save a version before running.</p>
          {tab === "locations" ? (
            <CoordinateReview
              doc={doc}
              canFind={!!capabilities?.census || !!capabilities?.zcta}
              busy={busy}
              undoLabel={undo.length ? undo[undo.length - 1].label : null}
              onPlace={(id, lat, lon) =>
                editLocation(id, "placed", loc => correct(loc, { lat: round6(lat), lon: round6(lon), coordinate_source: "manual", geocode: null }))
              }
              onAxis={(id, axis, value) =>
                editLocation(id, "edited", loc => {
                  const next = { lat: loc.lat, lon: loc.lon, [axis]: value }
                  correct(loc, { ...next, coordinate_source: next.lat !== null && next.lon !== null ? "manual" : "unresolved", geocode: null })
                })
              }
              onFind={(id, address) => action(() => findAddress(id, address))}
              onUndo={undoEdit}
              onError={setMessage}
            />
          ) : (
            <DataTables doc={doc} tab={tab} page={page} setPage={setPage} changeDocument={changeDocument} />
          )}
          <RunSettingsPanel settings={settings} setSettings={setSettings} updateSetting={updateSetting} />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={
                busy || dirty || conflict || (settings.objective === "cost" && (settings.cost_per_truck_cents === null || settings.cost_per_mile_cents === null))
              }
              onClick={() => action(() => reviewAndRun())}
            >
              Review and run saved version
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty || conflict}
              onClick={() =>
                action(async () => {
                  await preflight()
                  setMessage("Preflight review updated.")
                })
              }
            >
              Review checks
            </Button>
            <Button
              variant="outline"
              disabled={busy || dirty || conflict}
              onClick={() =>
                action(async () => {
                  const ks = settings.k ? [settings.k, settings.k + 1] : [1, 2]
                  const run = await api<{ id: string }>("/api/v1/explorer", {
                    versionId: saved.id,
                    base: settings,
                    settings: { ks, selected_k: ks[0] },
                  })
                  router.push(`/explore/${run.id}`)
                })
              }
            >
              Explore k
            </Button>
            <Button variant="outline" disabled={busy || dirty || conflict} onClick={() => setSweeping(!sweeping)}>
              {sweeping ? "Hide sweep" : "Sweep…"}
            </Button>
          </div>
          {sweeping && (
            <SweepBuilder initialK={settings.k ?? 4} limit={25} versionId={saved.id} base={settings} onCreated={id => router.push(`/experiments/${id}`)} />
          )}
          {findings.length > 0 && (
            <div className="space-y-3" aria-label="Preflight findings">
              <h3 className="font-medium">Preflight review</h3>
              {findings.map((finding, index) => (
                <Alert role="group" variant={finding.action === "block" ? "error" : "warning"} key={`${finding.check}-${index}`}>
                  <AlertTitle>
                    {finding.check.replaceAll("_", " ")} · {finding.action === "block" ? "Blocks run" : "Warning"}
                  </AlertTitle>
                  <AlertDescription>
                    <p>{finding.message}</p>
                    <p className="break-all text-xs">
                      {finding.line_ids.length} affected lines
                      {finding.line_ids.length ? `: ${finding.line_ids.slice(0, 30).join(", ")}${finding.line_ids.length > 30 ? "…" : ""}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setTab(finding.check === "oversize_stop" ? "orders" : "locations")
                          setPage(0)
                          document.getElementById("scenario-data")?.scrollIntoView({ behavior: "smooth" })
                        }}
                      >
                        Edit data
                      </Button>
                      {finding.action === "block" && finding.line_ids.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            action(async () => {
                              const candidate = { ...settings, excluded_line_ids: [...new Set([...settings.excluded_line_ids, ...finding.line_ids])] }
                              setSettings(candidate)
                              await reviewAndRun(candidate)
                            })
                          }
                        >
                          Exclude these lines and run
                        </Button>
                      )}
                      {finding.action === "block" && finding.check !== "far_via_stop" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSettings(previous => ({ ...previous, preflight: { ...previous.preflight, [finding.check]: "warn" } }))
                            setFindings([])
                            setMessage("Policy changed to warn. Review checks again before running.")
                          }}
                        >
                          Warn only
                        </Button>
                      )}
                    </div>
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          )}
        </Section>
      )}
      {doc && saved ? (
        <Collapsible open={importOpen} onOpenChange={setImportOpen}>
          <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1.5 rounded-md font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Import another scenario
            <ChevronDownIcon className="size-4 transition-transform group-data-[panel-open]:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="pt-4">{importPanel}</div>
          </CollapsiblePanel>
        </Collapsible>
      ) : (
        importPanel
      )}
      <p role="status" aria-live="polite" className="whitespace-pre-wrap break-words text-sm text-muted-foreground empty:hidden">
        {busy ? "Working…" : message}
      </p>
    </div>
  )
}
