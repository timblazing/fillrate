"use client"

import circle from "@turf/circle"
import convex from "@turf/convex"
import { featureCollection, point } from "@turf/helpers"
import type * as GeoJSON from "geojson"
import { Warehouse } from "lucide-react"
import { useTheme } from "next-themes"
import { useMemo, useState } from "react"

import { FitBounds, type StopPointProps, StopPointsLayer } from "@/components/lab/map-layers"
import { CoordinateSourceFlag } from "@/components/lab/provenance-badge"
import { ClusterLegend, ClusterSwatch } from "@/components/lab/route-swatch"
import { FillPercent } from "@/components/lab/trailer-fill"
import { Label } from "@/components/ui/label"
import { Map, MapControls, MapGeoJSON, MapMarker, MapPopup, MapRoute, MarkerContent, MarkerTooltip } from "@/components/ui/map"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useCssColors } from "@/lib/css-color"
import { formatFeet, formatMiles, formatMoney, formatPercent } from "@/lib/units"
import { cn } from "@/lib/utils"

import { type PipelineResult, baseline, depot, lookups } from "./fixtures"

export type MapMode = "cluster" | "confidence"

const tokens = [
  ...Array.from({ length: 8 }, (_, i) => `--route-${i + 1}`),
  "--background",
  "--muted-foreground",
  "--warning",
  "--destructive",
]

// Pipeline results map (spec §10): stops colored by cluster, cluster hulls, truck paths (straight-line, schematic),
// and the depot leg-limit ring. Confidence mode colors stops by k-explorer assignment confidence (spec §8a).
export default function PipelineMap({
  run = baseline(),
  confidence,
  embedded = false,
  selectedCluster: selectedClusterProp,
  onSelectCluster,
  selectedStop: selectedStopProp,
  onSelectStop,
  defaultMode = "cluster",
  className,
}: {
  run?: PipelineResult
  /** stop ID → 0–1, from the k explorer. Enables the confidence mode. */
  confidence?: Map<string, number>
  embedded?: boolean
  selectedCluster?: number | null
  onSelectCluster?: (c: number | null) => void
  selectedStop?: string | null
  onSelectStop?: (id: string | null) => void
  defaultMode?: MapMode
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const colors = useCssColors(tokens, resolvedTheme)
  const [localCluster, setLocalCluster] = useState<number | null>(3)
  const [localStop, setLocalStop] = useState<string | null>(null)
  const [mode, setMode] = useState<MapMode>(confidence ? defaultMode : "cluster")
  const [hulls, setHulls] = useState(true)
  const [trucks, setTrucks] = useState(true)
  const [limit, setLimit] = useState(true)

  const selectedCluster = selectedClusterProp !== undefined ? selectedClusterProp : localCluster
  const setSelectedCluster = onSelectCluster ?? setLocalCluster
  const selectedStop = selectedStopProp !== undefined ? selectedStopProp : localStop
  const setSelectedStop = onSelectStop ?? setLocalStop

  const { stops: stopById, trucks: truckById, locations: locationById } = lookups(run)
  const ready = Object.keys(colors).length === tokens.length
  const clusterColor = (c: number) => colors[`--route-${((c - 1) % 8) + 1}`]
  const maxLeg = run.settings.maxLegMiles

  const confidenceColor = (v: number) =>
    v >= 0.9 ? colors["--muted-foreground"] : v >= 0.7 ? colors["--warning"] : colors["--destructive"]

  const points = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, StopPointProps>>(() => {
    if (!ready) return featureCollection([])
    return featureCollection(
      run.stops
        .filter((s) => !s.split || s.split.index === 1)
        .map((s) => {
          const unreachable = s.depotMiles > maxLeg
          const conf = confidence?.get(s.id)
          const color = unreachable
            ? colors["--destructive"]
            : mode === "confidence" && conf != null
              ? confidenceColor(conf)
              : s.cluster
                ? clusterColor(s.cluster)
                : colors["--muted-foreground"]
          return point([s.longitude, s.latitude], {
            id: s.id,
            color,
            hollow: unreachable,
            dimmed: mode === "cluster" && selectedCluster != null && s.cluster !== selectedCluster && !unreachable,
            selected: s.id === selectedStop,
          })
        })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, colors, run, mode, confidence, selectedCluster, selectedStop, maxLeg])

  const hullData = useMemo(() => {
    if (!ready) return featureCollection([])
    return featureCollection(
      run.clusters.flatMap((c) => {
        const pts = c.stops.map((id) => stopById.get(id)!).map((s) => point([s.longitude, s.latitude]))
        const hull = convex(featureCollection(pts))
        if (!hull) return []
        hull.properties = { id: c.id, color: clusterColor(c.id), selected: c.id === selectedCluster }
        return [hull]
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, colors, run, selectedCluster])

  const ring = useMemo(
    () => circle([depot.longitude, depot.latitude], maxLeg / run.settings.circuity, { units: "miles", steps: 160 }),
    [maxLeg, run.settings.circuity]
  )

  const hullFill = useMemo(
    () => ({ "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], 0.16, 0.06] }) as never,
    []
  )
  const hullLine = useMemo(
    () => ({ "line-color": ["get", "color"], "line-width": ["case", ["get", "selected"], 2, 1], "line-opacity": 0.7 }) as never,
    []
  )
  const ringLine = useMemo(
    () => ({ "line-color": colors["--muted-foreground"] ?? "#888", "line-width": 1.25, "line-dasharray": [3, 3], "line-opacity": 0.8 }),
    [colors]
  )

  const clusterTrucks = selectedCluster != null ? run.trucks.filter((t) => t.cluster === selectedCluster) : []
  const stop = selectedStop ? stopById.get(selectedStop) : undefined
  const stopTruck = stop?.truck ? truckById.get(stop.truck) : undefined
  const stopConf = stop ? confidence?.get(stop.id) : undefined

  const fitPoints = useMemo<[number, number][]>(() => {
    const src = selectedCluster != null ? run.stops.filter((s) => s.cluster === selectedCluster) : run.stops
    return [[depot.longitude, depot.latitude], ...src.map((s) => [s.longitude, s.latitude] as [number, number])]
  }, [run, selectedCluster])

  return (
    <div className={cn("flex flex-col gap-3", embedded && "h-full gap-0", className)}>
      {!embedded && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {confidence && (
            <ToggleGroup value={[mode]} onValueChange={(v) => v[0] && setMode(v[0] as MapMode)} variant="outline" size="sm">
              <ToggleGroupItem value="cluster">Clusters</ToggleGroupItem>
              <ToggleGroupItem value="confidence">Confidence</ToggleGroupItem>
            </ToggleGroup>
          )}
          <ClusterLegend
            clusters={run.clusters.map((c) => c.id)}
            active={selectedCluster}
            onToggle={(c) => setSelectedCluster(selectedCluster === c ? null : c)}
          />
          <div className="ml-auto flex flex-wrap items-center gap-4">
            {(
              [
                ["Hulls", hulls, setHulls],
                ["Shipments", trucks, setTrucks],
                ["Leg limit", limit, setLimit],
              ] as const
            ).map(([label, value, set]) => (
              <Label key={label} className="gap-2 text-xs font-normal">
                <Switch checked={value} onCheckedChange={set} /> {label}
              </Label>
            ))}
          </div>
        </div>
      )}
      <div className={cn("relative overflow-hidden", embedded ? "h-full" : "h-[520px] rounded-xl border")}>
        <Map theme={resolvedTheme === "dark" ? "dark" : "light"} center={[-89.4, 35.3]} zoom={4.9}>
          <FitBounds points={fitPoints} fitKey={`${selectedCluster}`} />
          {ready && limit && <MapGeoJSON id="leg-limit" data={ring} fillPaint={false} linePaint={ringLine} />}
          {ready && hulls && mode === "cluster" && <MapGeoJSON id="hulls" data={hullData} fillPaint={hullFill} linePaint={hullLine} />}
          {ready &&
            trucks &&
            mode === "cluster" &&
            clusterTrucks.map((t) => (
              <MapRoute
                key={t.id}
                id={`truck-${t.id}`}
                coordinates={[
                  [depot.longitude, depot.latitude],
                  ...t.stops.map((id) => {
                    const s = stopById.get(id)!
                    return [s.longitude, s.latitude] as [number, number]
                  }),
                ]}
                color={clusterColor(t.cluster)}
                width={1.75}
                opacity={stopTruck && stopTruck.id !== t.id ? 0.25 : 0.8}
                dashArray={[2, 1.5]}
                active={stopTruck?.id === t.id}
                activeWidth={3.5}
                interactive={false}
              />
            ))}
          {ready && (
            <StopPointsLayer
              data={points}
              outline={colors["--background"]}
              onSelect={(id) => {
                setSelectedStop(id)
                const s = id ? stopById.get(id) : undefined
                if (s?.cluster != null && mode === "cluster") setSelectedCluster(s.cluster)
              }}
            />
          )}
          <MapMarker longitude={depot.longitude} latitude={depot.latitude}>
            <MarkerContent>
              <div className="bg-foreground text-background flex size-7 items-center justify-center rounded-md shadow-md ring-2 ring-white dark:ring-black">
                <Warehouse className="size-4" />
              </div>
            </MarkerContent>
            <MarkerTooltip>
              {depot.label} · {depot.city}, {depot.state}
            </MarkerTooltip>
          </MapMarker>
          {stop && (
            <MapPopup key={stop.id} longitude={stop.longitude} latitude={stop.latitude} closeButton onClose={() => setSelectedStop(null)} className="w-64">
              <div className="space-y-2 text-xs">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {stop.cluster && <ClusterSwatch cluster={stop.cluster} size="sm" />}
                    {stop.label}
                  </div>
                  <div className="text-muted-foreground">
                    {stop.city} · <span className="font-mono">{stop.id}</span>
                  </div>
                  {locationById.get(stop.locationId) && <CoordinateSourceFlag source={locationById.get(stop.locationId)!.source} className="mt-1" />}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">Load</dt>
                  <dd className="text-right font-mono tabular-nums">{formatFeet(stop.load)}</dd>
                  <dt className="text-muted-foreground">Value</dt>
                  <dd className="text-right font-mono tabular-nums">{formatMoney(stop.value)}</dd>
                  <dt className="text-muted-foreground">Orders</dt>
                  <dd className="text-right font-mono tabular-nums">{stop.orderIds.length}</dd>
                  <dt className="text-muted-foreground">From depot</dt>
                  <dd className={cn("text-right font-mono tabular-nums", stop.depotMiles > maxLeg && "text-destructive-foreground")}>
                    {formatMiles(stop.depotMiles)}
                  </dd>
                  {stopTruck && (
                    <>
                      <dt className="text-muted-foreground">Shipment</dt>
                      <dd className="text-right font-mono tabular-nums">
                        {stopTruck.id} · <FillPercent fill={stopTruck.fill} />
                      </dd>
                    </>
                  )}
                  {stopConf != null && (
                    <>
                      <dt className="text-muted-foreground">Confidence</dt>
                      <dd className="text-right font-mono tabular-nums">{formatPercent(stopConf)}</dd>
                    </>
                  )}
                </dl>
                {stop.depotMiles > maxLeg && (
                  <p className="text-destructive-foreground">More than {maxLeg} mi from the depot in one drive: allocated, not shipped.</p>
                )}
              </div>
            </MapPopup>
          )}
          <MapControls position="top-right" showZoom showFullscreen />
        </Map>
        <div className="bg-background/85 text-muted-foreground pointer-events-none absolute bottom-2 left-2 space-y-1 rounded-md border px-2 py-1.5 text-[11px] backdrop-blur-sm">
          {mode === "confidence" ? (
            <div className="flex items-center gap-2.5">
              {[
                ["var(--muted-foreground)", "≥ 90%"],
                ["var(--warning)", "70–90%"],
                ["var(--destructive)", "< 70%"],
              ].map(([c, l]) => (
                <span key={l} className="flex items-center gap-1">
                  <span className="size-2 rounded-full" style={{ background: c }} /> {l}
                </span>
              ))}
              <span>assignment confidence</span>
            </div>
          ) : (
            <div>Shipment paths are straight schematic lines, not roads</div>
          )}
          <div className="flex items-center gap-2.5">
            <span className="flex items-center gap-1">
              <span className="border-destructive size-2 rounded-full border-2" /> beyond leg limit
            </span>
            {limit && (
              <span className="flex items-center gap-1">
                <span className="border-muted-foreground w-3 border-t border-dashed" /> {maxLeg} solver mi from depot
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
