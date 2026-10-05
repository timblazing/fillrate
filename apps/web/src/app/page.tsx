import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, Plus, Truck } from "lucide-react"

import HeroGlobe from "@/components/animated/hero-globe"
import { GitHubMark } from "@/components/brand/github-mark"
import { Button } from "@/components/ui/button"

const REPO_URL = "https://github.com/timblazing/fillrate"

export const metadata: Metadata = {
  title: "Fillrate · Plan fuller truckloads",
  description:
    "An open-source planning workbench for allocating limited inventory, grouping delivery stops, and building truckloads with PyVRP.",
}

const steps = [
  {
    title: "Allocate",
    description: "Match limited inventory to open orders and see what can ship.",
  },
  {
    title: "Cluster",
    description: "Group nearby stops into a manageable set of delivery areas.",
  },
  {
    title: "Solve",
    description: "Build capacity-aware truckloads and inspect the result.",
  },
]

const questions = [
  {
    question: "What is Fillrate?",
    answer:
      "Fillrate is an open-source planning workbench for exploring how available inventory can fulfill open orders and how those deliveries can be grouped into truckloads.",
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
    question: "Where can I see the code and project progress?",
    answer:
      "The source code is on GitHub. The progress page shows the project milestones and recorded evidence.",
  },
]

export default function Home() {
  return (
    <main className="min-h-dvh">
      <header className="border-b">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="Fillrate home" className="flex shrink-0 items-center gap-2.5 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
            <Truck aria-hidden="true" className="size-5" />
            <span className="text-lg font-semibold tracking-tight">Fillrate</span>
          </Link>

          <nav aria-label="Main navigation" className="flex items-center gap-4 sm:gap-7">
            <Link href="#about" className="text-muted-foreground rounded-sm text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
              About
            </Link>
            <Link href="#faq" className="text-muted-foreground rounded-sm text-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
              FAQ
            </Link>
            <Button size="sm" render={<Link href="/scenarios" />}>
              Open Fillrate
            </Button>
          </nav>
        </div>
      </header>

      <section aria-labelledby="hero-title" className="mx-auto grid min-h-[calc(100svh-4rem)] w-full max-w-6xl items-center gap-2 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:gap-4 lg:px-8 lg:py-16">
        <div className="relative z-10 max-w-2xl py-4 lg:py-10">
          <p className="text-muted-foreground mb-6 flex items-center gap-2 text-sm">
            <span className="bg-primary size-1.5 rounded-full" aria-hidden="true" />
            Open-source fulfillment planning
          </p>
          <h1 id="hero-title" className="text-5xl leading-[1.04] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-7xl">
            Make more of every truckload.
          </h1>
          <p className="text-muted-foreground mt-6 max-w-xl text-lg leading-8 text-pretty">
            Plan how limited stock can fulfill open orders, then turn those deliveries into capacity-aware routes you can inspect and compare.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" render={<Link href="/scenarios" />}>
              Explore Fillrate <ArrowRight aria-hidden="true" />
            </Button>
            <Button size="lg" variant="outline" render={<a href={REPO_URL} target="_blank" rel="noopener noreferrer" />}>
              <GitHubMark className="size-4" />
              View on GitHub
            </Button>
          </div>
          <p className="text-muted-foreground mt-5 text-sm">A planning workbench for learning, testing, and comparing fulfillment plans.</p>
        </div>
        <div className="-my-8 flex min-w-0 justify-center lg:my-0 lg:justify-end">
          <HeroGlobe />
        </div>
      </section>

      <section id="about" aria-labelledby="about-title" className="scroll-mt-20 border-y bg-muted/40">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div>
              <h2 id="about-title" className="max-w-md text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                From available stock to a plan you can inspect.
              </h2>
              <p className="text-muted-foreground mt-5 max-w-md leading-7">
                Fillrate brings inventory allocation and vehicle routing into one research workbench. Follow the decisions through each stage, then review what shipped and what did not.
              </p>
            </div>
            <ol className="grid divide-y border-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              {steps.map((step, index) => (
                <li key={step.title} className="py-5 sm:px-5 sm:py-2 first:sm:pl-0 last:sm:pr-0">
                  <div className="text-muted-foreground mb-5 flex items-center gap-2 text-sm">
                    <span className="bg-background flex size-7 items-center justify-center rounded-full border text-xs tabular-nums" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span>{step.title}</span>
                  </div>
                  <p className="text-muted-foreground text-sm leading-6">{step.description}</p>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-muted-foreground mt-10 border-t pt-5 text-sm leading-6">
            Fillrate is for planning and comparison. It does not dispatch drivers, track vehicles, or provide turn-by-turn navigation.
          </p>
        </div>
      </section>

      <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20 lg:px-8">
          <div>
            <h2 id="faq-title" className="text-3xl font-semibold tracking-tight sm:text-4xl">Questions, answered.</h2>
            <p className="text-muted-foreground mt-4 max-w-sm leading-7">
              A little more about what Fillrate does and how to follow the project.
            </p>
          </div>
          <div className="divide-y border-y">
            {questions.map((item) => (
              <details key={item.question} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <Plus aria-hidden="true" className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-45" />
                </summary>
                <p className="text-muted-foreground max-w-2xl pt-3 pr-8 text-sm leading-6">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <Link href="/" className="font-medium tracking-tight">Fillrate</Link>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2">
            <Link href="/dev" className="hover:text-foreground">Project progress</Link>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">GitHub</a>
          </div>
        </div>
      </footer>
    </main>
  )
}
