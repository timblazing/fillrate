"use client"

import { Download, GitBranch, GitCompare, Printer } from "lucide-react"
import dynamic from "next/dynamic"
import { useState } from "react"

import { ClusterCard } from "@/components/lab/cluster-card"
import { JobStatusBadge } from "@/components/lab/job-status"
import { PlanFlow } from "@/components/lab/plan-flow"
import { RunMetricGroups } from "@/components/lab/run-metrics"
import { TruckLoad } from "@/components/lab/truck-load"
import { UnshippedLines } from "@/components/lab/unshipped-lines"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { FILL_LOW, formatCount, formatMoney, formatPercent, plural } from "@/lib/units"

import { baseline, depot, lookups } from "../fixtures"
import { planFlowSteps } from "../fixtures/stages"
import { AppShell } from "./shell"

const PipelineMap = dynamic(() => import("../pipeline-map"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> })

// Pipeline results (spec §10): run summary, then clusters → trucks → lines, unshipped reasons, and the map.
export function ResultsBlock() {
  const run = baseline()
  const look = lookups(run)
  const [cluster, setCluster] = useState(3)
  const [stop, setStop] = useState<string | null>(null)
  // Map first (design review `workbench.first`): the cluster map is the initial view after a run.
  const [tab, setTab] = useState("map")
  // Each business step opens the view that explains it.
  const stepTab: Record<string, string> = { orders: "unshipped", allocated: "unshipped", stops: "map", clusters: "clusters", trucks: "clusters", shipped: "unshipped" }
  const trucks = run.trucks.filter((t) => t.cluster === cluster).sort((a, b) => b.fill - a.fill)
  const unshippedAmount = run.unshipped.reduce((s, u) => s + u.amount, 0)

  return (
    <AppShell
      crumb="run-0212"
      height={900}
      actions={
        <>
          <Button variant="ghost" size="sm">
            <Download /> Export
          </Button>
          <Button variant="ghost" size="sm">
            <Printer /> Shipment sheets
          </Button>
          <Button variant="outline" size="sm">
            <GitBranch /> Branch
          </Button>
          <Button variant="outline" size="sm">
            <GitCompare /> Compare…
          </Button>
        </>
      }
    >
      <ScrollArea className="h-full">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <JobStatusBadge state="succeeded" />
            <div>
              <div className="font-semibold">Baseline</div>
              <div className="text-muted-foreground font-mono text-xs">
                run-0212 · v14 · PyVRP 0.14.0 · scikit-learn 1.7 · 62 s · Clay · 18 min ago
              </div>
            </div>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {["k = 6 (explorer)", "seed 0", "× 1.2", "500 mi max drive", "order date → value", "fewest trucks, then miles"].map((c) => (
                <Badge key={c} variant="outline">
                  {c}
                </Badge>
              ))}
            </div>
          </div>

          <PlanFlow steps={planFlowSteps(run)} onSelect={(id) => setTab(stepTab[id] ?? "clusters")} />

          <RunMetricGroups metrics={run.metrics} />

          <Tabs value={tab} onValueChange={(v) => setTab(v as string)}>
            <TabsList variant="underline">
              <TabsTab value="map">Map</TabsTab>
              <TabsTab value="clusters">
                Clusters & shipments <Badge variant="secondary" size="sm">{run.clusters.length}</Badge>
              </TabsTab>
              <TabsTab value="unshipped">
                Unshipped <Badge variant="warning" size="sm">{formatMoney(unshippedAmount, { compact: true })}</Badge>
              </TabsTab>
            </TabsList>

            <TabsPanel value="clusters" className="space-y-4 pt-4">
              <p className="text-muted-foreground flex items-center gap-2 text-xs">
                <span className="bg-warning h-2.5 w-1.5 rounded-[2px]" aria-hidden />
                One bar per shipment, fullest first. Amber bars are under {formatPercent(FILL_LOW)} trailer fill; the dashed line marks{" "}
                {formatPercent(FILL_LOW)}.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {run.clusters.map((c) => (
                  <ClusterCard
                    key={c.id}
                    cluster={c}
                    trucks={run.trucks.filter((t) => t.cluster === c.id)}
                    area={look.clusterArea(c.id)}
                    maxDiameter={run.settings.maxDiameterMiles}
                    selected={cluster === c.id}
                    onSelect={() => setCluster(c.id)}
                  />
                ))}
              </div>
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium">
                  Cluster {cluster} · {plural(trucks.length, "shipment")}
                </h3>
                <span className="text-muted-foreground text-xs">fullest first · showing 4 of {formatCount(trucks.length)}</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {trucks.slice(0, 4).map((t) => (
                  <TruckLoad
                    key={t.id}
                    truck={t}
                    stops={look.stops}
                    lines={look.lines}
                    products={look.products}
                    depotLabel={depot.label}
                    maxLeg={run.settings.maxLegMiles}
                    selectedStop={stop}
                    onSelectStop={setStop}
                  />
                ))}
              </div>
            </TabsPanel>

            <TabsPanel value="unshipped" className="pt-4">
              <UnshippedLines items={run.unshipped} products={look.products} locations={look.locations} pageSize={10} />
            </TabsPanel>

            <TabsPanel value="map" className="pt-4">
              <div className="h-[560px] overflow-hidden rounded-xl border">
                <PipelineMap embedded run={run} selectedCluster={cluster} onSelectCluster={(c) => c != null && setCluster(c)} />
              </div>
            </TabsPanel>
          </Tabs>
        </div>
      </ScrollArea>
    </AppShell>
  )
}
