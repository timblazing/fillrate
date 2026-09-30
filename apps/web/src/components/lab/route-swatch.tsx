import { cn } from "@/lib/utils"

// Stable per-route color plus a number, so routes never rely on color alone (spec §4).
export function routeColor(route: number) {
  return `var(--route-${((route - 1) % 8) + 1})`
}

export function RouteSwatch({
  route,
  size = "md",
  className,
}: {
  route: number
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white tabular-nums shadow-sm ring-1 ring-black/10",
        size === "sm" ? "size-4 text-[9px]" : "size-5 text-[10px]",
        className
      )}
      style={{ background: routeColor(route) }}
    >
      {route}
    </span>
  )
}

export function RouteLegend({
  routes,
  active,
  onToggle,
  className,
}: {
  routes: readonly number[]
  active?: number | null
  onToggle?: (route: number) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {routes.map((route) => {
        const dimmed = active != null && active !== route
        return (
          <button
            key={route}
            type="button"
            aria-pressed={active === route}
            onClick={() => onToggle?.(route)}
            className={cn(
              "hover:bg-muted flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs transition-[opacity,background-color] duration-150",
              active === route && "bg-muted border-foreground/20",
              dimmed && "opacity-45"
            )}
          >
            <RouteSwatch route={route} size="sm" />
            Route {route}
          </button>
        )
      })}
    </div>
  )
}

// Clusters share the series palette. Trucks inherit their cluster's color and are told apart by label (C3-T2).
export function ClusterSwatch({
  cluster,
  size = "md",
  className,
}: {
  cluster: number
  size?: "sm" | "md"
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold text-white tabular-nums shadow-sm ring-1 ring-black/10",
        size === "sm" ? "h-4 min-w-4 px-0.5 text-[9px]" : "h-5 min-w-5 px-1 text-[10px]",
        className
      )}
      style={{ background: routeColor(cluster) }}
    >
      C{cluster}
    </span>
  )
}

export function TruckTag({ id, cluster, className }: { id: string; cluster: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs font-medium tabular-nums", className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: routeColor(cluster) }} aria-hidden />
      {id}
    </span>
  )
}

export function ClusterLegend({
  clusters,
  active,
  onToggle,
  className,
}: {
  clusters: readonly number[]
  active?: number | null
  onToggle?: (cluster: number) => void
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      {clusters.map((c) => (
        <button
          key={c}
          type="button"
          aria-pressed={active === c}
          aria-label={`Cluster ${c}`}
          onClick={() => onToggle?.(c)}
          className={cn(
            "rounded-md p-0.5 transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
            active != null && active !== c && "opacity-35 hover:opacity-70",
            active === c && "ring-foreground/30 ring-1"
          )}
        >
          <ClusterSwatch cluster={c} />
        </button>
      ))}
    </div>
  )
}
