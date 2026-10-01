"use client"

import type { RunSummary } from "@fillrate/contracts"
import convex from "@turf/convex"
import { featureCollection, point, polygon } from "@turf/helpers"
import { cellToBoundary, latLngToCell } from "h3-js"
import type * as GeoJSON from "geojson"
import { Warehouse } from "lucide-react"
import { useTheme } from "next-themes"
import { useMemo } from "react"

import { FitBounds, type StopPointProps, StopPointsLayer } from "@/components/lab/map-layers"
import { Map, MapControls, MapGeoJSON, MapMarker, MapRoute, MarkerContent, MarkerTooltip } from "@/components/ui/map"
import { useCssColors } from "@/lib/css-color"

const tokens = [...Array.from({ length: 8 }, (_, i) => `--route-${i + 1}`), "--background", "--muted-foreground", "--destructive"]

// Run results map (spec §10): stops by cluster, cluster hulls, and shipment paths drawn as straight
// lines (schematic, not road geometry). Hollow red rings are unshipped or excluded locations.
export default function RunMap({
  summary,
  cluster,
  truck,
  onSelectCluster,
  h3Resolution = null,
}: {
  summary: RunSummary
  cluster: string | null
  truck: string | null
  onSelectCluster: (id: string | null) => void
  /** Optional H3 map layer (spec §11: off by default, resolution 5, shaded by stop count). */
  h3Resolution?: number | null
}) {
  const { resolvedTheme } = useTheme()
  const colors = useCssColors(tokens, resolvedTheme)
  const ready = Object.keys(colors).length === tokens.length
  const index = useMemo(() => new globalThis.Map(summary.clusters.map((c, i) => [c.id, i + 1])), [summary])
  const color = (id: string | null | undefined) => (id ? colors[`--route-${(((index.get(id) ?? 1) - 1) % 8) + 1}`] : colors["--muted-foreground"])
  const located = summary.locations.filter((l) => l.lat != null && l.lon != null)
  const byId = new globalThis.Map(located.map((l) => [l.id, l]))

  const points = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, StopPointProps>>(() => {
    if (!ready) return featureCollection([])
    return featureCollection(
      located
        .filter((l) => l.state !== "no_demand")
        .map((l) => {
          const off = l.state === "unplanned" || l.state === "excluded"
          return point([l.lon!, l.lat!], {
            id: l.id,
            color: off ? colors["--destructive"] : color(l.cluster_id),
            hollow: off,
            dimmed: cluster != null && l.cluster_id !== cluster,
            selected: false,
          })
        })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, colors, summary, cluster])

  const hulls = useMemo(() => {
    if (!ready) return featureCollection([])
    return featureCollection(
      summary.clusters.flatMap((c) => {
        const pts = c.location_ids.map((id) => byId.get(id)).filter(Boolean).map((l) => point([l!.lon!, l!.lat!]))
        const hull = pts.length >= 3 ? convex(featureCollection(pts)) : null
        if (!hull) return []
        hull.properties = { color: color(c.id), selected: c.id === cluster }
        return [hull]
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, colors, summary, cluster])

  const cells = useMemo(() => {
    if (h3Resolution == null) return null
    const counts = new globalThis.Map<string, number>()
    for (const l of located) if (l.state !== "no_demand") {
      const cell = latLngToCell(l.lat!, l.lon!, h3Resolution)
      counts.set(cell, (counts.get(cell) ?? 0) + 1)
    }
    const max = Math.max(1, ...counts.values())
    return featureCollection([...counts].map(([cell, n]) => {
      const ring = cellToBoundary(cell, true)
      return polygon([[...ring, ring[0]]], { stops: n, share: n / max })
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary, h3Resolution])
  const cellFill = useMemo(() => ({ "fill-color": colors["--muted-foreground"] ?? "#888", "fill-opacity": ["+", 0.08, ["*", 0.4, ["get", "share"]]] }) as never, [colors])
  const cellLine = useMemo(() => ({ "line-color": colors["--muted-foreground"] ?? "#888", "line-width": 0.5, "line-opacity": 0.5 }) as never, [colors])

  const hullFill = useMemo(() => ({ "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], 0.16, 0.06] }) as never, [])
  const hullLine = useMemo(() => ({ "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 2, 1], "line-opacity": 0.7 }) as never, [])
  const depot: [number, number] = [summary.depot.lon, summary.depot.lat]
  const trucks = summary.trucks.filter((t) => (truck ? t.id === truck : cluster ? t.cluster_id === cluster : true))
  const fit = useMemo<[number, number][]>(
    () => [depot, ...located.filter((l) => !cluster || l.cluster_id === cluster).map((l) => [l.lon!, l.lat!] as [number, number])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary, cluster]
  )

  return (
    <div className="relative h-full">
      <Map theme={resolvedTheme === "dark" ? "dark" : "light"} center={depot} zoom={5}>
        <FitBounds points={fit} fitKey={`${cluster}`} />
        {ready && cells && <MapGeoJSON id="run-h3" data={cells} fillPaint={cellFill} linePaint={cellLine} />}
        {ready && <MapGeoJSON id="run-hulls" data={hulls} fillPaint={hullFill} linePaint={hullLine} />}
        {ready &&
          trucks.map((t) => (
            <MapRoute
              key={t.id}
              id={`run-truck-${t.id}`}
              coordinates={[depot, ...t.visits.map((v) => [byId.get(v.location_id)!.lon!, byId.get(v.location_id)!.lat!] as [number, number])]}
              color={color(t.cluster_id)}
              width={truck ? 3 : 1.5}
              opacity={0.75}
              dashArray={[2, 1.5]}
              interactive={false}
            />
          ))}
        {ready && (
          <StopPointsLayer
            data={points}
            outline={colors["--background"]}
            onSelect={(id) => onSelectCluster(id ? (byId.get(id)?.cluster_id ?? null) : null)}
          />
        )}
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
      <span className="bg-background/85 text-muted-foreground absolute bottom-2 left-2 rounded-md px-2 py-1 text-[11px] backdrop-blur">
        Shipment paths are straight-line schematics, not roads.
      </span>
    </div>
  )
}
