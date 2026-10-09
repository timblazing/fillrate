"use client"

import type { RunSummary } from "@fillrate/contracts"
import { Check, CircleDot, FileSpreadsheet, MapPin, Play, RotateCcw, Truck, Upload, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

import { Results } from "../(app)/runs/run-view"
import { useRoadGeometry } from "../(app)/runs/road-geometry"

const templates = {
  orders:
    "order_id,line_id,order_date,customer_id,location_id,location_label,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece,priority\nO-1,L-1,2026-09-30,ACME,C-1,Customer 1,35.1,-90.1,SKU-1,10,12.50,1.25,1\nO-2,L-2,2026-09-30,Beta,C-2,Customer 2,35.3,-89.8,SKU-1,4,12.50,1.25,1\n",
  inventory: "product,available_pieces\nSKU-1,100\n",
}
const LIMIT = 5_000_000
const count = (n: number) => n.toLocaleString("en-US")

type Caps = {
  maxOrders: number
  solveSeconds: number
  clusterSolveSeconds: number
}
type Example = {
  name: string
  orders: number
  lines: number
  locations: number
  products: number
  depot: string
  k: number | null
  points: { lat: number; lon: number }[]
  origin: { lat: number; lon: number }
  stock: { id: string; label: string; ordered: number; available: number }[]
  preview: {
    id: string
    date: string
    location: string
    pieces: number
    value: number
  }[]
}
type Csv = {
  name: string
  size: number
  text: string
  rows: number
  orders: number | null
}
type Outcome = { summary: RunSummary; seconds: number }

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** Rows and distinct order ids, for display only (a naive split; the server parses and validates the real thing). */
function csvStats(text: string) {
  const rows = text.split(/\r?\n/).filter((line) => line.trim())
  const header = (rows[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase())
  const at = header.indexOf("order_id")
  return {
    rows: Math.max(0, rows.length - 1),
    orders: at < 0 ? null : new Set(rows.slice(1).map((row) => row.split(",")[at])).size,
  }
}

const kb = (bytes: number) =>
  bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`

function CsvDrop({
  label,
  kind,
  hint,
  file,
  onFile,
}: {
  label: string
  kind: keyof typeof templates
  hint: string
  file: Csv | null
  onFile: (file: Csv | null) => void
}) {
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function take(picked: File | undefined) {
    setError(null)
    if (!picked) return
    if (picked.size > LIMIT) return setError(`${picked.name} is larger than 5 MB.`)
    const text = await picked.text()
    onFile({ name: picked.name, size: picked.size, text, ...csvStats(text) })
  }

  const detail =
    file &&
    [
      `${count(file.rows)} ${file.rows === 1 ? "row" : "rows"}`,
      file.orders != null && `${count(file.orders)} orders`,
      kb(file.size),
    ]
      .filter(Boolean)
      .join(" · ")

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          onClick={() => download(`${kind}-template.csv`, templates[kind])}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-xs underline decoration-foreground/20 underline-offset-4 transition-colors hover:decoration-foreground/60 focus-visible:ring-2 focus-visible:outline-none"
        >
          Template
        </button>
      </div>
      <div className="relative">
        <label
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void take(e.dataTransfer.files[0])
          }}
          className={cn(
            "has-focus-visible:ring-ring flex min-h-20 cursor-pointer items-center gap-4 rounded-md border p-3 transition-colors has-focus-visible:ring-2",
            file ? "bg-card border-solid" : "border-dashed hover:border-foreground/25 hover:bg-accent/30",
            dragging && "border-foreground/40 bg-accent/50"
          )}
        >
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            aria-label={`${label} file`}
            className="sr-only"
            onChange={(e) => void take(e.target.files?.[0])}
          />
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-sm border",
              file ? "bg-muted text-foreground" : "text-muted-foreground"
            )}
          >
            {file ? <FileSpreadsheet className="size-4.5" /> : <Upload className="size-4.5" />}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5 pr-8">
            {file ? (
              <>
                <span className="truncate text-sm font-medium">{file.name}</span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">{detail}</span>
              </>
            ) : (
              <>
                <span className="text-sm">
                  <span className="font-medium">Drop a CSV</span>{" "}
                  <span className="text-muted-foreground">or browse</span>
                </span>
                <span className="text-muted-foreground text-xs">{hint}</span>
              </>
            )}
          </span>
        </label>
        {file && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${file.name}`}
            className="absolute top-3 right-3"
            onClick={() => {
              onFile(null)
              if (input.current) input.current.value = ""
            }}
          >
            <X />
          </Button>
        )}
      </div>
      {error && <p className="text-destructive-foreground text-xs">{error}</p>}
    </div>
  )
}

export function PlaygroundView({ caps, example }: { caps: Caps; example: Example }) {
  const geo = useRoadGeometry()
  const results = useRef<HTMLElement>(null)
  const [source, setSource] = useState("sample")
  const [workspace, setWorkspace] = useState("inputs")
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [depot, setDepot] = useState({ label: "", lat: "", lon: "" })
  const [orders, setOrders] = useState<Csv | null>(null)
  const [inventory, setInventory] = useState<Csv | null>(null)

  useEffect(() => {
    if (!busy) return
    const timer = setInterval(() => setElapsed((performance.now() - started) / 1000), 200)
    return () => clearInterval(timer)
  }, [busy, started])

  const lat = Number(depot.lat),
    lon = Number(depot.lon)
  const depotReady =
    depot.label.trim() !== "" &&
    depot.lat.trim() !== "" &&
    depot.lon.trim() !== "" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  const overCap = orders?.orders != null && orders.orders > caps.maxOrders
  const missing = [!depotReady && "the depot", !orders && "an orders CSV", !inventory && "an inventory CSV"].filter(
    Boolean
  ) as string[]

  // Pasting "35.1495, -90.049" into either coordinate fills both.
  function setCoordinate(key: "lat" | "lon", value: string) {
    const pair = value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/)
    setDepot(pair ? { ...depot, lat: pair[1], lon: pair[2] } : { ...depot, [key]: value })
  }

  async function run(kind: "example" | "upload") {
    const t0 = performance.now()
    setBusy(true)
    setStarted(t0)
    setElapsed(0)
    setError(null)
    setOutcome(null)
    setWorkspace("results")
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    requestAnimationFrame(() =>
      results.current?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      })
    )
    try {
      const name = orders?.name.replace(/\.csv$/i, "") || "My scenario"
      const body =
        kind === "example"
          ? { example: "lesson" }
          : {
              import: {
                name,
                depot: { id: "depot", label: depot.label.trim(), lat, lon },
                ordersCsv: orders?.text,
                inventoryCsv: inventory?.text,
              },
            }
      const res = await fetch("/api/v1/playground", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (res.ok)
        setOutcome({
          summary: data.summary,
          seconds: (performance.now() - t0) / 1000,
        })
      else setError(data?.error?.message ?? `The run failed (HTTP ${res.status}).`)
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid flex-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside aria-label="Scenario setup" className="bg-background border-b lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Scenario setup</h2>
          <FileSpreadsheet aria-hidden="true" className="text-muted-foreground size-4" />
        </div>
        <Tabs value={source} onValueChange={(v) => setSource(String(v))} className="gap-4 p-4">
          <TabsList className="w-full" size="sm">
            <TabsTab value="sample" disabled={busy}>
              Sample data
            </TabsTab>
            <TabsTab value="upload" disabled={busy}>
              Your files
            </TabsTab>
          </TabsList>
          <TabsPanel value="sample" className="flex flex-col gap-4">
            <div className="rounded-md border">
              <div className="bg-muted/40 flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
                <MapPin aria-hidden="true" className="text-info-foreground size-4" />
                {example.depot}
              </div>
              <div className="p-3">
                <p className="text-sm font-medium">Scarce-stock scenario</p>
                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                  Synthetic orders across {count(example.locations)} stops. Stock runs short on{" "}
                  {example.stock.filter((p) => p.available < p.ordered).length} of {example.products} products.
                </p>
              </div>
              <dl className="grid grid-cols-2 border-t">
                {[
                  ["Orders", example.orders],
                  ["Order lines", example.lines],
                  ["Stops", example.locations],
                  ["Products", example.products],
                ].map(([label, value], i) => (
                  <div key={label} className={cn("px-3 py-2", i % 2 && "border-l", i >= 2 && "border-t")}>
                    <dt className="text-muted-foreground text-xs">{label}</dt>
                    <dd className="font-mono text-lg tabular-nums">{count(value as number)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <Button onClick={() => run("example")} disabled={busy} className="w-full">
              <Play aria-hidden="true" /> Run the sample
            </Button>
          </TabsPanel>
          <TabsPanel value="upload" className="flex flex-col gap-4">
            <p className="text-muted-foreground text-xs leading-relaxed">
              Upload orders and available stock. Each order line needs latitude and longitude.
            </p>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-sm font-medium">Depot</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field className="col-span-2 min-w-0 items-stretch gap-1.5">
                  <FieldLabel className="text-muted-foreground text-xs font-normal">Name</FieldLabel>
                  <Input
                    placeholder="Memphis DC"
                    value={depot.label}
                    onChange={(e) => setDepot({ ...depot, label: e.target.value })}
                  />
                </Field>
                <Field className="min-w-0 items-stretch gap-1.5">
                  <FieldLabel className="text-muted-foreground text-xs font-normal">Latitude</FieldLabel>
                  <Input
                    inputMode="decimal"
                    placeholder="35.1495"
                    value={depot.lat}
                    onChange={(e) => setCoordinate("lat", e.target.value)}
                  />
                </Field>
                <Field className="min-w-0 items-stretch gap-1.5">
                  <FieldLabel className="text-muted-foreground text-xs font-normal">Longitude</FieldLabel>
                  <Input
                    inputMode="decimal"
                    placeholder="-90.049"
                    value={depot.lon}
                    onChange={(e) => setCoordinate("lon", e.target.value)}
                  />
                </Field>
              </div>
              <p className="text-muted-foreground text-xs">
                Tip: paste &ldquo;35.1495, -90.049&rdquo; into either coordinate to fill both.
              </p>
            </fieldset>

            <div className="grid gap-3">
              <CsvDrop
                label="Orders"
                kind="orders"
                hint="One row per order line, with coordinates"
                file={orders}
                onFile={setOrders}
              />
              <CsvDrop
                label="Inventory"
                kind="inventory"
                hint="Available pieces per product"
                file={inventory}
                onFile={setInventory}
              />
            </div>

            {overCap && (
              <Alert variant="warning">
                <AlertTitle>Too many orders for the playground</AlertTitle>
                <AlertDescription>
                  {orders?.name} has {count(orders?.orders ?? 0)} orders; the playground runs up to{" "}
                  {count(caps.maxOrders)}. Trim the file, or run Fillrate locally for larger scenarios.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Button className="w-full" onClick={() => run("upload")} disabled={busy || missing.length > 0 || overCap}>
                <Play aria-hidden="true" /> Run your files
              </Button>
              {missing.length > 0 && (
                <span className="text-muted-foreground text-xs">
                  Add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")} to run.
                </span>
              )}
            </div>
          </TabsPanel>
        </Tabs>
        <section aria-labelledby="run-configuration" className="hidden border-t p-4 lg:block">
          <h3 id="run-configuration" className="mb-3 text-sm font-semibold">
            Run configuration
          </h3>
          <dl className="space-y-2 text-xs">
            {[
              ["Trailer capacity", "53 ft"],
              ["Max leg", "500 mi"],
              ["Clustering", source === "sample" ? `k-means / k = ${example.k ?? "auto"}` : "k-means / auto k"],
              ["Objective", "Fewest trucks, then miles"],
              ["Solve per cluster", `${caps.clusterSolveSeconds} s`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-4 border-t pt-3 text-xs leading-relaxed">
            One run at a time. Data and results stay in this tab. Run locally to save scenarios and tune the solver.
          </p>
        </section>
        <details className="border-t p-4 lg:hidden">
          <summary className="cursor-pointer text-xs font-medium">
            Run configuration / 53 ft trailers / 500 mi legs
          </summary>
          <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
            k-means ({source === "sample" ? `k = ${example.k ?? "auto"}` : "auto k"}). Fewest trucks, then miles. Up to{" "}
            {caps.clusterSolveSeconds} s per cluster. One run at a time; nothing saved.
          </p>
        </details>
      </aside>
      <section
        ref={results}
        aria-label="Planning workspace"
        className="min-h-[calc(100dvh-3rem)] min-w-0 scroll-mt-4 lg:min-h-0"
      >
        <Tabs value={workspace} onValueChange={(v) => setWorkspace(String(v))} className="gap-0">
          <div className="bg-background flex min-h-12 flex-wrap items-center justify-between gap-2 border-b px-4">
            <TabsList variant="underline" size="sm">
              <TabsTab value="inputs">Inputs</TabsTab>
              <TabsTab value="results">Results{outcome ? " (1)" : ""}</TabsTab>
            </TabsList>
            <span
              role="status"
              aria-live="polite"
              className={cn(
                "flex items-center gap-1.5 py-2 text-xs",
                busy ? "text-info-foreground" : outcome ? "text-success-foreground" : "text-muted-foreground"
              )}
            >
              {busy ? (
                <Spinner className="size-3" />
              ) : outcome ? (
                <Check className="size-3" />
              ) : (
                <CircleDot className="size-3" />
              )}
              {busy ? "Solving" : outcome ? `Solved in ${outcome.seconds.toFixed(1)} s` : "Not run yet"}
            </span>
          </div>
          <TabsPanel value="inputs" className="p-4 sm:p-5">
            {source === "sample" ? (
              <SampleInputs example={example} />
            ) : (
              <div className="bg-background rounded-md border p-5">
                <h2 className="text-sm font-semibold">Your input files</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  {[
                    ["Depot", depotReady ? depot.label : "Add a depot"],
                    ["Orders", orders ? `${orders.name} / ${count(orders.rows)} rows` : "No file loaded"],
                    ["Inventory", inventory ? `${inventory.name} / ${count(inventory.rows)} rows` : "No file loaded"],
                  ].map(([label, value]) => (
                    <div key={label} className="grid gap-1 border-b pb-3 sm:grid-cols-[100px_1fr]">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-muted-foreground mt-4 text-xs">
                  Files are validated when you run. Results appear in the Results tab.
                </p>
              </div>
            )}
          </TabsPanel>
          <TabsPanel value="results" className="flex flex-col gap-4 p-4 sm:p-5">
            {busy ? (
              <div className="bg-background rounded-md border p-5" role="status" aria-live="polite">
                <div className="flex items-center gap-3">
                  <Spinner className="text-info-foreground size-4" />
                  <h2 className="text-sm font-semibold">Building truckloads</h2>
                  <span className="text-muted-foreground ml-auto font-mono text-xs">
                    {Math.floor(elapsed)} s / {caps.solveSeconds} s
                  </span>
                </div>
                <div className="bg-muted my-4 h-1 overflow-hidden rounded-full">
                  <div
                    className="bg-info h-full transition-[width] duration-200 motion-reduce:transition-none"
                    style={{
                      width: `${Math.min(100, (elapsed / caps.solveSeconds) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-muted-foreground text-xs">
                  Allocating stock, clustering stops and solving routes. Each cluster gets up to{" "}
                  {caps.clusterSolveSeconds} s. Results appear when the full run finishes.
                </p>
              </div>
            ) : error ? (
              <Alert variant="error">
                <AlertTitle>The run did not finish</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : outcome ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold">{outcome.summary.scenario_name}</h2>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => run(source === "sample" ? "example" : "upload")}
                    disabled={source === "upload" && (missing.length > 0 || overCap)}
                  >
                    <RotateCcw aria-hidden="true" /> Run again
                  </Button>
                </div>
                <Results summary={outcome.summary} runId={null} geo={geo} />
              </>
            ) : (
              <div className="bg-background flex min-h-64 flex-col items-center justify-center gap-3 rounded-md border p-6 text-center">
                <Truck aria-hidden="true" className="text-muted-foreground size-8" />
                <h2 className="text-sm font-semibold">No loads planned yet</h2>
                <p className="text-muted-foreground max-w-sm text-xs leading-relaxed">
                  Run the sample or your files. Inspect trailer fill, routes, stock allocation and every line that did
                  not ship.
                </p>
              </div>
            )}
          </TabsPanel>
        </Tabs>
      </section>
    </div>
  )
}

function SampleInputs({ example }: { example: Example }) {
  const minLat = Math.min(...example.points.map((p) => p.lat), example.origin.lat)
  const maxLat = Math.max(...example.points.map((p) => p.lat), example.origin.lat)
  const minLon = Math.min(...example.points.map((p) => p.lon), example.origin.lon)
  const maxLon = Math.max(...example.points.map((p) => p.lon), example.origin.lon)
  const x = (lon: number) => 35 + ((lon - minLon) / Math.max(0.01, maxLon - minLon)) * 530
  const y = (lat: number) => 250 - ((lat - minLat) / Math.max(0.01, maxLat - minLat)) * 220
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{example.depot} / Input inspection</h2>
        <span className="text-muted-foreground text-xs">Bundled synthetic data</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <section aria-labelledby="stop-distribution" className="bg-background overflow-hidden rounded-md border">
          <div className="flex items-center justify-between border-b px-3 py-2.5">
            <h3 id="stop-distribution" className="text-xs font-semibold">
              Stop distribution
            </h3>
            <span className="text-muted-foreground font-mono text-xs">{count(example.locations)} stops</span>
          </div>
          <svg
            viewBox="0 0 600 285"
            role="img"
            aria-label={`${example.locations} delivery locations plotted by longitude and latitude, with the Memphis depot marked by a cross`}
            className="bg-muted/20 w-full"
          >
            {[35, 141, 247, 353, 459, 565].map((v) => (
              <line key={`x${v}`} x1={v} x2={v} y1="30" y2="250" className="stroke-border" />
            ))}
            {[30, 85, 140, 195, 250].map((v) => (
              <line key={`y${v}`} x1="35" x2="565" y1={v} y2={v} className="stroke-border" />
            ))}
            {example.points.map((p, i) => (
              <circle key={i} cx={x(p.lon)} cy={y(p.lat)} r="2.3" className="fill-info opacity-65" />
            ))}
            <path
              d={`M ${x(example.origin.lon) - 7} ${y(example.origin.lat)} h 14 M ${x(example.origin.lon)} ${y(example.origin.lat) - 7} v 14`}
              className="stroke-foreground"
              strokeWidth="2.5"
            />
            <text x="35" y="18" className="fill-muted-foreground font-mono text-[10px]">
              {maxLat.toFixed(2)}° latitude
            </text>
            <text x="35" y="273" className="fill-muted-foreground font-mono text-[10px]">
              {minLon.toFixed(2)}°
            </text>
            <text x="565" y="273" textAnchor="end" className="fill-muted-foreground font-mono text-[10px]">
              {maxLon.toFixed(2)}° longitude
            </text>
          </svg>
          <div className="text-muted-foreground flex flex-wrap items-center gap-4 border-t px-3 py-2 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="bg-info size-1.5 rounded-full" />
              Delivery location
            </span>
            <span>+ Depot</span>
            <span className="ml-auto">Unclustered / no routes yet</span>
          </div>
        </section>
        <section aria-labelledby="stock-coverage" className="bg-background rounded-md border">
          <div className="border-b px-3 py-2.5">
            <h3 id="stock-coverage" className="text-xs font-semibold">
              Available stock / demand
            </h3>
          </div>
          <div className="divide-y px-3">
            {example.stock.map((p) => (
              <div key={p.id} className="py-2">
                <div className="flex justify-between gap-2 text-xs">
                  <span className="font-medium">{p.label}</span>
                  <span
                    className={cn(
                      "font-mono",
                      p.available < p.ordered ? "text-warning-foreground" : "text-success-foreground"
                    )}
                  >
                    {Math.round((p.available / Math.max(1, p.ordered)) * 100)}%
                  </span>
                </div>
                <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-sm">
                  <div
                    className={cn("h-full", p.available < p.ordered ? "bg-warning" : "bg-success")}
                    style={{
                      width: `${Math.min(100, (p.available / Math.max(1, p.ordered)) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-muted-foreground mt-1.5 text-[11px] tabular-nums">
                  {count(p.available)} available / {count(p.ordered)} ordered pieces
                </p>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section aria-labelledby="order-preview" className="bg-background overflow-hidden rounded-md border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2.5">
          <h3 id="order-preview" className="text-xs font-semibold">
            Open orders
          </h3>
          <span className="text-muted-foreground text-[11px]">
            First {example.preview.length} of {count(example.orders)} orders
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {["Order", "Date", "Destination", "Pieces", "Net value"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-normal last:text-right">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {example.preview.map((o) => (
                <tr key={o.id} className="hover:bg-muted/30">
                  <td className="px-3 py-2 font-mono">{o.id}</td>
                  <td className="text-muted-foreground px-3 py-2 tabular-nums">{o.date}</td>
                  <td className="px-3 py-2 font-mono">{o.location}</td>
                  <td className="px-3 py-2 tabular-nums">{count(o.pieces)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {(o.value / 100).toLocaleString("en-US", {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: 0,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs">
        <span className="flex items-center gap-2">
          <Truck aria-hidden="true" className="size-4" />
          No shipments yet
        </span>
        <span>Allocate → Cluster → Build loads → Validate</span>
        <span className="lg:ml-auto">Run the sample to inspect the plan</span>
      </div>
    </div>
  )
}
