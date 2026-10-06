import Link from "next/link"


export const metadata = { title: "Lessons · Fillrate" }

const LESSONS = [
  {
    href: "/learn/fulfillment-pipeline",
    title: "Fulfillment pipeline",
    blurb: "2,000 synthetic orders with scarce stock: allocate, pick k with the explorer, read per-cluster shipments and rank a sweep.",
  },
  {
    href: "/learn/allocation-policies",
    title: "Scarce stock: partial lines or whole orders",
    blurb: "90 synthetic orders and one short product: compare allocation strategies and piece-level against whole-order fulfillment.",
  },
  {
    href: "/learn/truck-capacity",
    title: "Truck capacity",
    blurb: "31 synthetic stops and plentiful stock: trailer length in linear feet sets the truck count, fill and how an oversize stop splits.",
  },
  {
    href: "/learn/seed-sensitivity",
    title: "Seeds and solver budgets",
    blurb: "60 evenly spread stops: the k-means seed changes clusters, trucks and miles; explorer stability and iteration budgets show what repeats.",
  },
  {
    href: "/learn/time-windows",
    title: "Time windows and waiting",
    blurb: "9 synthetic stops on one day: delivery windows and unloading minutes make trucks wait and need a second truck; remove the windows to compare.",
  },
  {
    href: "/learn/manual-routes",
    title: "Manual versus optimized routes",
    blurb: "10 synthetic stops on 3 trucks: evaluate a dispatcher's plans against the optimized one with the same matrix and validator, then edit your own.",
  },
  {
    href: "/learn/road-matrices",
    title: "Haversine versus recorded road matrices",
    blurb: "7 synthetic stops planned on straight-line estimates and on a synthetic recorded directed matrix: a one-way river crossing reorders the route and a ridge detour puts one stop out of reach.",
  },
  {
    href: "/learn/load-dimensions",
    title: "Multiple load dimensions",
    blurb: "12 planar stops with weight and volume: weight sets the truck count, while volume alone would suggest fewer trucks. Solver Lab runs, with and without weight.",
  },
  {
    href: "/learn/heterogeneous-fleet",
    title: "Heterogeneous fleets",
    blurb: "10 synthetic Memphis stops and 30 pallets on 3 vans and 3 box trucks: the solver uses every van and one truck; remove the vans to compare fixed and total cost.",
  },
  {
    href: "/learn/multiple-depots",
    title: "Multiple depots",
    blurb: "12 abstract-plane stops around two depots in the Solver Lab: vans based at each depot serve their own side; the same stops from one depot cost over 1.5 times as much.",
  },
  {
    href: "/learn/reloads",
    title: "Reloads and multiple trips",
    blurb: "8 abstract-plane stops beyond a yard: one 10-parcel van reloads at the yard and makes four trips; without reloading the same stops need four vans and cost over twice as much.",
  },
  {
    href: "/learn/optional-visits",
    title: "Optional visits and prizes",
    blurb: "8 abstract-plane stops, three of them remote and optional: at a prize of 60 each the solver skips them and pays 180; at 400 each it visits them and the nominal cost rises from 315 to 800.",
  },
]

// Every lesson runs the real pipeline on a bundled synthetic scenario (spec §13).
export default function LessonsPage() {
  return (
    <div className="flex min-h-dvh flex-col">

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
        <section className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Lessons</h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            Each lesson starts real runs on a synthetic scenario and lists what to look for, not fixed answers. Lessons use only features the app runs today: estimated travel,
            the allocation strategies, trailer capacity in linear feet, k-means seeds, delivery windows with service durations, the PyVRP shipment builder, the manual plan evaluator, recorded directed travel matrices and the Solver Lab's routing features (each lesson lists its model fields).
          </p>
        </section>
        <ul className="grid gap-3 sm:grid-cols-2">
          {LESSONS.map((lesson) => (
            <li key={lesson.href} className="bg-card rounded-xl border p-4">
              <h2 className="font-medium">
                <Link href={lesson.href} className="underline-offset-4 hover:underline">{lesson.title}</Link>
              </h2>
              <p className="text-muted-foreground mt-1 text-sm text-pretty">{lesson.blurb}</p>
            </li>
          ))}
        </ul>
      </main>
    </div>
  )
}
