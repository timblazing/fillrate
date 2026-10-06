import type { LabInstance, LabResult } from "@fillrate/contracts"

type Route = LabResult["routes"][number]

/**
 * Load on board along each route of a pickup-delivery instance, per dimension: a step line through the load before the
 * first stop and after every stop, against the vehicle's capacity (dashed). A pickup raises it, a delivery lowers it.
 */
export function LoadProfile({ instance, result }: { instance: LabInstance; result: LabResult }) {
  const capacity = new Map(instance.vehicle_types.map((v) => [v.id, v.capacity]))
  const dims = instance.dimensions
  const w = 320, h = 110, padL = 30, padR = 8, padT = 10, padB = 20
  return (
    <section className="flex flex-col gap-2" aria-labelledby="lab-profile">
      <h2 id="lab-profile" className="text-sm font-medium">Load on board along each route</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {result.routes.flatMap((r: Route) =>
          dims.map((d) => {
            const cap = capacity.get(r.vehicle_type)?.[d.id] ?? 0
            const levels = [r.visits[0]?.load_before[d.id] ?? 0, ...r.visits.map((v) => v.load_after[d.id])]
            const top = Math.max(cap, ...levels, 1)
            const x = (i: number) => padL + (i / Math.max(levels.length - 1, 1)) * (w - padL - padR)
            const y = (v: number) => padT + (1 - v / top) * (h - padT - padB)
            const steps = levels.map((v, i) => `${x(i)},${y(v)}`).join(" ")
            const peak = Math.max(...levels)
            return (
              <figure key={`${r.index}-${d.id}`} className="bg-card flex flex-col gap-1 rounded-xl border p-3" data-testid={`lab-profile-${r.index}-${d.id}`} data-peak={peak} data-capacity={cap}>
                <figcaption className="text-xs">
                  Route {r.index + 1} ({r.vehicle_type}), {d.id}: peak {peak.toLocaleString("en-US")} of {cap.toLocaleString("en-US")} {d.unit}
                </figcaption>
                <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Route ${r.index + 1} load in ${d.unit} after each stop: ${levels.join(", ")}; capacity ${cap}`} className="w-full">
                  <line x1={padL} x2={w - padR} y1={y(cap)} y2={y(cap)} strokeDasharray="4 3" className="stroke-muted-foreground" />
                  <text x={padL - 4} y={y(cap) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">{cap}</text>
                  <text x={padL - 4} y={y(0) + 3} textAnchor="end" className="fill-muted-foreground text-[9px]">0</text>
                  <polyline points={steps} fill="none" strokeWidth={2} strokeLinejoin="round" style={{ stroke: `var(--route-${(r.index % 8) + 1})` }} />
                  {r.visits.map((v, i) => (
                    <g key={i}>
                      <circle cx={x(i + 1)} cy={y(v.load_after[d.id])} r={3} style={{ fill: v.kind === "pickup" ? `var(--route-${(r.index % 8) + 1})` : "var(--card)", stroke: `var(--route-${(r.index % 8) + 1})` }} strokeWidth={1.5}>
                        <title>{`${v.kind} ${v.client_id}: ${v.load_after[d.id]}`}</title>
                      </circle>
                    </g>
                  ))}
                </svg>
                <p className="text-muted-foreground text-xs">
                  {r.visits.map((v) => `${v.kind === "pickup" ? "▲" : v.kind === "delivery" ? "▼" : "●"} ${v.client_id} → ${v.load_after[d.id]}`).join(", ")}
                </p>
              </figure>
            )
          }),
        )}
      </div>
      <p className="text-muted-foreground text-xs text-pretty">Filled dot: after a pickup, hollow: after a delivery or a client stop. The load starts with the client deliveries still to drop; a pair is on board from its pickup to its delivery and must never lift the line above the dashed capacity.</p>
    </section>
  )
}
