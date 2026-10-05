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
  const depot = instance.depots[0]
  const meanLat = planar ? 0 : [depot, ...instance.clients].reduce((n, p) => n + (p.lat ?? 0), 0) / (instance.clients.length + 1)
  const project = (p: { id: string; x?: number | null; y?: number | null; lat?: number | null; lon?: number | null }): Point =>
    planar ? { id: p.id, x: p.x ?? 0, y: p.y ?? 0 } : { id: p.id, x: (p.lon ?? 0) * Math.cos((meanLat * Math.PI) / 180), y: p.lat ?? 0 }
  const home = project(depot)
  const clients = instance.clients.map(project)
  const all = [home, ...clients]
  const [minX, maxX] = [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))]
  const [minY, maxY] = [Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y))]
  const span = Math.max(maxX - minX, maxY - minY) || 1
  const inner = 360, pad = 20
  const sx = (x: number) => pad + ((x - minX) / span) * inner
  const sy = (y: number) => pad + ((maxY - y) / span) * inner // y grows upward
  const width = 2 * pad + ((maxX - minX) / span) * inner, height = 2 * pad + ((maxY - minY) / span) * inner
  const byId = new Map(clients.map((p) => [p.id, p]))
  const routes = result?.routes ?? []
  const routeOf = new Map(routes.flatMap((r, i) => r.visits.map((v) => [v.client_id, i] as const)))

  return (
    <figure className={cn("bg-card flex flex-col gap-2 rounded-xl border p-3", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${planar ? "Planar" : "Schematic geographic"} plot of the depot, ${clients.length} clients and ${routes.length} routes`} className="max-h-96 w-full">
        {routes.map((r, i) => {
          const path = [home, ...r.visits.map((v) => byId.get(v.client_id)!).filter(Boolean), home]
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
          return (
            <circle key={p.id} cx={sx(p.x)} cy={sy(p.y)} r={4.5} strokeWidth={1.5} className="stroke-background" style={{ fill: r === undefined ? "var(--muted-foreground)" : `var(--route-${(r % 8) + 1})` }}>
              <title>{p.id}</title>
            </circle>
          )
        })}
        <rect x={sx(home.x) - 6} y={sy(home.y) - 6} width={12} height={12} rx={2} className="fill-foreground stroke-background" strokeWidth={1.5}>
          <title>{`Depot ${depot.id}`}</title>
        </rect>
      </svg>
      <figcaption className="text-muted-foreground text-xs text-pretty">
        {planar
          ? "Planar instance: abstract coordinates on equal axes (not latitude/longitude, so no map)."
          : "Geographic instance, schematic: longitude × cos(latitude) against latitude, no basemap."}{" "}
        Square: depot. Straight lines show visit order and the return to the depot, not roads.
      </figcaption>
    </figure>
  )
}
