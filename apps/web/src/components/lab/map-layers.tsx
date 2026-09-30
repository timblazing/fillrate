"use client"

import type * as GeoJSON from "geojson"
import type * as MapLibreGL from "maplibre-gl"
import { useEffect, useId, useRef } from "react"

import { useMap } from "@/components/ui/map"

export type StopPointProps = {
  id: string
  /** Resolved rgb() color; MapLibre cannot read CSS variables (see useCssColors). */
  color: string
  /** Hollow ring instead of a filled dot, e.g. unreachable or approximate stops. */
  hollow?: boolean
  dimmed?: boolean
  selected?: boolean
}

// Bulk stop points as one GeoJSON circle layer (spec §4): hundreds of stops without DOM markers.
// Rich markers stay reserved for the depot and the selected stop.
export function StopPointsLayer({
  data,
  outline,
  onSelect,
  onHover,
}: {
  data: GeoJSON.FeatureCollection<GeoJSON.Point, StopPointProps>
  /** Resolved color for the point outline, usually the map background. */
  outline: string
  onSelect?: (id: string | null, lngLat?: [number, number]) => void
  onHover?: (id: string | null) => void
}) {
  const { map, isLoaded } = useMap()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "")
  const sourceId = `stops-${uid}`
  const layerId = `stops-circle-${uid}`
  const handlers = useRef({ onSelect, onHover })
  useEffect(() => {
    handlers.current = { onSelect, onHover }
  })

  useEffect(() => {
    if (!map || !isLoaded) return
    map.addSource(sourceId, { type: "geojson", data })
    map.addLayer({
      id: layerId,
      type: "circle",
      source: sourceId,
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 4, ["case", ["get", "selected"], 7, 3.5], 9, ["case", ["get", "selected"], 10, 6]],
        "circle-color": ["case", ["get", "hollow"], outline, ["get", "color"]],
        "circle-stroke-color": ["case", ["get", "hollow"], ["get", "color"], ["get", "selected"], "#ffffff", outline],
        "circle-stroke-width": ["case", ["get", "hollow"], 2, ["get", "selected"], 2.5, 0.75],
        "circle-opacity": ["case", ["get", "dimmed"], 0.25, 0.95],
        "circle-stroke-opacity": ["case", ["get", "dimmed"], 0.25, 1],
      },
    })
    const click = (e: MapLibreGL.MapLayerMouseEvent) => {
      const f = e.features?.[0]
      const coords = (f?.geometry as GeoJSON.Point | undefined)?.coordinates as [number, number] | undefined
      handlers.current.onSelect?.((f?.properties?.id as string) ?? null, coords)
    }
    const enter = (e: MapLibreGL.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = "pointer"
      handlers.current.onHover?.((e.features?.[0]?.properties?.id as string) ?? null)
    }
    const leave = () => {
      map.getCanvas().style.cursor = ""
      handlers.current.onHover?.(null)
    }
    map.on("click", layerId, click)
    map.on("mouseenter", layerId, enter)
    map.on("mouseleave", layerId, leave)
    return () => {
      map.off("click", layerId, click)
      map.off("mouseenter", layerId, enter)
      map.off("mouseleave", layerId, leave)
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      } catch {
        // style may be mid-reload
      }
    }
    // Data and colors sync in the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded])

  useEffect(() => {
    if (!map || !isLoaded) return
    ;(map.getSource(sourceId) as MapLibreGL.GeoJSONSource | undefined)?.setData(data)
  }, [map, isLoaded, data, sourceId])

  useEffect(() => {
    if (!map || !isLoaded || !map.getLayer(layerId)) return
    map.setPaintProperty(layerId, "circle-color", ["case", ["get", "hollow"], outline, ["get", "color"]])
    map.setPaintProperty(layerId, "circle-stroke-color", ["case", ["get", "hollow"], ["get", "color"], ["get", "selected"], "#ffffff", outline])
  }, [map, isLoaded, outline, layerId])

  return null
}

/** Fits the map to a set of [lon, lat] points when `fitKey` changes. */
export function FitBounds({ points, fitKey, padding = 48 }: { points: [number, number][]; fitKey: string; padding?: number }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded || points.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const [x, y] of points) {
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    map.fitBounds(
      [
        [minX, minY],
        [maxX, maxY],
      ],
      { padding, duration: reduce ? 0 : 600, maxZoom: 9 }
    )
    // Refit only when the key changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, isLoaded, fitKey])
  return null
}
