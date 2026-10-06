"use client"

import type { ExplorerSummary } from "@fillrate/contracts"
import { featureCollection, point } from "@turf/helpers"
import type * as GeoJSON from "geojson"
import { Warehouse } from "lucide-react"
import { useTheme } from "next-themes"
import { useMemo } from "react"

import { FitBounds, type StopPointProps, StopPointsLayer } from "@/components/lab/map-layers"
import { Map, MapControls, MapMarker, MarkerContent, MarkerTooltip } from "@/components/ui/map"
import { useCssColors } from "@/lib/css-color"

const tokens = ["--success", "--warning", "--destructive", "--muted-foreground", "--background"]
export const AGREEMENT_LOW = 0.7

// Seed agreement map (spec §8a): each location colored by its mean co-assignment with its
// reference-seed peers. Seed-sensitive locations stand out; singletons (no peers) are hollow.
export default function ExplorerMap({ summary, repaired }: { summary: ExplorerSummary; repaired: boolean }) {
  const { resolvedTheme } = useTheme()
  const colors = useCssColors(tokens, resolvedTheme)
  const ready = Object.keys(colors).length === tokens.length
  const points = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, StopPointProps>>(() => {
    if (!ready) return featureCollection([])
    return featureCollection(
      summary.locations.map((l) => {
        const a = repaired ? l.agreement_repaired : l.agreement_raw
        const color = a == null ? colors["--muted-foreground"] : a >= 0.9 ? colors["--success"] : a >= AGREEMENT_LOW ? colors["--warning"] : colors["--destructive"]
        return point([l.lon, l.lat], { id: l.id, color, hollow: a == null })
      })
    )
  }, [ready, colors, summary, repaired])
  const depot: [number, number] = [summary.depot.lon, summary.depot.lat]
  const fit = useMemo<[number, number][]>(() => [depot, ...summary.locations.map((l) => [l.lon, l.lat] as [number, number])], [summary]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Map theme={resolvedTheme === "dark" ? "dark" : "light"} center={depot} zoom={5} attributionControl={{ compact: false }}>
      <FitBounds points={fit} fitKey="explorer" />
      {ready && <StopPointsLayer data={points} outline={colors["--background"]} />}
      <MapMarker longitude={depot[0]} latitude={depot[1]}>
        <MarkerContent>
          <span className="bg-foreground text-background flex size-7 items-center justify-center rounded-full shadow-md ring-2 ring-white/80">
            <Warehouse className="size-4" aria-hidden />
          </span>
        </MarkerContent>
        <MarkerTooltip>{summary.depot.label}</MarkerTooltip>
      </MapMarker>
      <MapControls />
    </Map>
  )
}
