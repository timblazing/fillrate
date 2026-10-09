"use client"

import type { RunSummary } from "@fillrate/contracts"
import { Info } from "lucide-react"
import { useState } from "react"

import { PageSection } from "@/components/app/page"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

import { Results } from "../runs/run-view"
import { useRoadGeometry } from "../runs/road-geometry"

const templates = {
  orders: "order_id,line_id,order_date,customer_id,location_id,location_label,latitude,longitude,product,ordered_pieces,net_value_per_piece,linear_feet_per_piece,priority\nO-1,L-1,2026-09-30,ACME,C-1,Customer 1,35.1,-90.1,SKU-1,10,12.50,1.25,1\nO-2,L-2,2026-09-30,Beta,C-2,Customer 2,35.3,-89.8,SKU-1,4,12.50,1.25,1\n",
  inventory: "product,available_pieces\nSKU-1,100\n",
}
const LIMIT = 5_000_000

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function FileField({ label, kind, loaded, onText, onError }: { label: string; kind: "orders" | "inventory"; loaded: boolean; onText: (text: string) => void; onError: (message: string) => void }) {
  return (
    <Field className="min-w-0 items-stretch gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>{label}</FieldLabel>
        <Button variant="ghost" size="xs" onClick={() => download(`${kind}-template.csv`, templates[kind])}>Download template</Button>
      </div>
      <Input
        aria-label={`${label} file`}
        type="file"
        accept=".csv,text/csv"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return onText("")
          if (file.size > LIMIT) {
            e.target.value = ""
            onText("")
            return onError(`${label} exceeds 5 MB.`)
          }
          onText(await file.text())
        }}
      />
      {loaded && <span className="text-muted-foreground text-xs">Loaded.</span>}
    </Field>
  )
}

export function PlaygroundView({ caps, example }: { caps: { maxOrders: number; solveSeconds: number; clusterSolveSeconds: number }; example: { name: string; orders: number } }) {
  const geo = useRoadGeometry()
  const [busy, setBusy] = useState<"example" | "upload" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [name, setName] = useState("My scenario")
  const [depot, setDepot] = useState({ label: "", lat: "", lon: "" })
  const [ordersCsv, setOrdersCsv] = useState("")
  const [inventoryCsv, setInventoryCsv] = useState("")
  const lat = Number(depot.lat), lon = Number(depot.lon)
  const depotValid = depot.label.trim() !== "" && depot.lat.trim() !== "" && depot.lon.trim() !== "" && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  const uploadReady = depotValid && !!ordersCsv && !!inventoryCsv

  async function run(kind: "example" | "upload") {
    setBusy(kind)
    setError(null)
    setSummary(null)
    try {
      const body = kind === "example" ? { example: "lesson" } : { import: { name: name.trim() || "My scenario", depot: { id: "depot", label: depot.label.trim(), lat, lon }, ordersCsv, inventoryCsv } }
      const res = await fetch("/api/v1/playground", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const data = await res.json().catch(() => null)
      if (res.ok) setSummary(data.summary)
      else setError(data?.error?.message ?? `The run failed (HTTP ${res.status}).`)
    } catch {
      setError("Could not reach the server.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Alert variant="info">
        <Info />
        <AlertTitle>This is a playground</AlertTitle>
        <AlertDescription>
          Nothing is saved. Runs are capped at {caps.maxOrders.toLocaleString("en-US")} orders and {caps.solveSeconds} seconds in total, with at most {caps.clusterSolveSeconds} seconds of solver time per cluster, and one run goes at a time.{" "}
          <a className="underline underline-offset-2" href="https://github.com/timblazing/fillrate#readme" target="_blank" rel="noreferrer">Run it locally for real data.</a>
        </AlertDescription>
      </Alert>

      <PageSection title="Load the example" description={`${example.name} · ${example.orders.toLocaleString("en-US")} orders`}>
        <div>
          <Button onClick={() => run("example")} loading={busy === "example"} disabled={busy !== null}>Load example and run</Button>
        </div>
      </PageSection>

      <PageSection title="Or upload your own" description="An orders CSV with latitude and longitude on every row (the playground doesn't geocode), an inventory CSV, and the depot.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field className="min-w-0 items-stretch gap-1.5"><FieldLabel>Scenario name</FieldLabel><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field className="min-w-0 items-stretch gap-1.5"><FieldLabel>Depot name</FieldLabel><Input placeholder="e.g. Memphis DC" value={depot.label} onChange={(e) => setDepot({ ...depot, label: e.target.value })} /></Field>
          <Field className="min-w-0 items-stretch gap-1.5"><FieldLabel>Depot latitude</FieldLabel><Input type="number" step="any" placeholder="e.g. 35.1495" value={depot.lat} onChange={(e) => setDepot({ ...depot, lat: e.target.value })} /></Field>
          <Field className="min-w-0 items-stretch gap-1.5"><FieldLabel>Depot longitude</FieldLabel><Input type="number" step="any" placeholder="e.g. -90.049" value={depot.lon} onChange={(e) => setDepot({ ...depot, lon: e.target.value })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FileField label="Orders CSV" kind="orders" loaded={!!ordersCsv} onText={setOrdersCsv} onError={setError} />
          <FileField label="Inventory CSV" kind="inventory" loaded={!!inventoryCsv} onText={setInventoryCsv} onError={setError} />
        </div>
        <div>
          <Button onClick={() => run("upload")} loading={busy === "upload"} disabled={busy !== null || !uploadReady}>Run upload</Button>
        </div>
      </PageSection>

      {error && (
        <Alert variant="error">
          <AlertTitle>The run did not finish</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {summary && <Results summary={summary} runId={null} geo={geo} />}
    </>
  )
}
