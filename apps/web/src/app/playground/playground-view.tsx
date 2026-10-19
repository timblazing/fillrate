"use client"

import type { RunSummary } from "@fillrate/contracts"
import { MapPin, SlidersHorizontal, Truck } from "lucide-react"
import { useState } from "react"

import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { formatMoney, formatPercent, formatMiles } from "@/lib/units"
import { METERS_PER_MILE } from "@/lib/shipment-sheet"
import { cn } from "@/lib/utils"

import { Results } from "../(app)/runs/run-view"
import { useRoadGeometry } from "../(app)/runs/road-geometry"

const count = (n: number) => n.toLocaleString("en-US")

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

export function PlaygroundView({ example, sample }: { example: Example; sample: RunSummary }) {
  const [workspace, setWorkspace] = useState("map")

  return (
    <div className="grid flex-1 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside aria-label="Scenario summary" className="bg-background border-b lg:border-r lg:border-b-0">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4 text-sm font-semibold">
          <MapPin aria-hidden="true" className="text-info-foreground size-4 shrink-0" />
          <span className="truncate">{example.depot}</span>
        </div>
        <div className="flex flex-col gap-4 p-4">
          <div className="hidden lg:block">
            <p className="text-sm font-medium">Scarce-stock scenario</p>
            <p className="text-muted-foreground mt-1 text-xs">Bundled synthetic data</p>
          </div>
          <dl className="hidden grid-cols-2 overflow-hidden rounded-md border lg:grid">
            {[
              ["Orders", count(example.orders)], ["Order lines", count(example.lines)],
              ["Stops", count(example.locations)], ["Products", count(example.products)],
            ].map(([label, value], i) => <div key={label} className={cn("min-w-0 px-3 py-2", i % 2 && "border-l", i >= 2 && "border-t")}>
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="mt-1 font-mono text-lg tabular-nums">{value}</dd>
            </div>)}
          </dl>
          <PlanSummary summary={sample} />
          <span className="text-muted-foreground hidden text-xs lg:block">Precomputed sample plan</span>
        </div>
        <details className="hidden border-t p-4 lg:block">
          <summary className="mb-3 flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <SlidersHorizontal aria-hidden="true" className="size-4" /> Run settings
          </summary>
          <dl className="space-y-2 text-xs">
            {[
              ["Trailer capacity", "53 ft"],
              ["Max leg", "500 mi"],
              ["Clustering", `k-means / k = ${example.k ?? "auto"}`],
              ["Objective", "Fewest trucks, then miles"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-right tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-4 border-t pt-3 text-xs leading-relaxed">Run Fillrate locally to use your own data and tune these settings.</p>
        </details>
      </aside>
      <section aria-label="Planning workspace" className="min-h-[calc(100dvh-3rem)] min-w-0 lg:min-h-0">
        <Tabs value={workspace} onValueChange={(v) => setWorkspace(String(v))} className="gap-0">
          <div className="bg-background flex h-14 min-w-0 items-center border-b px-4">
            <div className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList variant="underline" size="sm">
                <TabsTab value="inputs">Inputs</TabsTab>
                <TabsTab value="map">Map</TabsTab>
                <TabsTab value="shipments">Shipments ({sample.trucks.length})</TabsTab>
                <TabsTab value="timeline">Timeline</TabsTab>
                <TabsTab value="unshipped">Unshipped</TabsTab>
                <TabsTab value="stock">Stock</TabsTab>
                <TabsTab value="provenance" className="text-muted-foreground">Details</TabsTab>
              </TabsList>
            </div>
          </div>
        {workspace === "inputs" ? (
          <TabsPanel value="inputs" className="p-4 sm:p-5">
            <SampleInputs example={example} />
          </TabsPanel>
        ) : <div className="flex flex-col gap-4 p-4 sm:p-5">
            <PlaygroundResults summary={sample} tab={workspace} onTabChange={setWorkspace} />
          </div>}
        </Tabs>
      </section>
    </div>
  )
}

function PlaygroundResults({ summary, tab, onTabChange }: {
  summary: RunSummary
  tab: string
  onTabChange: (tab: string) => void
}) {
  const geo = useRoadGeometry()
  return <Results summary={summary} runId={null} geo={geo} compact activeTab={tab} onTabChange={onTabChange} />
}

function PlanSummary({ summary }: { summary: RunSummary }) {
  const metrics = <dl className="space-y-2 text-xs">
    {[
      ["Planned revenue", formatMoney(summary.totals.planned_cents)],
      ["Shipments", count(summary.trucks.length)],
      ["Average fill", summary.totals.avg_fill == null ? "—" : formatPercent(summary.totals.avg_fill)],
      ["Estimated miles", formatMiles(summary.totals.loaded_distance_m / METERS_PER_MILE)],
    ].map(([label, value]) => <div key={label} className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>)}
  </dl>
  const partial = summary.coverage === "partial"
  const invalid = summary.validity === "invalid"
  const empty = summary.coverage === "empty"
  return <section aria-label="Plan summary" className="space-y-3 lg:border-t lg:pt-4">
    <div role="status" title={invalid ? "Some clusters have no validated shipments." : partial ? "Some allocated stock could not be shipped. See Unshipped for the reasons." : empty ? "No allocated stock reached a stop." : "Every allocated piece is on a validated shipment. Shipment count and miles are heuristic estimates, not proven optimal."} className={cn("rounded-md border px-3 py-2 text-xs font-medium", invalid ? "border-destructive-foreground/30 text-destructive-foreground" : partial || empty ? "border-warning-foreground/30 text-warning-foreground" : "border-success-foreground/30 text-success-foreground")}>
      {invalid ? "Invalid plan" : partial ? "Validated, partial coverage" : empty ? "Nothing to ship" : "Validated, complete"}
      {(invalid || partial) && <p className="mt-1 font-normal">See Unshipped and Details.</p>}
    </div>
    <div className="hidden lg:block">{metrics}</div>
    <details className="lg:hidden">
      <summary className="text-muted-foreground cursor-pointer text-xs">Plan details</summary>
      <div className="mt-3">{metrics}</div>
    </details>
  </section>
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
