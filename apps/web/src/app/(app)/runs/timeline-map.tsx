"use client"

import { Truck, Warehouse } from "lucide-react"
import { useTheme } from "next-themes"
import { useMemo } from "react"

import { FitBounds } from "@/components/lab/map-layers"
import { Map, MapControls, MapMarker, MapRoute, MarkerContent, MarkerTooltip } from "@/components/ui/map"
import { useCssColors } from "@/lib/css-color"
import { SIMULATION_COPY } from "@/lib/road-geometry"
import type { CursorState, Timeline } from "@/lib/timeline"

import { RouteLegend } from "./road-geometry"

const tokens = Array.from({ length: 8 }, (_, i) => `--route-${i + 1}`)

// One truck's planned route on the map: schematic straight segments between stops, or Valhalla road lines when they
// were fetched (display only), and a marker interpolated along the current leg by the timeline cursor.
export default function TimelineMap({ timeline, cursor, routeIndex, depotLabel, roadLabel = null }: { timeline: Timeline; cursor: CursorState | null; routeIndex: number; depotLabel: string; roadLabel?: string | null }) {
  const { resolvedTheme } = useTheme()
  const colors = useCssColors(tokens, resolvedTheme)
  const color = colors[`--route-${((routeIndex - 1) % 8) + 1}`]
  const depot: [number, number] = [timeline.depot.lon, timeline.depot.lat]
  const path = useMemo(() => [depot, ...timeline.stops.map((s) => [s.lon!, s.lat!] as [number, number])], [timeline]) // eslint-disable-line react-hooks/exhaustive-deps
  const position = cursor?.position

  return (
    <div className="relative h-full">
      <Map theme={resolvedTheme === "dark" ? "dark" : "light"} center={depot} zoom={5} attributionControl={{ compact: false }}>
        <FitBounds points={path} fitKey={timeline.truckId} />
        {color && !timeline.legPaths && <MapRoute id={`timeline-${timeline.truckId}`} coordinates={path} color={color} width={3} opacity={0.8} dashArray={[2, 1.5]} interactive={false} />}
        {color && timeline.legPaths?.map((leg, i) => (leg ? <MapRoute key={i} id={`timeline-${timeline.truckId}-road-${i}`} coordinates={leg} color={color} width={4} opacity={0.95} interactive={false} /> : null))}
        {timeline.stops.map((s) => (
          <MapMarker key={s.visitId} longitude={s.lon!} latitude={s.lat!}>
            <MarkerContent>
              <span className="bg-background text-foreground flex size-6 items-center justify-center rounded-full border-2 text-[11px] font-semibold tabular-nums shadow" style={{ borderColor: color }}>
                {s.sequence}
              </span>
            </MarkerContent>
            <MarkerTooltip>{s.label}</MarkerTooltip>
          </MapMarker>
        ))}
        <MapMarker longitude={depot[0]} latitude={depot[1]}>
          <MarkerContent>
            <span className="bg-foreground text-background flex size-7 items-center justify-center rounded-full shadow-md ring-2 ring-white/80">
              <Warehouse className="size-4" aria-hidden />
            </span>
          </MarkerContent>
          <MarkerTooltip>{depotLabel}</MarkerTooltip>
        </MapMarker>
        {position && (
          <MapMarker longitude={position.lon} latitude={position.lat}>
            <MarkerContent>
              <span data-testid="timeline-cursor-marker" className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-full shadow-lg ring-2 ring-white">
                <Truck className="size-4" aria-hidden />
              </span>
            </MarkerContent>
            <MarkerTooltip>Cursor position</MarkerTooltip>
          </MapMarker>
        )}
        <MapControls />
      </Map>
      <RouteLegend road={timeline.legPaths ? roadLabel : null} schematic={!timeline.legPaths} color={color} />
      {cursor && (
        <span data-testid="timeline-map-state" className="bg-background/90 absolute top-2 left-2 rounded-md px-2 py-1 text-[11px] backdrop-blur">
          {{ depot: "At depot", drive: "Driving", wait: "Waiting for window", service: "Service" }[cursor.phase]}
          {timeline.legPaths ? ` · ${SIMULATION_COPY}` : ""}
        </span>
      )}
    </div>
  )
}
