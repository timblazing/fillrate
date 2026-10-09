import type { Metadata } from "next"

import { LandingHeader } from "@/components/landing/landing-header"
import { SiteFooter } from "@/components/landing/site-footer"
import { playgroundCaps } from "@/lib/server/playground"
import { EXAMPLES, exampleInfo } from "@/lib/server/runs"

import { PlaygroundView } from "./playground-view"

export const dynamic = "force-dynamic"
export const metadata: Metadata = {
  title: "Playground · Fillrate",
  description: "Run Fillrate's fulfillment pipeline on sample data or your own CSV files. Nothing is saved.",
}

const REPO_URL = "https://github.com/timblazing/fillrate"

// The hosted demo is a standalone page (no app sidebar), styled after the blasingame.dev design system:
// a display title over a masked dot field, then full-bleed sections separated by hairlines.
export default function PlaygroundPage() {
  const caps = playgroundCaps()
  const lesson = EXAMPLES.lesson
  const { name, orders, lines, locations } = exampleInfo(lesson)
  const example = { name, orders, lines, locations, products: lesson.scenario.products.length, depot: lesson.scenario.depot.label }
  const limits = [`Up to ${caps.maxOrders.toLocaleString("en-US")} orders`, `${caps.solveSeconds} s per run`, "One run at a time", "Nothing is saved"]

  return (
    <div className="font-ui flex min-h-dvh flex-col">
      <LandingHeader repoUrl={REPO_URL} action={{ href: `${REPO_URL}#readme`, label: "Run locally" }} />

      <main className="flex-1 overflow-x-clip">
        <section aria-labelledby="playground-title" className="relative border-b">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_70%_80%_at_70%_30%,black,transparent)] bg-size-[22px_22px]"
          />
          <div className="relative mx-auto max-w-7xl px-4 pt-16 pb-14 sm:px-6 sm:pt-24 sm:pb-20">
            <h1 id="playground-title" className="font-display text-5xl leading-none font-medium tracking-[-0.05em] text-balance sm:text-7xl">
              Plan a fuller truckload.
            </h1>
            <p className="text-muted-foreground mt-6 max-w-xl text-base leading-relaxed text-pretty sm:text-lg">
              Run the whole pipeline in your browser: allocate scarce stock to open orders, group the stops into clusters, and build truckloads with PyVRP.
            </p>
            <ul className="text-muted-foreground mt-8 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs">
              {limits.map((limit) => (
                <li key={limit} className="flex items-center gap-2">
                  <span aria-hidden="true" className="bg-muted-foreground/50 size-1 rounded-full" />
                  {limit}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <PlaygroundView caps={caps} example={example} />
      </main>

      <SiteFooter repoUrl={REPO_URL} />
    </div>
  )
}
