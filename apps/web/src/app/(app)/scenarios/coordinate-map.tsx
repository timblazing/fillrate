"use client"

import type { ScenarioDocument } from "@fillrate/contracts"
import { featureCollection, point } from "@turf/helpers"
import type * as GeoJSON from "geojson"
import type * as MapLibreGL from "maplibre-gl"
import { MapPin, Warehouse } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useMemo, useRef } from "react"

import { FitBounds, type StopPointProps, StopPointsLayer } from "@/components/lab/map-layers"
import { Map, MapControls, MapMarker, MarkerContent, MarkerTooltip, useMap } from "@/components/ui/map"
import { useCssColors } from "@/lib/css-color"

type Location = ScenarioDocument["locations"][number]
const tokens = ["--muted-foreground", "--warning", "--info", "--background", "--foreground"]

/** Map clicks outside the stop layer, used to place the selected location. */
function MapClick({ onClick }: { onClick: (lat: number, lon: number) => void }) {
  const { map, isLoaded } = useMap()
  const handler = useRef(onClick)
  useEffect(() => { handler.current = onClick })
  useEffect(() => {
    if (!map || !isLoaded) return
    const click = (e: MapLibreGL.MapMouseEvent) => handler.current(e.lngLat.lat, e.lngLat.lng)
    const canvas = map.getCanvas()
    canvas.style.cursor = "crosshair"
    map.on("click", click)
    return () => { map.off("click", click); canvas.style.cursor = "" }
  }, [map, isLoaded])
  return null
}

// Coordinate review map (spec §6, §4): every located stop as one circle layer, ZIP-approximate stops
// as amber rings and manual placements in blue. The selected location is a draggable marker; while
// placing, a click anywhere sets its coordinate. Corrections become "manual" with undo in the workbench.
export default function CoordinateMap({
  depot,
  locations,
  selected,
  placing,
  onSelect,
  onPlace,
}: {
  depot: ScenarioDocument["depot"]
  locations: Location[]
  selected: string | null
  placing: boolean
  onSelect: (id: string | null) => void
  onPlace: (id: string, lat: number, lon: number) => void
}) {
  const { resolvedTheme } = useTheme()
  const colors = useCssColors(tokens, resolvedTheme)
  const ready = Object.keys(colors).length === tokens.length
  const located = locations.filter((l) => l.lat != null && l.lon != null && l.coordinate_source !== "unresolved")
  const current = locations.find((l) => l.id === selected) ?? null

  const points = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, StopPointProps>>(() => {
    if (!ready) return featureCollection([])
    return featureCollection(
      located
        .filter((l) => l.id !== selected)
        .map((l) =>
          point([l.lon!, l.lat!], {
            id: l.id,
            color: l.coordinate_source === "zcta" ? colors["--warning"] : l.coordinate_source === "manual" ? colors["--info"] : colors["--muted-foreground"],
            hollow: l.coordinate_source === "zcta",
            dimmed: selected != null,
          })
        )
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, colors, locations, selected])
  const fit = useMemo<[number, number][]>(
    () => [[depot.lon, depot.lat], ...located.map((l) => [l.lon!, l.lat!] as [number, number])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locations.length]
  )

  return (
    <div className="relative h-full">
      <Map theme={resolvedTheme === "dark" ? "dark" : "light"} center={[depot.lon, depot.lat]} zoom={5} attributionControl={{ compact: false }}>
        <FitBounds points={fit} fitKey={String(locations.length)} />
        {ready && <StopPointsLayer data={points} outline={colors["--background"]} onSelect={(id) => !placing && onSelect(id)} />}
        {placing && current && <MapClick onClick={(lat, lon) => onPlace(current.id, lat, lon)} />}
        {current && current.lat != null && current.lon != null && (
          <MapMarker longitude={current.lon} latitude={current.lat} draggable onDragEnd={({ lat, lng }) => onPlace(current.id, lat, lng)}>
            <MarkerContent>
              <MapPin className="text-foreground size-7 -translate-y-3 drop-shadow" fill="var(--background)" aria-hidden />
            </MarkerContent>
            <MarkerTooltip>{current.label} · drag to correct</MarkerTooltip>
          </MapMarker>
        )}
        <MapMarker longitude={depot.lon} latitude={depot.lat}>
          <MarkerContent>
            <span className="bg-foreground text-background flex size-7 items-center justify-center rounded-full shadow-md ring-2 ring-white/80">
              <Warehouse className="size-4" aria-hidden />
            </span>
          </MarkerContent>
          <MarkerTooltip>{depot.label}</MarkerTooltip>
        </MapMarker>
        <MapControls />
      </Map>
      <span className="bg-background/85 text-muted-foreground absolute bottom-2 left-2 rounded-md px-2 py-1 text-[11px] backdrop-blur">
        {placing && current ? `Click the map to place ${current.label}.` : "Amber rings: ZIP-approximate. Blue: placed by hand. Select a stop to drag it."}
      </span>
    </div>
  )
}
