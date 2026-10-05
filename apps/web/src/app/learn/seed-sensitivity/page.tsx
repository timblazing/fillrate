import Link from "next/link"

import { DevHeader } from "@/components/brand/dev-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EXAMPLES, exampleInfo, maxSweepRuns, canStartRuns, runsClosedNote } from "@/lib/server/runs"
import { pagePrincipal } from "@/lib/server/access"
import { formatFeet } from "@/lib/units"

import { ModelFields } from "../lesson-kit"
import { SeedSteps } from "./seed-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: seeds and solver budgets · Fillrate" }

// Seed lesson (spec §13): k-means seeds, explorer stability and the solver's iteration budget.
// Synthetic data only; routing uses the pipeline's estimated haversine travel, not road matrices.
export default async function SeedSensitivityLessonPage({ searchParams }: PageProps<"/learn/seed-sensitivity">) {
  const { key } = await searchParams
  const { scenario, settings } = EXAMPLES.seeds
  const info = exampleInfo(EXAMPLES.seeds)
  const products = scenario.products.map((p) => ({ ...p, ordered: 0 }))
  for (const o of scenario.orders)
    for (const l of o.lines) {
      const row = products.find((p) => p.id === l.product_id)
      if (row) row.ordered += l.ordered_pieces
    }
  const total = products.reduce((n, p) => n + p.ordered * p.linear_feet_per_piece, 0)
  const capacity = settings.trailer_capacity ?? 5300

  return (
    <div className="flex min-h-dvh flex-col">
      <DevHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <Link href="/learn" className="text-muted-foreground text-sm underline underline-offset-4">Lessons</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Seeds and solver budgets</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            {info.orders} synthetic orders, one per stop, spread evenly over a disc around a Memphis DC with no natural markets, so there are many near-equal ways to cut the stops
            into k = {info.k} groups. K-means starts from random centers: the seed picks the start, and with a single start it also picks the result. A different cut means
            different clusters, trucks and miles from the same stops. You will change the seed, sweep several, measure how much the seeds disagree and see which choices repeat exactly.
            Every step starts a real run on this server; the numbers are what to look for, not fixed answers. Travel is estimated (straight-line distance × 1.2).
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Freight to cluster</h2>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Trailer length per piece</TableHead>
                  <TableHead className="text-right">Ordered pieces</TableHead>
                  <TableHead className="text-right">Trailer length ordered</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.label} <span className="text-muted-foreground font-mono text-xs">{p.id}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{formatFeet(p.linear_feet_per_piece)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.ordered.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatFeet(p.ordered * p.linear_feet_per_piece)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-muted-foreground text-sm text-pretty">
            Stock covers every order. {formatFeet(total)} ÷ {formatFeet(capacity)} per trailer: at least {Math.ceil(total / capacity)} trucks, whatever the seed.
          </p>
        </section>

        <ModelFields
          fields={[
            ["settings.k", "Number of clusters; fixed at 5 here."],
            ["settings.kmeans_seed, kmeans_n_init", "K-means start seed and the number of starts. This lesson uses one start (n_init = 1), so the seed decides the clusters; the default of 10 starts hides most seed differences."],
            ["settings.solver_seed", "Seed of the PyVRP search inside each cluster."],
            ["settings.solver_max_iterations", "An iteration budget: PyVRP stops after exactly this many iterations per cluster (300 here), so a run repeats exactly."],
            ["settings.solver_time_limit_s", "A time budget: PyVRP stops at the clock (10 s here, as a ceiling). The iteration count a time budget reaches depends on the machine and its load."],
            ["explorer: seeds, ks", "Clusters the same stops for several k and seeds without solving routes, and reports stability: the mean pairwise adjusted Rand index between seeds (1.00 means every seed gives the same grouping)."],
          ]}
          notModeled="changing the iteration or time budget in this lesson (the public examples keep their fixed budget); an optimality proof for routes (PyVRP is a heuristic); cluster balance or minimum cluster size targets."
        />

        <SeedSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={typeof key === "string" ? key : undefined} sweepLimit={maxSweepRuns()} iterations={settings.solver_max_iterations ?? null} />
      </main>
    </div>
  )
}
