"use client"

import { useEffect, useMemo, useState } from "react"
import type { ScenarioDocument } from "@fillrate/contracts"
import { MatrixHeatmap } from "@/components/lab/matrix-heatmap"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { toastManager } from "@/components/ui/toast"

type SnapshotInfo = {
  id: string
  byteLength: number
  nodeCount: number
  provider: "haversine" | "imported" | "valhalla"
  providerVersion: string
  datasetRevision: string
  profile: string
  createdAt: number
}
type SnapshotPreview = SnapshotInfo & {
  distanceUnits: "meters" | "kilometers" | "miles"
  durationUnits: "seconds" | "minutes"
  warningCount: number
  reachableEdges: number
  possibleEdges: number
  nodes: { id: string; lat: number; lon: number }[]
  sampleNodes: { id: string; lat: number; lon: number }[]
  distances: (number | null)[][]
}
function snapshotLabel(snapshot: SnapshotInfo) {
  return `${snapshot.provider} · ${snapshot.profile} · ${snapshot.datasetRevision} · ${snapshot.id.slice(0, 10)}`
}
type BuildJob = { id: string; status: string; done: number; total: number; cancelling: boolean; error: string }
type JobDetail = {
  status: string
  cancel_requested: boolean
  progress: { blocks_done?: number; blocks_total?: number } | null
  failure: { code?: string; message?: string } | null
  travel_snapshot?: { snapshot_id: string } | null
}
const MAX_MATRIX_FILE_BYTES = 64 * 1024 * 1024

function errorMessage(data: unknown, fallback: string) {
  if (typeof data === "object" && data !== null && "error" in data) {
    const error = (data as { error?: { message?: unknown } }).error
    if (typeof error?.message === "string") return error.message
  }
  return fallback
}

/** Browser workflow for importing, selecting, and inspecting immutable directed matrices. */
export function TravelMatrixPanel({
  accessMode,
  operatorKey,
  document,
  excludedLineIds,
  selectedId,
  onSelect,
  versionId,
  versionSaved,
}: {
  accessMode: "hosted" | "local" | "operator"
  operatorKey: string
  document: ScenarioDocument
  excludedLineIds: string[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** The saved version a road matrix would be built for; edits that are not saved yet cannot be bound. */
  versionId: string | null
  versionSaved: boolean
}) {
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [inspected, setInspected] = useState<SnapshotPreview | null>(null)
  const [text, setText] = useState("")
  const [preview, setPreview] = useState<SnapshotPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [loadError, setLoadError] = useState("")
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [build, setBuild] = useState<BuildJob | null>(null)

  async function request<T>(path: string, method = "GET", body?: unknown, rawJson = false): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(accessMode === "operator" && operatorKey ? { "x-scenario-key": operatorKey } : {}),
      },
      body: body === undefined ? undefined : rawJson ? body as string : JSON.stringify(body),
      cache: "no-store",
    })
    const data: unknown = await response.json()
    if (!response.ok) throw new Error(errorMessage(data, `Request failed (${response.status}).`))
    return data as T
  }

  async function loadSnapshots() {
    if (accessMode === "operator" && !operatorKey) return
    try {
      const result = await request<{ snapshots: SnapshotInfo[] }>("/api/v1/travel-snapshots")
      setSnapshots(result.snapshots)
      setLoadError("")
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Could not load saved matrices.") }
  }

  useEffect(() => {
    if (accessMode === "operator" && !operatorKey) return
    const timer = window.setTimeout(() => { void loadSnapshots() }, accessMode === "operator" ? 300 : 0)
    return () => window.clearTimeout(timer)
    // `loadSnapshots` deliberately reads the current key and is triggered after key entry settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessMode, operatorKey])

  useEffect(() => {
    if (accessMode === "operator" && !operatorKey) return
    let cancelled = false
    request<{ valhalla: { configured: boolean } }>("/api/v1/travel-snapshots/jobs").then(
      value => { if (!cancelled) setConfigured(value.valhalla.configured) },
      () => { if (!cancelled) setConfigured(null) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessMode, operatorKey])

  const buildId = build && ["queued", "running"].includes(build.status) ? build.id : null
  useEffect(() => {
    if (!buildId) return
    const timer = window.setInterval(() => {
      request<JobDetail>(`/api/v1/runs/${buildId}`).then(async detail => {
        if (detail.status === "succeeded" && detail.travel_snapshot) {
          const id = detail.travel_snapshot.snapshot_id
          setBuild(null)
          await loadSnapshots()
          onSelect(id)
          toastManager.add({ type: "success", title: "Road matrix built", description: "The new Valhalla matrix is selected for this scenario." })
        } else if (detail.status === "failed") {
          const error = detail.failure?.message ?? "The road matrix build failed."
          setBuild(current => current && { ...current, status: "failed", error })
          toastManager.add({ type: "error", title: "Road matrix not built", description: error })
        } else if (detail.status === "cancelled") {
          setBuild(null)
          toastManager.add({ type: "info", title: "Road matrix build cancelled", description: "Nothing was saved." })
        } else {
          setBuild(current => current && { ...current, status: detail.status, done: detail.progress?.blocks_done ?? current.done, total: detail.progress?.blocks_total ?? current.total })
        }
      }, () => undefined)
    }, 1000)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildId])

  async function startBuild() {
    if (!versionId) return
    setLoadError("")
    try {
      const run = await request<{ id: string; status: string }>("/api/v1/travel-snapshots/jobs", "POST", { versionId, idempotencyKey: crypto.randomUUID() })
      setBuild({ id: run.id, status: run.status, done: 0, total: 0, cancelling: false, error: "" })
    } catch (error) {
      const description = error instanceof Error ? error.message : "Could not start the road matrix build."
      setLoadError(description)
      toastManager.add({ type: "error", title: "Road matrix not started", description })
    }
  }

  async function cancelBuild() {
    if (!build) return
    setBuild({ ...build, cancelling: true })
    try { await request(`/api/v1/runs/${build.id}/cancel`, "POST") }
    catch (error) { setBuild(current => current && { ...current, cancelling: false }); setLoadError(error instanceof Error ? error.message : "Could not cancel the build.") }
  }

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    request<SnapshotPreview>(`/api/v1/travel-snapshots/${selectedId}?inspect=1`).then(value => {
      if (!cancelled) { setInspected(value); setSnapshots(current => current.some(row => row.id === value.id) ? current : [value, ...current]) }
    }, error => { if (!cancelled) { setInspected(null); setLoadError(error instanceof Error ? error.message : "Could not inspect the selected matrix.") } })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const binding = useMemo(() => {
    if (!inspected) return null
    const excluded = new Set(excludedLineIds)
    const activeLocations = new Set(document.orders.filter(order => order.lines.some(line => line.ordered_pieces > 0 && !excluded.has(line.id))).map(order => order.location_id))
    const required = [document.depot, ...document.locations.filter(location => activeLocations.has(location.id) && location.lat !== null && location.lon !== null && location.coordinate_source !== "unresolved")]
      .map(node => ({ id: node.id, lat: node.lat!, lon: node.lon! }))
    const nodes = new Map(inspected.nodes.map(node => [node.id, node]))
    return { required, nodes }
  }, [document, excludedLineIds, inspected])

  /** Downloads through fetch so the operator key header travels with the request. */
  async function downloadSnapshot(id: string, format: "json" | "csv") {
    setLoadError("")
    try {
      const response = await fetch(`/api/v1/travel-snapshots/${id}?format=${format}`, {
        headers: accessMode === "operator" && operatorKey ? { "x-scenario-key": operatorKey } : {},
        cache: "no-store",
      })
      if (!response.ok) throw new Error(errorMessage(await response.json(), `Download failed (${response.status}).`))
      const url = URL.createObjectURL(await response.blob())
      const link = window.document.createElement("a")
      link.href = url
      link.download = `fillrate-travel-${id.slice(0, 12)}.${format}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Could not download the matrix.") }
  }

  async function inspectFile() {
    setBusy(true); setMessage(""); setLoadError(""); setPreview(null)
    try {
      if (new Blob([text]).size > MAX_MATRIX_FILE_BYTES) throw new Error("Matrix file exceeds 64 MiB.")
      // Keep large imported matrices as JSON text; parsing then stringifying the million-cell arrays blocks the UI.
      const result = await request<SnapshotPreview>("/api/v1/travel-snapshots/preview", "POST", text, true)
      setPreview(result)
      setMessage("Matrix is valid. Review its direction, units, coverage, and sample before saving.")
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Could not preview this matrix.") }
    finally { setBusy(false) }
  }

  async function savePreview() {
    if (!preview) return
    setBusy(true); setMessage(""); setLoadError("")
    try {
      if (new Blob([text]).size > MAX_MATRIX_FILE_BYTES) throw new Error("Matrix file exceeds 64 MiB.")
      const saved = await request<SnapshotInfo>("/api/v1/travel-snapshots", "POST", text, true)
      if (saved.id !== preview.id) throw new Error("The saved matrix identity differs from the preview. Preview it again before selecting it.")
      setSnapshots(current => [saved, ...current.filter(row => row.id !== saved.id)])
      setInspected(preview)
      onSelect(saved.id)
      setMessage("Matrix saved and selected for this scenario.")
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Could not save this matrix.") }
    finally { setBusy(false) }
  }

  const currentPreview = selectedId && inspected?.id === selectedId ? inspected : null
  const requiredIds = binding?.required.map(node => node.id) ?? []
  const previewNodeIds = new Set(currentPreview?.nodes.map(node => node.id) ?? [])
  const missing = requiredIds.filter(id => !previewNodeIds.has(id))
  const moved = binding?.required.filter(node => {
    const match = binding.nodes.get(node.id)
    return match && (match.lat !== node.lat || match.lon !== node.lon)
  }).map(node => node.id) ?? []
  const matched = requiredIds.length - missing.length - moved.length

  return <section className="space-y-4 rounded-xl border p-4" aria-labelledby="travel-matrix-heading">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="max-w-2xl space-y-1">
        <h3 id="travel-matrix-heading" className="font-semibold">Travel matrix</h3>
        <p className="text-sm text-muted-foreground">Estimated travel uses straight-line distance × circuity. A selected matrix supplies its recorded, directed legs to the run.</p>
      </div>
      <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-sm sm:max-w-xl">
        <span className="font-medium">Run travel mode</span>
        <select
          aria-label="Run travel mode"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={selectedId ?? "estimated"}
          onChange={event => { setLoadError(""); onSelect(event.target.value === "estimated" ? null : event.target.value) }}
        >
          <option value="estimated">Estimated · straight-line × circuity</option>
          {snapshots.map(snapshot => <option key={snapshot.id} value={snapshot.id}>{snapshotLabel(snapshot)}</option>)}
        </select>
      </label>
    </div>
    {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}

    <div className="space-y-2 border-t pt-3" aria-label="Road matrix build">
      {configured === true && <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={!versionId || !versionSaved || Boolean(buildId)} onClick={() => void startBuild()}>Build road matrix (Valhalla)</Button>
        {buildId && <Button variant="ghost" disabled={build?.cancelling} onClick={() => void cancelBuild()}>{build?.cancelling ? "Cancelling…" : "Cancel build"}</Button>}
      </div>}
      {configured === false && <p className="text-sm text-muted-foreground">Road matrices are not available: this server has no Valhalla deployment configured. Estimated travel and imported matrices still work.</p>}
      {configured === true && !versionSaved && <p className="text-sm text-muted-foreground">Save the scenario version first; a matrix is built for the saved coordinates.</p>}
      {configured === true && <p className="text-sm text-muted-foreground">Builds a directed truck matrix for the depot and every stop with demand in this saved version, using the server&apos;s configured routing data.</p>}
      {buildId && build && <div role="status" aria-live="polite" className="space-y-1.5 text-sm">
        <p>{build.cancelling ? "Cancelling…" : build.status === "queued" ? "Queued, waiting for the worker…" : build.total ? `Requesting road legs: block ${build.done} of ${build.total}` : "Starting…"}</p>
        <Progress aria-label="Road matrix build progress" value={build.total ? Math.round((build.done / build.total) * 100) : 0} className="max-w-md" />
      </div>}
      {build?.status === "failed" && <p role="alert" className="text-sm text-destructive">{build.error}</p>}
    </div>

    {selectedId && currentPreview ? <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-3 text-sm">
        <p className="font-medium">{currentPreview.provider} · {currentPreview.profile}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
          <dt>Provider version</dt><dd className="break-all text-foreground">{currentPreview.providerVersion}</dd>
          <dt>Data revision</dt><dd className="break-all text-foreground">{currentPreview.datasetRevision}</dd>
          <dt>Matrix nodes</dt><dd className="text-foreground">{currentPreview.nodeCount}</dd>
          <dt>Directed coverage</dt><dd className="text-foreground">{currentPreview.reachableEdges.toLocaleString()} / {currentPreview.possibleEdges.toLocaleString()} edges</dd>
          <dt>Units</dt><dd className="text-foreground">{currentPreview.distanceUnits}; {currentPreview.durationUnits}</dd>
          <dt>Warnings</dt><dd className="text-foreground">{currentPreview.warningCount}</dd>
        </dl>
        <p className={missing.length || moved.length ? "text-warning-foreground" : "text-success-foreground"}>
          Scenario coordinates: {matched} of {requiredIds.length} match exactly.
          {missing.length > 0 ? ` Missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? "…" : ""}.` : ""}
          {moved.length > 0 ? ` Changed: ${moved.slice(0, 5).join(", ")}${moved.length > 5 ? "…" : ""}.` : ""}
        </p>
        {(missing.length > 0 || moved.length > 0) && <p role="alert" className="text-destructive">This matrix cannot run against the current coordinates. Update the scenario or choose a matching snapshot; enqueue will be refused until they match.</p>}
        {currentPreview.warningCount > 0 && <p className="text-warning-foreground">The imported snapshot contains {currentPreview.warningCount} provider warning{currentPreview.warningCount === 1 ? "" : "s"}. Review the source file before running.</p>}
        <p className="break-all font-mono text-xs text-muted-foreground">Snapshot {currentPreview.id}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void downloadSnapshot(currentPreview.id, "csv")}>Download CSV</Button>
          <Button variant="outline" size="sm" onClick={() => void downloadSnapshot(currentPreview.id, "json")}>Download JSON</Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border p-3">
        <p className="mb-3 text-sm font-medium">Directed distance sample · rows are origins, columns are destinations</p>
        <MatrixHeatmap nodes={currentPreview.sampleNodes.map(node => node.id)} values={currentPreview.distances} unit={currentPreview.distanceUnits} className="min-w-[34rem]" />
        {currentPreview.nodeCount > currentPreview.sampleNodes.length && <p className="mt-2 text-xs text-muted-foreground">Showing the first {currentPreview.sampleNodes.length} of {currentPreview.nodeCount} nodes.</p>}
      </div>
    </div> : selectedId ? <p role="status" className="text-sm text-muted-foreground">Loading the selected matrix…</p> : <p className="text-sm text-muted-foreground">Estimated travel is active. Imported matrices are optional and remain bound to their recorded coordinates.</p>}

    <details className="border-t pt-3">
      <summary className="cursor-pointer text-sm font-medium">Import a directed matrix</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-muted-foreground">Choose a Fillrate travel snapshot JSON file. Preview validates the complete matrix without saving it. Distances and durations keep the units recorded in the file.</p>
        <Input aria-label="Travel matrix JSON file" type="file" accept=".json,application/json" onChange={async event => {
          const file = event.target.files?.[0]
          if (!file) return
          if (file.size > MAX_MATRIX_FILE_BYTES) { setLoadError("Matrix file exceeds 64 MiB."); return }
          setText(await file.text()); setPreview(null); setLoadError(""); setMessage(`${file.name} loaded. Preview it before saving.`)
        }} />
        <textarea aria-label="Travel matrix JSON content" className="min-h-28 w-full rounded-lg border bg-background p-3 font-mono text-xs" placeholder="Or paste a travel snapshot JSON document" value={text} onChange={event => { setText(event.target.value); setPreview(null); setMessage(""); setLoadError("") }} />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy || !text.trim()} onClick={() => void inspectFile()}>{busy && !preview ? "Checking…" : "Preview matrix"}</Button>
          <Button disabled={busy || !preview} onClick={() => void savePreview()}>{busy && preview ? "Saving…" : "Save matrix"}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => { setText(""); setPreview(null); setMessage(""); setLoadError("") }}>Clear file</Button>
          {accessMode === "operator" && <Button variant="ghost" disabled={busy || !operatorKey} onClick={() => void loadSnapshots()}>Refresh saved matrices</Button>}
        </div>
        {preview && <div className="space-y-2 rounded-md border p-3 text-sm">
          <p className="font-medium">Valid snapshot · {preview.nodeCount} nodes · {preview.reachableEdges.toLocaleString()} / {preview.possibleEdges.toLocaleString()} directed edges present</p>
          <p className="text-muted-foreground">{preview.provider} {preview.providerVersion} · {preview.datasetRevision} · {preview.profile} · {preview.distanceUnits} / {preview.durationUnits}</p>
          <div className="overflow-x-auto"><MatrixHeatmap nodes={preview.sampleNodes.map(node => node.id)} values={preview.distances} unit={preview.distanceUnits} className="min-w-[34rem]" /></div>
        </div>}
        {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        {accessMode === "operator" && !operatorKey && <p role="alert" className="text-sm text-destructive">Enter the operator key to load or save matrices.</p>}
      </div>
    </details>
  </section>
}
