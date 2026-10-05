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
    href: "/learn/road-matrices",
    title: "Haversine versus recorded road matrices",
    blurb: "7 synthetic stops planned on straight-line estimates and on a synthetic recorded directed matrix: a one-way river crossing reorders the route and a ridge detour puts one stop out of reach.",
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
            recorded directed travel matrices, the allocation strategies, trailer capacity in linear feet, k-means seeds, delivery windows with service durations and the PyVRP shipment builder.
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
