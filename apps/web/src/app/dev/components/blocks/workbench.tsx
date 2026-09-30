"use client"

import dynamic from "next/dynamic"
import { useState } from "react"

import { ClusterCard } from "@/components/lab/cluster-card"
import { DataTable } from "@/components/lab/data-table"
import { JobStatusBadge } from "@/components/lab/job-status"
import { ClusterSwatch, TruckTag } from "@/components/lab/route-swatch"
import { FillMeter } from "@/components/lab/trailer-fill"
import { TruckLoad } from "@/components/lab/truck-load"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCount, formatMiles, formatMoney } from "@/lib/units"
import { cn } from "@/lib/utils"

import { baseline, depot, lookups } from "../fixtures"
import { orderRows } from "../fixtures/order-rows"
import { orderColumns } from "../order-columns"
import { AppShell, type Section } from "./shell"

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

  const c = cluster != null ? run.clusters.find((x) => x.id === cluster) : undefined
  const trucks = c ? run.trucks.filter((t) => t.cluster === c.id).sort((a, b) => b.fill - a.fill) : []
  const openTruck = truck ? look.trucks.get(truck) : undefined
  const rows = orderRows(run).filter((r) => cluster == null || r.cluster === cluster)

  const selectStop = (id: string | null) => {
    setStop(id)
    const s = id ? look.stops.get(id) : undefined
    if (s?.truck) setTruck(s.truck)
  }

  return (
    <AppShell section={section} onSection={setSection}>
      <ResizablePanelGroup orientation="horizontal" className="h-full">
        <ResizablePanel defaultSize="68%">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel defaultSize="60%">
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
                  <span className="font-mono">run-0212</span>
                  <span className="text-muted-foreground">
                    k {run.metrics.k} · {run.metrics.trucks} trucks · {Math.round(run.metrics.avgFill * 100)}% avg fill
                  </span>
                </div>
              </div>
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel defaultSize="40%">
              <div className="h-full overflow-auto p-2">
                <DataTable
                  key={cluster ?? "all"}
                  columns={orderColumns}
                  data={rows}
                  pageSize={8}
                  filterPlaceholder={cluster != null ? `Lines in cluster ${cluster}…` : "Filter lines…"}
                  className="bg-card"
                />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle />
        <ResizablePanel defaultSize="32%" minSize="24%">
          <ScrollArea className="h-full">
            <aside className="space-y-3 p-3">
              {openTruck ? (
                <>
                  <button type="button" className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setTruck(null)}>
                    ← Cluster {openTruck.cluster} trucks
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
                  />
                </>
              ) : c ? (
                <>
                  <ClusterCard
                    cluster={c}
                    trucks={trucks}
                    area={look.clusterArea(c.id)}
                    maxDiameter={run.settings.maxDiameterMiles}
                    selected
                  />
                  <div className="text-muted-foreground flex items-center justify-between px-1 pt-1 text-xs">
                    <span>{trucks.length} trucks, fullest first</span>
                    <button type="button" className="hover:text-foreground" onClick={() => setCluster(null)}>
                      All clusters
                    </button>
                  </div>
                  <ul className="bg-card divide-y rounded-xl border">
                    {trucks.map((t) => (
                      <li key={t.id}>
                        <button
                          type="button"
                          onClick={() => setTruck(t.id)}
                          className="hover:bg-muted/50 grid w-full grid-cols-[auto_minmax(0,1fr)_6.5rem] items-center gap-3 px-3 py-2 text-left text-xs transition-colors"
                        >
                          <TruckTag id={t.id} cluster={t.cluster} />
                          <span className="text-muted-foreground truncate tabular-nums">
                            {t.stops.length} stops · {formatMiles(t.loadedMiles)}
                          </span>
                          <FillMeter fill={t.fill} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <div className="text-muted-foreground px-1 text-xs">
                    {run.clusters.length} clusters · {formatCount(run.metrics.trucks)} trucks · select one
                  </div>
                  {run.clusters.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setCluster(x.id)}
                      className={cn("bg-card hover:bg-muted/40 flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors")}
                    >
                      <ClusterSwatch cluster={x.id} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{look.clusterArea(x.id)}</span>
                        <span className="text-muted-foreground block text-xs tabular-nums">
                          {x.stops.length} stops · {x.trucks.length} trucks · {formatMoney(x.value, { compact: true })}
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
