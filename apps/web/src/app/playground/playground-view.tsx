"use client"

import type { RunSummary } from "@fillrate/contracts"
import { ArrowRight, FileSpreadsheet, Upload, X } from "lucide-react"
import { useEffect, useRef, useState, type ReactNode } from "react"

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
  orders: "order_id,line_id,order_date,customer_id,location_id,location_label,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece,priority\nO-1,L-1,2026-09-30,ACME,C-1,Customer 1,35.1,-90.1,SKU-1,10,12.50,1.25,1\nO-2,L-2,2026-09-30,Beta,C-2,Customer 2,35.3,-89.8,SKU-1,4,12.50,1.25,1\n",
  inventory: "product,available_pieces\nSKU-1,100\n",
}
const LIMIT = 5_000_000
const count = (n: number) => n.toLocaleString("en-US")

type Caps = { maxOrders: number; solveSeconds: number; clusterSolveSeconds: number }
type Example = { name: string; orders: number; lines: number; locations: number; products: number; depot: string }
type Csv = { name: string; size: number; text: string; rows: number; orders: number | null }
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
  return { rows: Math.max(0, rows.length - 1), orders: at < 0 ? null : new Set(rows.slice(1).map((row) => row.split(",")[at])).size }
}

const kb = (bytes: number) => (bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`)

/** A full-bleed section: heading in a 0.7fr column, content in 1.3fr; `stacked` puts wide content under the heading. */
function Section({ id, title, description, stacked, children, ref }: { id: string; title: ReactNode; description?: ReactNode; stacked?: boolean; children: ReactNode; ref?: React.Ref<HTMLElement> }) {
  return (
    <section ref={ref} aria-labelledby={id} className="scroll-mt-14 border-b last:border-b-0">
      <div className={cn("mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 sm:py-24", !stacked && "md:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] md:gap-16")}>
        <div className="flex flex-col gap-3">
          <h2 id={id} className="text-3xl leading-tight font-medium tracking-[-0.04em] sm:text-4xl">{title}</h2>
          {description && <div className={cn("text-muted-foreground text-sm leading-relaxed", stacked ? "max-w-2xl" : "max-w-sm")}>{description}</div>}
        </div>
        <div className="flex min-w-0 flex-col gap-6">{children}</div>
      </div>
    </section>
  )
}

function Lead({ strong, children }: { strong: string; children: ReactNode }) {
  return (
    <p className="text-xl leading-snug font-medium tracking-[-0.025em] text-pretty sm:text-[1.625rem]">
      {strong} <span className="text-muted-foreground">{children}</span>
    </p>
  )
}

function CsvDrop({ label, kind, hint, file, onFile }: { label: string; kind: keyof typeof templates; hint: string; file: Csv | null; onFile: (file: Csv | null) => void }) {
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

  const detail = file && [`${count(file.rows)} ${file.rows === 1 ? "row" : "rows"}`, file.orders != null && `${count(file.orders)} orders`, kb(file.size)].filter(Boolean).join(" · ")

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <button type="button" onClick={() => download(`${kind}-template.csv`, templates[kind])} className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-xs underline decoration-foreground/20 underline-offset-4 transition-colors hover:decoration-foreground/60 focus-visible:ring-2 focus-visible:outline-none">
          Template
        </button>
      </div>
      <div className="relative">
        <label
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void take(e.dataTransfer.files[0]) }}
          className={cn(
            "has-focus-visible:ring-ring flex min-h-28 cursor-pointer items-center gap-4 rounded-xl border p-4 transition-colors has-focus-visible:ring-2",
            file ? "bg-card border-solid" : "border-dashed hover:border-foreground/25 hover:bg-accent/30",
            dragging && "border-foreground/40 bg-accent/50",
          )}
        >
          <input ref={input} type="file" accept=".csv,text/csv" aria-label={`${label} file`} className="sr-only" onChange={(e) => void take(e.target.files?.[0])} />
          <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg border", file ? "bg-muted text-foreground" : "text-muted-foreground")}>
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
                <span className="text-sm"><span className="font-medium">Drop a CSV</span> <span className="text-muted-foreground">or browse</span></span>
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
            onClick={() => { onFile(null); if (input.current) input.current.value = "" }}
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

  const lat = Number(depot.lat), lon = Number(depot.lon)
  const depotReady = depot.label.trim() !== "" && depot.lat.trim() !== "" && depot.lon.trim() !== "" && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  const overCap = orders?.orders != null && orders.orders > caps.maxOrders
  const missing = [!depotReady && "the depot", !orders && "an orders CSV", !inventory && "an inventory CSV"].filter(Boolean) as string[]

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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    requestAnimationFrame(() => results.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" }))
    try {
      const name = orders?.name.replace(/\.csv$/i, "") || "My scenario"
      const body = kind === "example"
        ? { example: "lesson" }
        : { import: { name, depot: { id: "depot", label: depot.label.trim(), lat, lon }, ordersCsv: orders?.text, inventoryCsv: inventory?.text } }
      const res = await fetch("/api/v1/playground", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => null)
      if (res.ok) setOutcome({ summary: data.summary, seconds: (performance.now() - t0) / 1000 })
      else setError(data?.error?.message ?? `The run failed (HTTP ${res.status}).`)
    } catch {
      setError("Could not reach the server. Check your connection and try again.")
    } finally {
      setBusy(false)
    }
  }

  const primary = "h-10 gap-2.5 rounded-full pr-2 pl-5"
  const arrow = (
    <span className="bg-primary-foreground/10 flex size-6 items-center justify-center rounded-full">
      <ArrowRight aria-hidden="true" className="size-3.5" />
    </span>
  )

  return (
    <>
      <Section id="data" title="Data" description="Start with the sample, or bring your own orders and stock as CSV files.">
        <Tabs defaultValue="sample" className="gap-8">
          <TabsList className="self-start">
            <TabsTab value="sample" className="px-3">Sample data</TabsTab>
            <TabsTab value="upload" className="px-3">Your files</TabsTab>
          </TabsList>

          <TabsPanel value="sample" className="flex flex-col gap-8">
            <Lead strong={`${count(example.orders)} synthetic orders out of ${example.depot}.`}>
              Stock runs short on {example.products} products, so allocation has to choose what ships before the stops are clustered and loaded onto trucks.
            </Lead>
            <dl className="bg-card grid grid-cols-2 overflow-hidden rounded-xl border sm:grid-cols-4">
              {[["Orders", example.orders], ["Order lines", example.lines], ["Stops", example.locations], ["Products", example.products]].map(([label, value], i) => (
                <div key={label} className={cn("flex flex-col gap-1 p-4", i % 2 === 1 && "border-l", i >= 2 && "border-t sm:border-t-0", i === 2 && "sm:border-l")}>
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="font-mono text-xl tabular-nums">{count(value as number)}</dd>
                </div>
              ))}
            </dl>
            <div>
              <Button className={primary} onClick={() => run("example")} disabled={busy}>
                Run the sample{arrow}
              </Button>
            </div>
          </TabsPanel>

          <TabsPanel value="upload" className="flex flex-col gap-8">
            <Lead strong="Bring an orders CSV and an inventory CSV.">
              Every order line needs a latitude and longitude, since the playground doesn&rsquo;t geocode addresses.
            </Lead>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 text-sm font-medium">Depot</legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <Field className="col-span-2 min-w-0 items-stretch gap-1.5 sm:col-span-1">
                  <FieldLabel className="text-muted-foreground text-xs font-normal">Name</FieldLabel>
                  <Input placeholder="Memphis DC" value={depot.label} onChange={(e) => setDepot({ ...depot, label: e.target.value })} />
                </Field>
                <Field className="min-w-0 items-stretch gap-1.5">
                  <FieldLabel className="text-muted-foreground text-xs font-normal">Latitude</FieldLabel>
                  <Input inputMode="decimal" placeholder="35.1495" value={depot.lat} onChange={(e) => setCoordinate("lat", e.target.value)} />
                </Field>
                <Field className="min-w-0 items-stretch gap-1.5">
                  <FieldLabel className="text-muted-foreground text-xs font-normal">Longitude</FieldLabel>
                  <Input inputMode="decimal" placeholder="-90.049" value={depot.lon} onChange={(e) => setCoordinate("lon", e.target.value)} />
                </Field>
              </div>
              <p className="text-muted-foreground text-xs">Tip: paste &ldquo;35.1495, -90.049&rdquo; into either coordinate to fill both.</p>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <CsvDrop label="Orders" kind="orders" hint="One row per order line, with coordinates" file={orders} onFile={setOrders} />
              <CsvDrop label="Inventory" kind="inventory" hint="Available pieces per product" file={inventory} onFile={setInventory} />
            </div>

            {overCap && (
              <Alert variant="warning">
                <AlertTitle>Too many orders for the playground</AlertTitle>
                <AlertDescription>
                  {orders?.name} has {count(orders?.orders ?? 0)} orders; the playground runs up to {count(caps.maxOrders)}. Trim the file, or run Fillrate locally for larger scenarios.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Button className={primary} onClick={() => run("upload")} disabled={busy || missing.length > 0 || overCap}>
                Run your files{arrow}
              </Button>
              {missing.length > 0 && <span className="text-muted-foreground text-sm">Add {missing.join(", ").replace(/, ([^,]*)$/, " and $1")} to run.</span>}
            </div>
          </TabsPanel>
        </Tabs>
      </Section>

      <Section
        ref={results}
        id="results"
        stacked
        title="Results"
        description={outcome ? `${outcome.summary.scenario_name} · solved in ${outcome.seconds.toFixed(1)} s` : undefined}
      >
        {busy ? (
          <div className="bg-card flex flex-col gap-4 rounded-xl border p-6" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
              <Spinner className="size-4" />
              <span className="text-sm font-medium">Solving</span>
              <span className="text-muted-foreground ml-auto font-mono text-xs tabular-nums">{Math.floor(elapsed)} s / {caps.solveSeconds} s</span>
            </div>
            <div className="bg-muted h-1 overflow-hidden rounded-full">
              <div className="bg-foreground h-full rounded-full transition-[width] duration-200" style={{ width: `${Math.min(100, (elapsed / caps.solveSeconds) * 100)}%` }} />
            </div>
            <p className="text-muted-foreground text-sm">Allocating stock, clustering stops and building truckloads. Each cluster gets up to {caps.clusterSolveSeconds} s of solver time.</p>
          </div>
        ) : error ? (
          <Alert variant="error">
            <AlertTitle>The run did not finish</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : outcome ? (
          <Results summary={outcome.summary} runId={null} geo={geo} />
        ) : (
          <div className="text-muted-foreground flex min-h-40 items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm">
            Run the sample or your files to see shipments, trailer fill and the cluster map here.
          </div>
        )}
      </Section>
    </>
  )
}
