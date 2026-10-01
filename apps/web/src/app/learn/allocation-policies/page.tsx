import { DevHeader } from "@/components/brand/dev-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EXAMPLES, exampleInfo, canStartRuns, runsClosedNote } from "@/lib/server/runs"
import { pagePrincipal } from "@/lib/server/access"
import Link from "next/link"

import { AllocationSteps } from "./allocation-steps"

export const dynamic = "force-dynamic"
export const metadata = { title: "Lesson: scarce stock · Fillrate" }

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`

// Allocation lesson (spec §13: scarce single-product inventory; piece-level versus whole-order allocation).
// Synthetic data only; routing uses the pipeline's estimated haversine travel, not road matrices.
export default async function AllocationLessonPage({ searchParams }: PageProps<"/learn/allocation-policies">) {
  const { key } = await searchParams
  const { scenario } = EXAMPLES.allocation
  const info = exampleInfo(EXAMPLES.allocation)
  const stock = new Map(scenario.inventory.map((i) => [i.product_id, i.available_pieces]))
  const products = scenario.products.map((p) => {
    let ordered = 0, value = 0
    for (const o of scenario.orders) for (const l of o.lines) if (l.product_id === p.id) { ordered += l.ordered_pieces; value += l.ordered_pieces * l.net_value_per_piece_cents }
    const available = stock.get(p.id) ?? 0
    return { ...p, ordered, available, value, coverage: ordered ? Math.min(1, available / ordered) : 1 }
  })
  const orderedCents = products.reduce((n, p) => n + p.value, 0)

  return (
    <div className="flex min-h-dvh flex-col">
      <DevHeader />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <Link href="/learn" className="text-muted-foreground text-sm underline underline-offset-4">Lessons</Link>
          <h1 className="text-2xl font-semibold tracking-tight">Scarce stock: partial lines or whole orders</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            {info.orders} synthetic open orders ({info.lines} lines) from {info.locations} customer locations in three markets around a Memphis DC, worth {money(orderedCents)}.
            Carpet rolls are short: stock covers half of the ordered rolls. Pallets and cartons are plentiful. You will decide who gets the rolls, first by a rule and
            then by letting a solver choose, and see how filling lines piece by piece differs from shipping only complete orders. Every step starts a real run on this
            server; the numbers are what to look for, not fixed answers. Travel is estimated (straight-line distance × 1.2); road matrices are not part of this lesson.
          </p>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Stock against demand</h2>
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Ordered pieces</TableHead>
                  <TableHead className="text-right">On hand</TableHead>
                  <TableHead className="text-right">Can fill</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {products.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{p.label} <span className="text-muted-foreground font-mono text-xs">{p.id}</span></TableCell>
                    <TableCell className="text-right tabular-nums">{p.ordered.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.available.toLocaleString()}</TableCell>
                    <TableCell className={`text-right tabular-nums ${p.coverage < 1 ? "text-warning-foreground font-medium" : ""}`}>{Math.round(p.coverage * 100)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>

        <AllocationSteps open={canStartRuns(await pagePrincipal(), key)} closedNote={runsClosedNote()} runKey={typeof key === "string" ? key : undefined} />
      </main>
    </div>
  )
}
