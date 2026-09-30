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
