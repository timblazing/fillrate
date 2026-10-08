"use client"

import type { RunSummary } from "@fillrate/contracts"
import dynamic from "next/dynamic"
import { useMemo, useState } from "react"

import { TruckRouteTimeline } from "@/components/lab/truck-route-timeline"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@/components/ui/select"
import { legPaths, roadLabel as labelOf } from "@/lib/road-geometry"
import { buildTimeline, cursorAt, formatDriveTime, timingSource, withRoadPaths } from "@/lib/timeline"
import { formatFeet } from "@/lib/units"

import { type RoadGeometry, RoadGeometryControl } from "./road-geometry"

const TimelineMap = dynamic(() => import("./timeline-map"), { ssr: false, loading: () => <div className="bg-muted/40 h-full animate-pulse" /> })

/** Timeline tab: pick a shipment, scrub its planned route, and watch the map marker follow the cursor. */
export function TimelinePanel({ summary, geo, truckId, onSelectTruck }: { summary: RunSummary; geo: RoadGeometry; truckId: string | null; onSelectTruck: (id: string) => void }) {
  const trucks = summary.trucks
  const [cursor, setCursor] = useState(0)
  const places = useMemo(() => new globalThis.Map(summary.locations.map((l) => [l.id, l])), [summary])
  const truck = trucks.find((t) => t.id === truckId) ?? trucks[0]
  const base = useMemo(() => (truck ? buildTimeline(truck, summary.depot, places, summary.time) : null), [truck, summary.depot, places, summary.time])
  // Fetched road geometry only changes the drawn line and the cursor's path; timing stays the planned leg durations.
  const geometry = truck ? geo.geometries[truck.id] : undefined
  const roadShown = !!truck && !!geometry && geo.shown.has(truck.id)
  const timeline = useMemo(() => (base && roadShown && geometry ? withRoadPaths(base, legPaths(geometry, base.stops.length)) : base), [base, roadShown, geometry])
  const roadLabel = roadShown && geometry ? labelOf(geometry) : null
  const source = timingSource(summary.travel, roadLabel)

  if (summary.validity === "invalid") {
    return (
      <Alert variant="error">
        <AlertTitle>No timeline for an invalid run</AlertTitle>
        <AlertDescription>The validator rejected this plan, so no route is treated as planned. Fix the run and start a new one.</AlertDescription>
      </Alert>
    )
  }
  if (!truck || !timeline) {
    return (
      <Empty className="rounded-xl border">
        <EmptyHeader>
          <EmptyTitle>No shipments to replay</EmptyTitle>
          <EmptyDescription>This run planned no trucks, so there is no route timeline.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const clusterIndex = Math.max(1, summary.clusters.findIndex((c) => c.id === truck.cluster_id) + 1)
  const state = cursorAt(timeline, cursor)
  const items = trucks.map((t) => ({ value: t.id, label: t.id }))

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          {trucks.length > 1 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Shipment</span>
              <Select
                value={truck.id}
                onValueChange={(v) => {
                  onSelectTruck(v as string)
                  setCursor(0)
                }}
                items={items}
              >
                <SelectTrigger size="sm" className="w-44" aria-label="Shipment">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {items.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </label>
          ) : (
            <span className="font-mono text-sm font-medium">{truck.id}</span>
          )}
          <span className="text-muted-foreground text-xs tabular-nums">
            {timeline.stops.length} {timeline.stops.length === 1 ? "stop" : "stops"} · {formatFeet(truck.load)} loaded
            {timeline.driveS != null && ` · ${formatDriveTime(timeline.driveS)} driving`}
            {timeline.scheduled && ` · ${formatDriveTime(timeline.waitS)} waiting · ${formatDriveTime(timeline.serviceS)} service`}
          </span>
        </div>
        <div className="h-[320px] overflow-hidden rounded-xl border sm:h-[400px] xl:h-auto xl:min-h-[440px] xl:flex-1">
          {timeline.located ? (
            <TimelineMap timeline={timeline} cursor={state} routeIndex={clusterIndex} depotLabel={summary.depot.label} roadLabel={roadLabel} />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center p-4 text-center text-sm">Map unavailable: a stop on this shipment has no coordinates.</div>
          )}
        </div>
        <RoadGeometryControl geo={geo} truckId={truck.id} />
      </div>
      <TruckRouteTimeline timeline={timeline} source={source} cursor={cursor} onCursorChange={setCursor} depotLabel={summary.depot.label} clock={summary.time} />
    </div>
  )
}
