import { cn } from "@/lib/utils"

// Gallery table of contents: groups (h2) and their specimens (anchors). Drives the nav, scroll-spy, and ⌘K.
export const toc = [
  {
    id: "foundations",
    title: "Foundations",
    items: [
      ["color", "Color"],
      ["status-color", "Status & fill bands"],
      ["route-palette", "Series palette"],
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
    title: "Fulfillment components",
    items: [
      ["status", "Status & provenance"],
      ["fill", "Truck fill"],
      ["stages", "Pipeline stages"],
      ["run-metrics", "Run metrics"],
      ["cluster-cards", "Cluster cards"],
      ["truck-loads", "Truck loads"],
      ["unshipped", "Unshipped lines"],
      ["stock", "Inventory coverage"],
      ["orders", "Order lines table"],
      ["iterations", "Iteration table"],
      ["diagnostics", "Preflight checks"],
      ["settings", "Settings rows"],
      ["imports", "Imports"],
      ["runs", "Runs & jobs"],
      ["compare", "Run diff"],
      ["exports", "Exports"],
    ],
  },
  {
    id: "charts",
    title: "Charts",
    items: [
      ["fill-distribution", "Fill distribution"],
      ["k-elbow", "k explorer: elbow & stability"],
      ["tradeoff", "Iteration trade-off"],
      ["cluster-scatter", "Cluster tightness vs fill"],
      ["revenue-funnel", "Revenue funnel"],
      ["by-product", "Allocation by product"],
      ["radar", "Iteration radar"],
      ["rings", "Headline rings"],
      ["convergence", "Per-cluster convergence"],
    ],
  },
  {
    id: "maps",
    title: "Map",
    items: [
      ["map", "Pipeline map"],
      ["map-confidence", "Confidence map"],
    ],
  },
  {
    id: "blocks",
    title: "Blocks",
    items: [
      ["workbench", "Workbench"],
      ["orders-inventory", "Orders & inventory"],
      ["run-pipeline", "Run pipeline"],
      ["results", "Results"],
      ["k-explorer", "k explorer"],
      ["comparison", "Iteration comparison"],
    ],
  },
  {
    id: "later",
    title: "Later milestones",
    items: [
      ["timeline", "Route timeline"],
      ["matrix", "Matrix inspector"],
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
  actions,
  className,
  bodyClassName,
  children,
}: {
  id: string
  title: string
  description?: string
  source?: string
  spec?: string
  /** Controls at the end of the title row (e.g. open full screen). */
  actions?: React.ReactNode
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
        {actions && <div className={cn("flex items-center gap-2", !source && "ml-auto")}>{actions}</div>}
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
