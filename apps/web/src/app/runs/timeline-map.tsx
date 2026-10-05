"use client"

import { Truck, Warehouse } from "lucide-react"
import { useTheme } from "next-themes"
import { useMemo } from "react"

import { FitBounds } from "@/components/lab/map-layers"
import { Map, MapControls, MapMarker, MapRoute, MarkerContent, MarkerTooltip } from "@/components/ui/map"
import { useCssColors } from "@/lib/css-color"
import type { CursorState, Timeline } from "@/lib/timeline"

const tokens = Array.from({ length: 8 }, (_, i) => `--route-${i + 1}`)

// One truck's planned route on the map: schematic straight segments between stops (there is no road geometry
// yet) and a marker interpolated along the current leg by the timeline cursor.
export default function TimelineMap({ timeline, cursor, routeIndex, depotLabel }: { timeline: Timeline; cursor: CursorState | null; routeIndex: number; depotLabel: string }) {
  const { resolvedTheme } = useTheme()
  const colors = useCssColors(tokens, resolvedTheme)
  const color = colors[`--route-${((routeIndex - 1) % 8) + 1}`]
  const depot: [number, number] = [timeline.depot.lon, timeline.depot.lat]
  const path = useMemo(() => [depot, ...timeline.stops.map((s) => [s.lon!, s.lat!] as [number, number])], [timeline]) // eslint-disable-line react-hooks/exhaustive-deps
  const position = cursor?.position

  return (
    <div className="relative h-full">
      <Map theme={resolvedTheme === "dark" ? "dark" : "light"} center={depot} zoom={5}>
        <FitBounds points={path} fitKey={timeline.truckId} />
        {color && <MapRoute id={`timeline-${timeline.truckId}`} coordinates={path} color={color} width={3} opacity={0.8} dashArray={[2, 1.5]} interactive={false} />}
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
      <span className="bg-background/85 text-muted-foreground absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-md px-2 py-1 text-[11px] backdrop-blur">
        Schematic straight-line path — road geometry not available
      </span>
    </div>
  )
}
