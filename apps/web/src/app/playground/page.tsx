import type { Metadata } from "next"

import { BrandLink } from "@/components/brand/brand-link"
import { GitHubMark } from "@/components/brand/github-mark"
import { playgroundCaps } from "@/lib/server/playground"
import { EXAMPLES, exampleInfo } from "@/lib/server/runs"

import { PlaygroundView } from "./playground-view"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Playground · Fillrate",
  description:
    "A truckload planning workbench. Inspect orders and stock, run the solver, and explore shipments. Nothing is saved.",
}

const REPO_URL = "https://github.com/timblazing/fillrate"

export default function PlaygroundPage() {
  const caps = playgroundCaps()
  const lesson = EXAMPLES.lesson
  const { name, orders, lines, locations } = exampleInfo(lesson)
  const { scenario } = lesson
  const demand = new Map<string, number>()
  for (const order of scenario.orders) {
    for (const line of order.lines)
      demand.set(line.product_id, (demand.get(line.product_id) ?? 0) + line.ordered_pieces)
  }
  const example = {
    name,
    orders,
    lines,
    locations,
    products: scenario.products.length,
    depot: scenario.depot.label,
    points: scenario.locations.filter((l) => l.lat != null && l.lon != null).map((l) => ({ lat: l.lat!, lon: l.lon! })),
    origin: { lat: scenario.depot.lat, lon: scenario.depot.lon },
    stock: scenario.products.map((p) => ({
      id: p.id,
      label: p.label,
      ordered: demand.get(p.id) ?? 0,
      available: scenario.inventory.find((i) => i.product_id === p.id)?.available_pieces ?? 0,
    })),
    preview: scenario.orders.slice(0, 6).map((o) => ({
      id: o.id,
      date: o.order_date,
      location: o.location_id,
      pieces: o.lines.reduce((n, l) => n + l.ordered_pieces, 0),
      value: o.lines.reduce((n, l) => n + l.ordered_pieces * l.net_value_per_piece_cents, 0),
    })),
    k: lesson.settings.k,
  }

  return (
    <div className="flex min-h-dvh flex-col bg-muted/20">
      <header className="bg-background flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-6">
        <BrandLink className="[&>span]:text-base" />
        <span className="text-muted-foreground border-l pl-4 text-sm">Playground</span>
        <div className="ml-auto flex items-center gap-4 text-xs">
          <a
            href={`${REPO_URL}#readme`}
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            Run locally
          </a>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Fillrate on GitHub"
            className="text-muted-foreground hover:text-foreground rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            <GitHubMark className="size-4" />
          </a>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <div className="bg-background flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-6">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Truckload workbench</h1>
            <p className="text-muted-foreground mt-1 text-xs">Allocate stock. Group stops. Build loads.</p>
          </div>
          <p className="text-muted-foreground text-xs">
            <span className="text-foreground tabular-nums">{caps.maxOrders.toLocaleString("en-US")}</span> orders max{" "}
            <span className="mx-2">/</span> <span className="text-foreground tabular-nums">{caps.solveSeconds} s</span>{" "}
            run limit <span className="mx-2">/</span> Nothing saved
          </p>
        </div>
        <PlaygroundView caps={caps} example={example} />
      </main>
    </div>
  )
}
