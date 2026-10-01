"use client"

import { Check, ChevronDown, LayoutPanelTop, Share } from "lucide-react"
import dynamic from "next/dynamic"
import { useState } from "react"
import { useGroupRef } from "react-resizable-panels"

import { ClusterCard } from "@/components/lab/cluster-card"
import { DataTable } from "@/components/lab/data-table"
import { JobStatusBadge } from "@/components/lab/job-status"
import { ClusterSwatch, TruckTag } from "@/components/lab/route-swatch"
import { FillBandLegend, FillMeter, ShipmentFill } from "@/components/lab/trailer-fill"
import { TruckLoad } from "@/components/lab/truck-load"
import { UnshippedLines } from "@/components/lab/unshipped-lines"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { FILL_LOW, fillBand, formatCount, formatMiles, formatMoney, formatPercent, plural } from "@/lib/units"

import { baseline, depot, lookups } from "../fixtures"
import { orderRows } from "../fixtures/order-rows"
import { orderColumns } from "../order-columns"
import { AppShell, RunPipelineButton, type Section } from "./shell"

type BottomTab = "loads" | "orders" | "unshipped"

// Named workspace presets: the same run and selection, with more room for the view the task needs.
const presets = [
  { id: "planning", label: "Planning", hint: "Map first, order lines below", map: 65, tab: "orders" },
  { id: "loading", label: "Loading", hint: "Truck loads get the room", map: 40, tab: "loads" },
  { id: "analysis", label: "Analysis", hint: "Tables first, map for context", map: 30, tab: "orders" },
] as const satisfies readonly { id: string; label: string; hint: string; map: number; tab: BottomTab }[]

type PresetId = (typeof presets)[number]["id"]

const PipelineMap = dynamic(() => import("../pipeline-map"), { ssr: false, loading: () => <Skeleton className="h-full w-full rounded-none" /> })

// The scenario workbench (spec §4) on the Results section: map, cluster inspector, and the order-lines table.
// Selecting a cluster or stop anywhere selects the same stable ID on the map, cards, and trucks.
export function WorkbenchBlock() {
  const run = baseline()
  const look = lookups(run)
  const [section, setSection] = useState<Section>("Results")
  const [cluster, setCluster] = useState<number | null>(3)
  const [stop, setStop] = useState<string | null>(null)
  const [truck, setTruck] = useState<string | null>(null)
  const [tab, setTab] = useState<BottomTab>("loads")
  const [preset, setPreset] = useState<PresetId>("planning")
  const vertical = useGroupRef()

  const applyPreset = (id: PresetId) => {
    const p = presets.find((x) => x.id === id)!
    setPreset(id)
    setTab(p.tab)
    vertical.current?.setLayout({ map: p.map, bottom: 100 - p.map })
  }

  const c = cluster != null ? run.clusters.find((x) => x.id === cluster) : undefined
  const trucks = c ? run.trucks.filter((t) => t.cluster === c.id).sort((a, b) => b.fill - a.fill) : []
  const openTruck = truck ? look.trucks.get(truck) : undefined
  const rows = orderRows(run).filter((r) => cluster == null || r.cluster === cluster)
  const scopeTrucks = (c ? trucks : [...run.trucks].sort((a, b) => b.fill - a.fill))
  const lowCount = scopeTrucks.filter((t) => fillBand(t.fill) === "low").length
  const lowTrucks = trucks.filter((t) => fillBand(t.fill) === "low")

  const selectStop = (id: string | null) => {
    setStop(id)
    const s = id ? look.stops.get(id) : undefined
    if (s?.truck) setTruck(s.truck)
  }

  return (
    <AppShell
      section={section}
      onSection={setSection}
      actions={
        <>
          <Menu>
            <MenuTrigger render={<Button variant="ghost" size="sm" />}>
              <LayoutPanelTop /> View: {presets.find((p) => p.id === preset)!.label} <ChevronDown className="opacity-60" />
            </MenuTrigger>
            <MenuPopup align="end" className="w-60">
              <MenuGroup>
                <MenuGroupLabel>Workspace preset</MenuGroupLabel>
                {presets.map((p) => (
                  <MenuItem key={p.id} onClick={() => applyPreset(p.id)}>
                    <span className="flex-1">
                      <span className="block">{p.label}</span>
                      <span className="text-muted-foreground block text-xs">{p.hint}</span>
                    </span>
                    {p.id === preset && <Check />}
                  </MenuItem>
                ))}
              </MenuGroup>
            </MenuPopup>
          </Menu>
          <Button variant="ghost" size="sm">
            <Share /> Export
          </Button>
          <RunPipelineButton />
        </>
      }
    >
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel defaultSize="68%">
          <ResizablePanelGroup orientation="vertical" groupRef={vertical}>
            <ResizablePanel id="map" defaultSize="65%" minSize="20%">
              <div className="relative h-full">
                <PipelineMap
                  embedded
                  run={run}
                  selectedCluster={cluster}
                  onSelectCluster={(x) => {
                    setCluster(x)
                    setTruck(null)
                  }}
                  selectedStop={stop}
                  onSelectStop={selectStop}
                />
                <div className="bg-background/90 absolute top-2 left-2 flex items-center gap-2 rounded-lg border px-2 py-1 text-xs shadow-sm backdrop-blur-sm">
                  <JobStatusBadge state="succeeded" />
                  <span className="font-medium">Baseline</span>
                  <span className="font-mono">run-0212</span>
                  <span className="text-muted-foreground">
                    k {run.metrics.k} · {run.metrics.trucks} shipments · {Math.round(run.metrics.avgFill * 100)}% avg trailer fill
                  </span>
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="bottom" defaultSize="35%" minSize="15%">
              <Tabs value={tab} onValueChange={(v) => setTab(v as BottomTab)} className="flex h-full flex-col gap-0">
                <div className="flex items-center gap-3 border-b px-3">
                  <TabsList variant="underline">
                    <TabsTab value="loads">
                      Shipments <Badge variant="secondary" size="sm">{scopeTrucks.length}</Badge>
                    </TabsTab>
                    <TabsTab value="orders">
                      Order lines <Badge variant="secondary" size="sm">{formatCount(rows.length)}</Badge>
                    </TabsTab>
                    <TabsTab value="unshipped">
                      Unshipped <Badge variant="warning" size="sm">{formatCount(run.unshipped.length)}</Badge>
                    </TabsTab>
                  </TabsList>
                  <span className="text-muted-foreground ml-auto truncate text-xs">{c ? `Cluster ${c.id}` : "All clusters"}</span>
                </div>
                <TabsPanel value="loads" className="min-h-0 flex-1">
                  <ScrollArea className="h-full">
                    <div className="text-muted-foreground flex items-center justify-between gap-3 px-3 py-2 text-xs">
                      <span>
                        {plural(scopeTrucks.length, "shipment")}, fullest first ·{" "}
                        <span className={cn(lowCount > 0 && "text-warning-foreground")}>
                          {lowCount} under {formatPercent(FILL_LOW)}
                        </span>
                      </span>
                      <FillBandLegend />
                    </div>
                    <ul className="divide-y border-t">
                      {scopeTrucks.map((t) => (
                        <li key={t.id}>
                          {/* Fill % is the list visual; the to-scale trailer bar is in the shipment detail (design review). */}
                          <button
                            type="button"
                            onClick={() => {
                              setCluster(t.cluster)
                              setTruck(t.id)
                            }}
                            aria-pressed={truck === t.id}
                            className={cn(
                              "hover:bg-muted/50 focus-visible:ring-ring/50 grid w-full cursor-pointer grid-cols-[4.5rem_4.5rem_minmax(0,1fr)_7rem] items-center gap-3 px-3 py-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                              truck === t.id && "bg-muted/70"
                            )}
                          >
                            <TruckTag id={t.id} cluster={t.cluster} />
                            <ShipmentFill fill={t.fill} size="sm" />
                            <span className="text-muted-foreground truncate tabular-nums">
                              {look.stops.get(t.stops[0])?.label}
                              {t.stops.length > 1 && ` → ${look.stops.get(t.stops[t.stops.length - 1])?.label}`}
                            </span>
                            <span className="text-muted-foreground truncate text-right tabular-nums">
                              {plural(t.stops.length, "stop")} · {formatMiles(t.loadedMiles)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                </TabsPanel>
                <TabsPanel value="orders" className="min-h-0 flex-1 overflow-auto">
                  <DataTable
                    key={cluster ?? "all"}
                    columns={orderColumns()}
                    data={rows}
                    pageSize={8}
                    filterPlaceholder={cluster != null ? `Lines in cluster ${cluster}…` : "Filter lines…"}
                    className="bg-card min-h-full rounded-none border-0"
                  />
                </TabsPanel>
                <TabsPanel value="unshipped" className="min-h-0 flex-1 overflow-auto p-3">
                  <UnshippedLines items={run.unshipped} products={look.products} locations={look.locations} pageSize={8} />
                </TabsPanel>
              </Tabs>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="32%" minSize="24%">
          <ScrollArea className="h-full">
            <aside>
              {openTruck ? (
                <>
                  <button type="button" className="text-muted-foreground hover:text-foreground block px-3 py-2 text-xs" onClick={() => setTruck(null)}>
                    ← Cluster {openTruck.cluster} shipments
                  </button>
                  <TruckLoad
                    truck={openTruck}
                    stops={look.stops}
                    lines={look.lines}
                    products={look.products}
                    depotLabel={depot.label}
                    maxLeg={run.settings.maxLegMiles}
                    selectedStop={stop}
                    onSelectStop={selectStop}
                    defaultExpanded={stop ?? undefined}
                    className="rounded-none border-x-0 border-b-0"
                  />
                </>
              ) : c ? (
                <>
                  <ClusterCard
                    cluster={c}
                    trucks={trucks}
                    area={look.clusterArea(c.id)}
                    maxDiameter={run.settings.maxDiameterMiles}
                    className="rounded-none border-0 p-3"
                  />
                  <div className="text-muted-foreground flex items-center justify-between gap-2 border-t px-3 py-2 text-xs">
                    <span className={cn("font-medium", lowTrucks.length ? "text-warning-foreground" : "text-foreground")}>
                      {lowTrucks.length
                        ? `Needs attention · ${plural(lowTrucks.length, "shipment")} under ${formatPercent(FILL_LOW)}`
                        : `Every shipment is ${formatPercent(FILL_LOW)} full or more`}
                    </span>
                    <button type="button" className="hover:text-foreground" onClick={() => setCluster(null)}>
                      All clusters
                    </button>
                  </div>
                  {lowTrucks.length > 0 && (
                    <ul className="divide-y border-t">
                      {lowTrucks.map((t) => (
                        <li key={t.id}>
                          <button
                            type="button"
                            onClick={() => setTruck(t.id)}
                            className="hover:bg-muted/50 grid w-full grid-cols-[auto_minmax(0,1fr)_6.5rem] items-center gap-3 px-3 py-2 text-left text-xs transition-colors"
                          >
                            <TruckTag id={t.id} cluster={t.cluster} />
                            <span className="text-muted-foreground truncate tabular-nums">
                              {plural(t.stops.length, "stop")} · {formatMiles(t.loadedMiles)}
                            </span>
                            <ShipmentFill fill={t.fill} size="sm" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                    <FillBandLegend className="text-[10px]" />
                    <Button variant="ghost" size="xs" onClick={() => setTab("loads")}>
                      All {trucks.length} shipments ↓
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-muted-foreground border-b px-3 py-2 text-xs">
                    {run.clusters.length} clusters · {formatCount(run.metrics.trucks)} shipments · select one
                  </div>
                  {run.clusters.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setCluster(x.id)}
                      className="hover:bg-muted/40 flex w-full items-center gap-3 border-b p-3 text-left text-sm transition-colors"
                    >
                      <ClusterSwatch cluster={x.id} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{look.clusterArea(x.id)}</span>
                        <span className="text-muted-foreground block text-xs tabular-nums">
                          {plural(x.stops.length, "stop")} · {plural(x.trucks.length, "shipment")} · {formatMoney(x.value, { compact: true })}
                        </span>
                      </span>
                      <FillMeter fill={x.avgFill} className="w-28" />
                    </button>
                  ))}
                </>
              )}
            </aside>
          </ScrollArea>
        </ResizablePanel>
      </ResizablePanelGroup>
    </AppShell>
  )
}
