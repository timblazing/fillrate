import { cn } from "@/lib/utils"

// Gallery table of contents: groups (h2) and their specimens (anchors). Drives the nav, scroll-spy, and ⌘K.
export const toc = [
  {
    id: "foundations",
    title: "Foundations",
    items: [
      ["color", "Color"],
      ["route-palette", "Route palette"],
      ["type", "Typography"],
      ["radius", "Radius & elevation"],
    ],
  },
  {
    id: "primitives",
    title: "Primitives",
    items: [
      ["actions", "Actions"],
      ["forms", "Form controls"],
      ["overlays", "Overlays & menus"],
      ["navigation", "Navigation"],
      ["display", "Data display"],
      ["feedback", "Feedback"],
      ["layout", "Layout"],
    ],
  },
  {
    id: "lab",
    title: "Lab components",
    items: [
      ["status", "Status & provenance"],
      ["metrics", "Metric tiles"],
      ["timeline", "Route timeline"],
      ["table", "Data table"],
      ["diagnostics", "Preflight diagnostics"],
      ["matrix", "Matrix inspector"],
      ["settings", "Settings rows"],
      ["imports", "Imports"],
      ["runs", "Runs & jobs"],
      ["compare", "Comparison"],
      ["exports", "Exports"],
    ],
  },
  {
    id: "charts",
    title: "Charts",
    items: [
      ["convergence", "Convergence"],
      ["objective", "Objective breakdown"],
      ["utilization", "Capacity utilization"],
      ["workload", "Workload distribution"],
      ["sweep", "Seed sweep"],
      ["radar", "Run comparison radar"],
      ["funnel", "Fulfillment funnel"],
      ["rings", "Progress rings"],
      ["fulfillment", "Fulfillment by product"],
    ],
  },
  {
    id: "maps",
    title: "Map",
    items: [["map", "Routes map"]],
  },
  {
    id: "blocks",
    title: "Blocks",
    items: [
      ["workbench", "Workbench"],
      ["results-header", "Results header"],
    ],
  },
] as const

export function Group({
  id,
  index,
  title,
  description,
  children,
}: {
  id: string
  index: number
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-20 space-y-8">
      <header className="flex items-end gap-4 border-b pb-4">
        <span className="text-muted-foreground/50 font-mono text-4xl leading-none font-semibold tabular-nums">
          {String(index).padStart(2, "0")}
        </span>
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{description}</p>
        </div>
      </header>
      {children}
    </section>
  )
}

// One component (or recipe) with its name, what it's for, and where it lives.
export function Specimen({
  id,
  title,
  description,
  source,
  spec,
  className,
  bodyClassName,
  children,
}: {
  id: string
  title: string
  description?: string
  source?: string
  spec?: string
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <article id={id} className={cn("scroll-mt-20 space-y-3", className)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-medium">
          <a href={`#${id}`} className="group/anchor hover:underline hover:underline-offset-4">
            {title}
            <span className="text-muted-foreground ml-1.5 opacity-0 transition-opacity group-hover/anchor:opacity-100">
              #
            </span>
          </a>
        </h3>
        {spec && <span className="text-muted-foreground text-xs">spec {spec}</span>}
        {source && (
          <code className="text-muted-foreground bg-muted ml-auto rounded-md px-1.5 py-0.5 font-mono text-[11px]">
            {source}
          </code>
        )}
      </div>
      {description && <p className="text-muted-foreground -mt-1 max-w-3xl text-sm text-pretty">{description}</p>}
      <div
        className={cn(
          "bg-card relative overflow-x-auto rounded-2xl border p-4 sm:p-6 [background-image:radial-gradient(var(--border)_1px,transparent_1px)] [background-size:16px_16px]",
          bodyClassName
        )}
      >
        {children}
      </div>
    </article>
  )
}

export function Row({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-2.5", className)}>
      <div className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">{label}</div>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}
