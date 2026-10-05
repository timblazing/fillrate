import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, ArrowUpRight, Plus } from "lucide-react"

import HeroGlobe from "@/components/animated/hero-globe"
import { BrandLink } from "@/components/brand/brand-link"
import { LandingHeader } from "@/components/landing/landing-header"
import { Button } from "@/components/ui/button"

const REPO_URL = "https://github.com/timblazing/fillrate"

export const metadata: Metadata = {
  title: "Fillrate · Plan fuller truckloads",
  description:
    "An open-source planning workbench for allocating limited inventory, grouping delivery stops, and building truckloads with PyVRP.",
}

const questions = [
  {
    question: "What is Fillrate?",
    answer:
      "An open-source planning workbench for exploring how available inventory can fulfill open orders and how those deliveries can be grouped into truckloads.",
  },
  {
    question: "Does it provide live tracking or turn-by-turn directions?",
    answer:
      "No. Fillrate plans and compares routes; it is not a dispatch, live-tracking, or navigation system.",
  },
  {
    question: "How are travel distances calculated?",
    answer:
      "The default is an estimated distance based on straight-line distance and a configurable circuity factor. Fillrate labels estimated travel clearly. Imported directed travel matrices are also supported.",
  },
  {
    question: "Can I use my own orders and inventory?",
    answer:
      "Yes. Import orders, stock, and vehicles as a scenario, or start from one of the bundled synthetic examples to see how a plan comes together.",
  },
  {
    question: "Where can I see the code and project progress?",
    answer:
      "The source code is on GitHub. The progress page shows the project milestones and recorded evidence.",
  },
]

const linkRing = "rounded-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <LandingHeader repoUrl={REPO_URL} />

      <main className="flex-1 overflow-x-clip">
        <section aria-labelledby="hero-title" className="relative">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_60%_70%_at_75%_45%,black,transparent)] bg-size-[22px_22px]"
          />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pt-16 pb-20 sm:px-6 sm:pt-20 lg:pt-20 lg:pb-28 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] xl:gap-12">
            <div className="max-w-3xl">
              <h1 id="hero-title" className="text-foreground text-[3.25rem] leading-[0.95] font-semibold tracking-[-0.06em] text-balance sm:text-7xl xl:text-[clamp(4.5rem,6.4vw,5.25rem)]">
                Make more of <br className="hidden xl:block" />
                every truckload.
              </h1>
              <p className="text-muted-foreground mt-7 max-w-lg text-base leading-relaxed text-pretty sm:text-lg">
                Plan how limited stock can fulfill open orders, then turn those deliveries into capacity-aware routes you can inspect and compare.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <Button size="lg" className="h-11 gap-3 rounded-full pr-2 pl-5 text-sm" render={<Link href="/scenarios" />}>
                  Open Fillrate
                  <span className="bg-primary-foreground/10 flex size-7 items-center justify-center rounded-full">
                    <ArrowRight aria-hidden="true" className="size-3.5" />
                  </span>
                </Button>
                <Button size="lg" variant="ghost" className="text-muted-foreground h-11 rounded-full px-4 text-sm" render={<a href="#about" />}>
                  How it works
                </Button>
              </div>
            </div>

            <div className="-my-8 flex min-w-0 justify-center xl:my-0 xl:justify-end">
              <HeroGlobe />
            </div>
          </div>
        </section>

        <section id="about" aria-labelledby="about-title" className="mx-auto max-w-7xl scroll-mt-20 border-t px-4 py-24 sm:px-6 sm:py-32">
          <div className="grid gap-8 md:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] md:gap-16">
            <h2 id="about-title" className="text-foreground text-3xl font-medium tracking-tight sm:text-4xl">About</h2>
            <div className="max-w-2xl">
              <p className="text-foreground text-xl leading-snug font-medium tracking-tight text-pretty sm:text-[1.625rem]">
                Fillrate brings inventory allocation and vehicle routing into one workbench.{" "}
                <span className="text-muted-foreground">
                  Match limited stock to open orders, group nearby stops into delivery areas, then build capacity-aware truckloads and follow every decision through to what shipped and what didn&rsquo;t.
                </span>
              </p>
              <p className="text-muted-foreground mt-8 max-w-xl text-sm leading-relaxed">
                Routes are solved with PyVRP, and travel is an estimate unless you import your own matrix. Fillrate is for planning and comparison. It doesn&rsquo;t dispatch drivers, track vehicles, or give turn-by-turn directions.
              </p>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="group text-foreground decoration-foreground/30 hover:decoration-foreground mt-8 inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4 transition-colors focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                View the source on GitHub
                <ArrowUpRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </a>
            </div>
          </div>
        </section>

        <section id="faq" aria-labelledby="faq-title" className="mx-auto max-w-7xl scroll-mt-20 border-t px-4 py-24 sm:px-6 sm:py-32">
          <div className="grid gap-8 md:grid-cols-[minmax(12rem,0.7fr)_minmax(0,1.3fr)] md:gap-16">
            <h2 id="faq-title" className="text-foreground text-3xl font-medium tracking-tight sm:text-4xl">FAQ</h2>
            <div className="border-t">
              {questions.map((item) => (
                <details key={item.question} className="faq-item group border-b">
                  <summary className="text-foreground hover:text-foreground/80 flex cursor-pointer list-none items-center justify-between gap-6 py-5 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    {item.question}
                    <Plus aria-hidden="true" className="text-muted-foreground group-open:text-foreground size-4 shrink-0 transition-transform duration-200 group-open:rotate-45" />
                  </summary>
                  <p className="text-muted-foreground max-w-xl pb-6 text-sm leading-relaxed">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
            <BrandLink className="[&>span]:text-sm" />
            <nav aria-label="Footer" className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <Link href="/dev" className={linkRing}>Project progress</Link>
              <Link href="/privacy" className={linkRing}>Privacy</Link>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={linkRing}>GitHub</a>
            </nav>
          </div>
          <div className="border-t py-6">
            <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed text-pretty">
              Fillrate is an open-source planning workbench. Example scenarios use synthetic data, and estimated travel is labeled as an estimate.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
