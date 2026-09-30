"use client"

import { Download, GitBranch, GitCompare } from "lucide-react"
import dynamic from "next/dynamic"
import { useState } from "react"

import { ClusterCard } from "@/components/lab/cluster-card"
import { JobStatusBadge } from "@/components/lab/job-status"
import { RunMetricGroups } from "@/components/lab/run-metrics"
import { TruckLoad } from "@/components/lab/truck-load"
import { UnshippedLines } from "@/components/lab/unshipped-lines"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/ui/tabs"
import { formatCount, formatMoney } from "@/lib/units"

import { baseline, depot, lookups } from "../fixtures"
import { AppShell } from "./shell"

const PipelineMap = dynamic(() => import("../pipeline-map"), { ssr: false, loading: () => <Skeleton className="h-full w-full" /> })

// Pipeline results (spec §10): run summary, then clusters → trucks → lines, unshipped reasons, and the map.
export function ResultsBlock() {
  const run = baseline()
  const look = lookups(run)
  const [cluster, setCluster] = useState(3)
  const [stop, setStop] = useState<string | null>(null)
  const trucks = run.trucks.filter((t) => t.cluster === cluster).sort((a, b) => b.fill - a.fill)
  const unshippedAmount = run.unshipped.reduce((s, u) => s + u.amount, 0)

  return (
    <AppShell
      crumb="run-0212"
      height="h-[900px]"
      actions={
        <>
          <Button variant="ghost" size="sm">
            <Download /> Export
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
              {["k auto → 6", "seed 0", "× 1.2", "500 mi leg / diameter", "order date → value"].map((c) => (
                <Badge key={c} variant="outline">
                  {c}
                </Badge>
              ))}
            </div>
          </div>

          <RunMetricGroups metrics={run.metrics} maxDiameter={run.settings.maxDiameterMiles} />

          <Tabs defaultValue="clusters">
            <TabsList variant="underline">
              <TabsTab value="clusters">
                Clusters & trucks <Badge variant="secondary" size="sm">{run.clusters.length}</Badge>
              </TabsTab>
              <TabsTab value="unshipped">
                Unshipped <Badge variant="warning" size="sm">{formatMoney(unshippedAmount, { compact: true })}</Badge>
              </TabsTab>
              <TabsTab value="map">Map</TabsTab>
            </TabsList>

            <TabsPanel value="clusters" className="space-y-4 pt-4">
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
                  Cluster {cluster} · {trucks.length} trucks
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
