"use client"

import { ArrowUpRight, Check, Circle, FileText, GitBranch, Maximize2, Shapes } from "lucide-react"
import Link from "next/link"
import { useEffect, useState, type ReactNode } from "react"

import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { DOC_PATHS, parseProjectDocs, RAW_BASE, type Block, type DocSources, type ProjectDocs } from "@/lib/project-docs"
import { cn } from "@/lib/utils"

import { Md } from "./md"
import type { MilestoneState } from "./status"

const REPO_URL = "https://github.com/timblazing/fillrate"

const stateStyle: Record<MilestoneState, { label: string; fill: string; badge: "success" | "info" | "warning" | "outline" }> = {
  done: { label: "Done", fill: "bg-success", badge: "success" },
  active: { label: "In progress", fill: "bg-info", badge: "info" },
  waiting: { label: "Waiting on review", fill: "bg-warning", badge: "warning" },
  planned: { label: "Planned", fill: "bg-foreground/40", badge: "outline" },
}

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
const formatDate = (iso: string) => dateFormat.format(new Date(`${iso}T00:00:00Z`))

/** Fetches the latest docs from GitHub `main` and parses them; throws if any file is missing or malformed. */
async function fetchLatest(signal: AbortSignal): Promise<ProjectDocs> {
  const entries = await Promise.all(
    Object.entries(DOC_PATHS).map(async ([key, path]) => {
      const res = await fetch(RAW_BASE + path, { signal })
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`)
      return [key, await res.text()] as const
    })
  )
  return parseProjectDocs(Object.fromEntries(entries) as DocSources)
}

// Renders the build-time snapshot first, then swaps in the latest docs from `main` so doc-only
// changes show up without an image rebuild. Any fetch or parse failure keeps the snapshot.
export function ProgressView({ initial, blocks }: { initial: ProjectDocs; blocks: readonly (readonly [string, string])[] }) {
  const [docs, setDocs] = useState(initial)
  const [live, setLive] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchLatest(controller.signal)
      .then((latest) => {
        setDocs(latest)
        setLive(true)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn("[dev] keeping build snapshot:", error)
      })
    return () => controller.abort()
  }, [])

  const { status } = docs
  // A spec milestone without an estimate in status.json is skipped rather than rendered half-empty.
  const milestones = docs.specMilestones.flatMap((m) => {
    const estimate = status.milestones[m.id]
    return estimate ? [{ ...m, ...estimate, checklist: docs.progressMilestones.find((p) => p.id === m.id)?.items ?? [] }] : []
  })
  const overall = milestones.reduce((sum, m) => sum + (m.weight * m.done) / 100, 0)
  const focus = milestones.find((m) => m.id === status.focus)
  const decisionDays = Object.entries(Object.groupBy(docs.decisions, (d) => d.date))

  return (
    <main className="mx-auto max-w-6xl space-y-20 px-4 pt-12 pb-32 sm:px-6 sm:pt-16">
      {/* Overview */}
      <section aria-labelledby="overview" className="space-y-10">
        <div className="space-y-3">
          <p className="text-muted-foreground font-mono text-xs tracking-wide uppercase">
            Spec v{docs.spec.version} · revised {docs.spec.revised} · estimates {formatDate(status.updated)} · {live ? "live from main" : "build snapshot"}
          </p>
          <h1 id="overview" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Build progress
          </h1>
        </div>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
          <div className="flex items-end gap-6">
            <div>
              <div className="font-mono text-7xl font-semibold tracking-tighter tabular-nums sm:text-8xl">
                {Math.round(overall)}
                <span className="text-muted-foreground text-5xl sm:text-6xl">%</span>
              </div>
              <p className="text-muted-foreground mt-2 text-sm">of the spec implemented, by milestone weight</p>
            </div>
            <div className="mb-7 border-l pl-6">
              <div className="font-mono text-3xl font-semibold tabular-nums">
                {status.productBehavior}
                <span className="text-muted-foreground text-xl">%</span>
              </div>
              <p className="text-muted-foreground mt-1 max-w-32 text-xs leading-snug">counting only working product behavior</p>
            </div>
          </div>

          <div className="space-y-4 text-sm leading-relaxed">
            {focus && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="info">Focus</Badge>
                <span className="font-medium">
                  {focus.id} · {focus.name}
                </span>
                <span className="text-muted-foreground font-mono text-xs tabular-nums">{focus.done}% done</span>
              </div>
            )}
            {docs.nextStep.map((b, i) =>
              b.kind === "p" ? (
                <p key={i} className="text-muted-foreground text-pretty">
                  <span className="text-foreground font-medium">Where it left off: </span>
                  <Md>{b.text}</Md>
                </p>
              ) : null
            )}
            <p className="text-muted-foreground text-pretty">
              The gallery makes the UI look further along than it is: its numbers come from a TypeScript stand-in pipeline, and
              spec §15 doesn&apos;t count fixtures as progress.
            </p>
          </div>
        </div>

        <SpecBar milestones={milestones} focus={status.focus} />
      </section>

      {/* Milestones */}
      <Section
        id="milestones"
        title="Milestones"
        description="From spec §15. Weight is each milestone's share of the whole spec; done counts real behavior only. Checklists come from docs/progress.md."
      >
        <Accordion multiple defaultValue={[status.focus]} className="bg-card rounded-2xl border">
          {milestones.map((m) => {
            const s = stateStyle[m.state]
            const checked = m.checklist.filter((c) => c.done).length
            return (
              <AccordionItem key={m.id} value={m.id} className="px-4 sm:px-6">
                <AccordionTrigger className="items-center py-5 hover:no-underline">
                  <div className="grid flex-1 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_8rem_10rem]">
                    <span className="text-muted-foreground font-mono text-sm tabular-nums">{m.id}</span>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.name}</div>
                      <div className="text-muted-foreground mt-0.5 font-mono text-xs font-normal tabular-nums">
                        {m.weight}% of spec
                        {m.checklist.length > 0 && ` · ${checked}/${m.checklist.length} tasks`}
                      </div>
                    </div>
                    <div className="col-start-2 sm:col-start-auto">
                      <Badge variant={s.badge}>{s.label}</Badge>
                    </div>
                    <div className="col-start-2 flex items-center gap-3 sm:col-start-auto">
                      <Bar value={m.done} fill={s.fill} label={`${m.id} done`} className="flex-1" />
                      <span className="w-9 text-right font-mono text-xs tabular-nums">{m.done}%</span>
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionPanel>
                  <div className="space-y-6 pb-6 sm:pl-[3.25rem]">
                    <p className="text-foreground/90 max-w-3xl text-pretty">
                      <Md>{m.notes}</Md>
                    </p>
                    <div className="grid gap-6 md:grid-cols-2">
                      <Labeled label="Deliverable">
                        <Md>{m.deliverable}</Md>
                      </Labeled>
                      <Labeled label="Exit evidence">
                        <Md>{m.exit}</Md>
                      </Labeled>
                    </div>
                    {m.checklist.length > 0 && (
                      <Labeled label={`Checklist · ${checked}/${m.checklist.length}`}>
                        <ul className="mt-1 space-y-1.5">
                          {m.checklist.map((c) => (
                            <li key={c.text} className="flex gap-2.5">
                              {c.done ? (
                                <Check className="text-success-foreground mt-0.5 size-4 shrink-0" aria-label="Done" />
                              ) : (
                                <Circle className="text-muted-foreground/60 mt-0.5 size-4 shrink-0" aria-label="Open" />
                              )}
                              <span className={cn(c.done && "text-muted-foreground")}>
                                <Md>{c.text}</Md>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </Labeled>
                    )}
                  </div>
                </AccordionPanel>
              </AccordionItem>
            )
          })}
        </Accordion>
      </Section>

      {/* Next up / waiting */}
      <div className="grid gap-12 lg:grid-cols-2">
        <Section id="next" title="Next up" description="In order. The first item is where the next session starts.">
          <ol className="space-y-3 text-sm">
            {status.nextUp.map((step, i) => (
              <li key={step} className={cn("flex gap-4 rounded-xl border p-4", i === 0 ? "bg-card" : "border-dashed")}>
                <span className={cn("font-mono text-xs tabular-nums", i === 0 ? "text-info-foreground" : "text-muted-foreground")}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={cn("text-pretty", i > 0 && "text-muted-foreground")}>
                  <Md>{step}</Md>
                </span>
              </li>
            ))}
          </ol>
        </Section>
        <Section id="waiting" title="Waiting on the primary user" description="From docs/progress.md. Open questions for the primary user.">
          <div className="bg-warning/4 dark:bg-warning/8 border-warning/24 space-y-3 rounded-xl border p-5 text-sm">
            <Blocks blocks={docs.waiting} />
          </div>
        </Section>
      </div>

      {/* Surfaces */}
      <Section id="surfaces" title="Surfaces" description="What you can open today. Everything here is development-only and runs on fixtures.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SurfaceCard href="/dev/components" icon={Shapes} title="Design system" body="Foundations, primitives, fulfillment components, charts, map, and Blocks." />
          <SurfaceCard href={REPO_URL} icon={GitBranch} title="Repository" body="Source, commits, and the web image workflow." external />
          <SurfaceCard href={`${REPO_URL}/blob/main/fillrate-technical-spec.md`} icon={FileText} title="Technical spec" body={`v${docs.spec.version}, the target this page measures against.`} external />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground mr-1 flex items-center gap-1.5">
            <Maximize2 className="size-3.5" aria-hidden /> Full-screen Blocks
          </span>
          {blocks.map(([id, title]) => (
            <Link key={id} href={`/dev/blocks/${id}`} className="hover:bg-accent rounded-md border px-2.5 py-1 transition-colors duration-150">
              {title}
            </Link>
          ))}
        </div>
      </Section>

      {/* Known gaps */}
      <Section id="gaps" title="Known gaps" description="From docs/progress.md. Limits and loose ends that aren't milestone tasks.">
        <Accordion className="bg-card rounded-2xl border px-4 sm:px-6">
          <AccordionItem value="gaps">
            <AccordionTrigger className="py-4">
              <span className="flex items-center gap-2">
                {docs.knownGaps.length} open items
                <span className="text-muted-foreground font-normal">· show all</span>
              </span>
            </AccordionTrigger>
            <AccordionPanel>
              <ul className="divide-y pb-2">
                {docs.knownGaps.map((gap) => (
                  <li key={gap} className="py-2.5 text-pretty">
                    <Md>{gap}</Md>
                  </li>
                ))}
              </ul>
            </AccordionPanel>
          </AccordionItem>
        </Accordion>
      </Section>

      {/* Decision log */}
      <Section id="decisions" title="Decision log" description={`${docs.decisions.length} entries from docs/decisions.md, newest first.`}>
        <div className="space-y-10">
          {decisionDays.map(([date, entries]) => (
            <div key={date} className="grid gap-4 md:grid-cols-[9rem_minmax(0,1fr)]">
              <div className="md:pt-0.5">
                <div className="font-medium">{formatDate(date)}</div>
                <div className="text-muted-foreground font-mono text-xs tabular-nums">{entries!.length} decisions</div>
              </div>
              <ol className="border-border relative space-y-5 border-l pl-6">
                {entries!.map((d) => (
                  <li key={d.title} className="relative">
                    <span className="bg-background border-muted-foreground/60 absolute top-1.5 -left-[1.8rem] size-2.5 rounded-full border-2" aria-hidden />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-pretty">{d.title}</span>
                      {d.author && <Badge variant="outline">{d.author}</Badge>}
                    </div>
                    {d.summary && (
                      <p className="text-muted-foreground mt-1 line-clamp-2 max-w-3xl text-sm text-pretty">
                        <Md>{d.summary}</Md>
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </Section>
    </main>
  )
}

type Row = { id: string; name: string; weight: number; done: number; state: MilestoneState }

// The whole spec as one bar: each milestone gets width by weight and fills by how much of it is done.
function SpecBar({ milestones, focus }: { milestones: Row[]; focus: string }) {
  return (
    <div className="space-y-3">
      <div className="flex gap-1" role="list" aria-label="Spec share by milestone">
        {milestones.map((m) => (
          <div key={m.id} role="listitem" style={{ flexGrow: m.weight, flexBasis: 0 }} className="min-w-0 space-y-2" title={`${m.id} ${m.name}: ${m.done}% of ${m.weight}%`}>
            <Bar value={m.done} fill={stateStyle[m.state].fill} label={`${m.id} ${m.name}`} className="h-3 rounded-sm" />
            <div className="flex items-baseline gap-1.5 truncate font-mono text-xs tabular-nums">
              <span className={cn(m.id === focus ? "text-foreground font-medium" : "text-muted-foreground")}>{m.id}</span>
              <span className="text-muted-foreground/70 hidden sm:inline">{m.weight}%</span>
            </div>
          </div>
        ))}
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {(Object.keys(stateStyle) as MilestoneState[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", stateStyle[k].fill)} aria-hidden />
            {stateStyle[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="bg-muted size-2 rounded-full border" aria-hidden />
          Not done
        </span>
      </div>
    </div>
  )
}

function Bar({ value, fill, label, className }: { value: number; fill: string; label: string; className?: string }) {
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className={cn("bg-muted h-1.5 overflow-hidden rounded-full", className)}>
      <div className={cn("h-full", fill)} style={{ width: `${value}%` }} />
    </div>
  )
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-20 space-y-5">
      <div className="space-y-1">
        <h2 id={id} className="text-xl font-semibold tracking-tight">
          {title}
        </h2>
        <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{description}</p>
      </div>
      {children}
    </section>
  )
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground font-mono text-xs tracking-wide uppercase">{label}</div>
      <div className="text-foreground/90 text-pretty">{children}</div>
    </div>
  )
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return blocks.map((b, i) =>
    b.kind === "p" ? (
      <p key={i} className="text-pretty">
        <Md>{b.text}</Md>
      </p>
    ) : (
      <ul key={i} className="list-disc space-y-1.5 pl-5">
        {b.items.map((item) => (
          <li key={item} className="text-pretty">
            <Md>{item}</Md>
          </li>
        ))}
      </ul>
    )
  )
}

function SurfaceCard({ href, icon: Icon, title, body, external }: { href: string; icon: typeof Shapes; title: string; body: string; external?: boolean }) {
  const className = "group bg-card hover:border-foreground/24 flex flex-col gap-3 rounded-xl border p-4 transition-colors duration-150"
  const content = (
    <>
      <div className="flex items-center justify-between">
        <Icon className="text-muted-foreground size-5" aria-hidden />
        <ArrowUpRight className="text-muted-foreground group-hover:text-foreground size-4 transition-colors duration-150" aria-hidden />
      </div>
      <div>
        <div className="font-medium">{title}</div>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">{body}</p>
      </div>
    </>
  )
  return external ? (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {content}
    </a>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  )
}
