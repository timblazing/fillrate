import type { LabInstance, LabResult } from "@fillrate/contracts"

import { cn } from "@/lib/utils"

type Point = { id: string; x: number; y: number }

/**
 * Schematic SVG of a lab instance and its routes. Planar coordinates are abstract benchmark units, so they are
 * plotted as-is on equal axes and never on a map. Geographic instances use a flat longitude × cos(latitude)
 * projection, labeled schematic; straight segments show visit order, not roads.
 */
export function LabPlot({ instance, result, className }: { instance: LabInstance; result: LabResult | null; className?: string }) {
  const planar = instance.coordinates === "planar"
  const places = [...instance.depots, ...instance.clients]
  const meanLat = planar ? 0 : places.reduce((n, p) => n + (p.lat ?? 0), 0) / places.length
  const project = (p: { id: string; x?: number | null; y?: number | null; lat?: number | null; lon?: number | null }): Point =>
    planar ? { id: p.id, x: p.x ?? 0, y: p.y ?? 0 } : { id: p.id, x: (p.lon ?? 0) * Math.cos((meanLat * Math.PI) / 180), y: p.lat ?? 0 }
  const homes = instance.depots.map(project)
  const homeById = new Map(homes.map((p) => [p.id, p]))
  const clients = instance.clients.map(project)
  const all = [...homes, ...clients]
  const [minX, maxX] = [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))]
  const [minY, maxY] = [Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y))]
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const inner = 360, pad = 20
  const sx = (x: number) => pad + ((x - minX) / span) * inner
  const sy = (y: number) => pad + ((maxY - y) / span) * inner // y grows upward
  const width = 2 * pad + ((maxX - minX) / span) * inner, height = 2 * pad + ((maxY - minY) / span) * inner
  const byId = new Map(clients.map((p) => [p.id, p]))
  const routes = result?.routes ?? []
  const reloadCount = new Map<string, number>()
  for (const r of routes) for (const t of (r.trips ?? []).slice(0, -1)) reloadCount.set(t.to_depot, (reloadCount.get(t.to_depot) ?? 0) + 1)
  const optionalIds = new Set(instance.clients.filter((c) => c.required === false).map((c) => c.id))
  const routeOf = new Map(routes.flatMap((r, i) => r.visits.map((v) => [v.client_id, i] as const)))

  return (
    <figure className={cn("bg-card flex flex-col gap-2 rounded-xl border p-3", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${planar ? "Planar" : "Schematic geographic"} plot of ${homes.length} ${homes.length === 1 ? "depot" : "depots"}, ${clients.length} clients and ${routes.length} routes`} className="max-h-96 w-full">
        {routes.map((r, i) => {
          const start = homeById.get(r.start_depot ?? instance.depots[0].id) ?? homes[0]
          const end = homeById.get(r.end_depot ?? instance.depots[0].id) ?? homes[0]
          // With reloads the path goes through each reload depot between trips.
          const trips = r.trips?.length ? r.trips : null
          const path = trips
            ? [start, ...trips.flatMap((t, ti) => [...t.client_ids.map((id) => byId.get(id)!).filter(Boolean), ti < trips.length - 1 ? (homeById.get(t.to_depot) ?? homes[0]) : end])]
            : [start, ...r.visits.map((v) => byId.get(v.client_id)!).filter(Boolean), end]
          return (
            <polyline
              key={i}
              data-route={i}
              points={path.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeOpacity={0.85}
              style={{ stroke: `var(--route-${(i % 8) + 1})` }}
            />
          )
        })}
        {clients.map((p) => {
          const r = routeOf.get(p.id)
          if (result && optionalIds.has(p.id) && r === undefined)
            return (
              <circle key={p.id} data-skipped={p.id} cx={sx(p.x)} cy={sy(p.y)} r={5} fill="none" strokeWidth={2} strokeDasharray="2 2" className="stroke-muted-foreground">
                <title>{`${p.id}: skipped (optional)`}</title>
              </circle>
            )
          return (
            <circle key={p.id} cx={sx(p.x)} cy={sy(p.y)} r={4.5} strokeWidth={1.5} className="stroke-background" style={{ fill: r === undefined ? "var(--muted-foreground)" : `var(--route-${(r % 8) + 1})` }}>
              <title>{p.id}</title>
            </circle>
          )
        })}
        {homes.map((home) => (
          <rect key={home.id} data-depot={home.id} x={sx(home.x) - 6} y={sy(home.y) - 6} width={12} height={12} rx={2} className="fill-foreground stroke-background" strokeWidth={1.5}>
            <title>{reloadCount.has(home.id) ? `Depot ${home.id}: ${reloadCount.get(home.id)} reload${reloadCount.get(home.id) === 1 ? "" : "s"}` : `Depot ${home.id}`}</title>
          </rect>
        ))}
        {homes.map((home) => reloadCount.has(home.id) && (
          <rect key={`reload-${home.id}`} data-reload={home.id} x={sx(home.x) - 10} y={sy(home.y) - 10} width={20} height={20} rx={4} fill="none" strokeWidth={1.5} strokeDasharray="3 2" className="stroke-foreground" />
        ))}
        {homes.length > 1 &&
          homes.map((home) => (
            <text key={`label-${home.id}`} x={sx(home.x)} y={sy(home.y) - 10} textAnchor="middle" className="fill-foreground text-[10px]">
              {home.id}
            </text>
          ))}
      </svg>
      <figcaption className="text-muted-foreground text-xs text-pretty">
        {planar
          ? "Planar instance: abstract coordinates on equal axes (not latitude/longitude, so no map)."
          : "Geographic instance, schematic: longitude × cos(latitude) against latitude, no basemap."}{" "}
        {homes.length === 1 ? "Square: depot." : "Squares: depots (labeled)."} {result && optionalIds.size > 0 && "Dashed circles: skipped optional clients."} {reloadCount.size > 0 && "Dashed square: a reload depot (the vehicle returns there between trips)."} Straight lines show visit order from the start depot to the end depot, not roads.
      </figcaption>
    </figure>
  )
}
