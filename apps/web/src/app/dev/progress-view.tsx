"use client"

import { Check, Circle } from "lucide-react"
import dynamic from "next/dynamic"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Accordion, AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion"
import { Button } from "@/components/ui/button"
import { DOC_PATHS, parseProjectDocs, RAW_BASE, type DocSources, type ProjectDocs } from "@/lib/project-docs"
import { cn } from "@/lib/utils"

import { Md } from "./md"
import type { MilestoneState } from "./status"

// Client-only: the graph is dated from the viewer's clock, so it must not render in the static build.
const CommitGraph = dynamic(() => import("./commit-graph").then((m) => m.CommitGraph), {
  ssr: false,
  loading: () => <div className="bg-muted/50 h-[176px] animate-pulse rounded-lg" />,
})

const GAPS_PREVIEW = 5
const DECISIONS_PAGE = 12

const stateStyle: Record<MilestoneState, { label: string; dot: string; stroke: string; text: string }> = {
  done: { label: "Done", dot: "bg-success", stroke: "stroke-success", text: "text-success-foreground" },
  active: { label: "In progress", dot: "bg-info", stroke: "stroke-info", text: "text-info-foreground" },
  waiting: { label: "Waiting on review", dot: "bg-warning", stroke: "stroke-warning", text: "text-warning-foreground" },
  planned: { label: "Planned", dot: "bg-muted-foreground/50", stroke: "stroke-muted-foreground/50", text: "text-muted-foreground" },
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

type Milestone = ProjectDocs["specMilestones"][number] &
  ProjectDocs["status"]["milestones"][string] & { checklist: ProjectDocs["progressMilestones"][number]["items"] }

// Renders the build-time snapshot first, then swaps in the latest docs from `main` so doc-only
// changes show up without an image rebuild. Any fetch or parse failure keeps the snapshot.
export function ProgressView({ initial }: { initial: ProjectDocs }) {
  const [docs, setDocs] = useState(initial)

  useEffect(() => {
    const controller = new AbortController()
    fetchLatest(controller.signal)
      .then((latest) => {
        setDocs(latest)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn("[dev] keeping build snapshot:", error)
      })
    return () => controller.abort()
  }, [])

  const { status } = docs
  // A spec milestone without an estimate in status.json is skipped rather than rendered half-empty.
  const milestones: Milestone[] = docs.specMilestones.flatMap((m) => {
    const estimate = status.milestones[m.id]
    return estimate ? [{ ...m, ...estimate, checklist: docs.progressMilestones.find((p) => p.id === m.id)?.items ?? [] }] : []
  })
  const overall = milestones.reduce((sum, m) => sum + (m.weight * m.done) / 100, 0)
  const doneCount = milestones.filter((m) => m.state === "done").length
  const tasks = milestones.flatMap((m) => m.checklist)
  const tasksDone = tasks.filter((t) => t.done).length

  return (
    <main className="mx-auto max-w-5xl px-4 pt-10 pb-32 sm:px-6 sm:pt-14">
      <h1 className="sr-only">Fillrate progress</h1>
      {/* Stats */}
      <dl aria-label="Build progress" className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Spec by milestone weight" value={`${Math.round(overall)}%`} hint="weighted completion" className="col-span-2 sm:col-span-1" />
        <Stat label="Product behavior" value={`${status.productBehavior}%`} hint="working, non-fixture" />
        <Stat label="Milestones done" value={`${doneCount}/${milestones.length}`} hint={`${milestones.filter((m) => m.state === "active").length} in progress`} />
        <Stat label="Tasks checked" value={`${tasksDone}/${tasks.length}`} hint="from docs/progress.md" />
        <Stat label="Decisions logged" value={String(docs.decisions.length)} hint={`latest ${formatDate(docs.decisions[0]?.date ?? status.updated)}`} />
      </dl>

      {/* Pipeline */}
      <Section id="pipeline" title="Pipeline" description="Each milestone in spec order. The ring fills with how much of it is done.">
        <Pipeline milestones={milestones} focus={status.focus} />
      </Section>

      {/* Activity */}
      <Section id="activity" title="Activity" description="Commits to main over the last three months, from GitHub.">
        <CommitGraph />
      </Section>

      {/* Milestones */}
      <Section
        id="milestones"
        title="Milestones"
        description="From spec §15. Weight is each milestone's share of the spec. Checklists come from docs/progress.md."
      >
        <Accordion multiple className="border-t">
          {milestones.map((m) => (
            <MilestoneRow key={m.id} m={m} />
          ))}
        </Accordion>
      </Section>

      {/* Known gaps */}
      <Section id="gaps" title="Known gaps" description="From docs/progress.md. Limits and loose ends that aren't milestone tasks.">
        <KnownGaps gaps={docs.knownGaps} />
      </Section>

      {/* Decision log */}
      <Section id="decisions" title="Decision log" description={`${docs.decisions.length} entries from docs/decisions.md, newest first.`}>
        <DecisionLog decisions={docs.decisions} />
      </Section>
    </main>
  )
}

function Stat({ label, value, hint, className }: { label: string; value: string; hint: string; className?: string }) {
  return (
    <div className={cn("bg-background space-y-1 p-5", className)}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-mono text-2xl font-semibold tracking-tight tabular-nums">{value}</dd>
      <dd className="text-muted-foreground/80 text-xs">{hint}</dd>
    </div>
  )
}

// Milestones as a connected track of progress rings, scrolling sideways on narrow screens.
function Pipeline({ milestones, focus }: { milestones: Milestone[]; focus: string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      <ol className="grid min-w-[44rem]" style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}>
        {milestones.map((m, i) => {
          const s = stateStyle[m.state]
          const next = milestones[i + 1]
          return (
            <li key={m.id} className="relative flex flex-col items-center px-1 text-center">
              {next && (
                <span
                  aria-hidden
                  className={cn("absolute top-6 left-[calc(50%+1.75rem)] h-px w-[calc(100%-3.5rem)]", m.state === "done" ? "bg-success/60" : "bg-border")}
                />
              )}
              <Ring value={m.done} stroke={s.stroke} label={m.id} highlight={m.id === focus} />
              <div className="mt-3 line-clamp-2 min-h-[2.5em] text-xs leading-tight font-medium text-balance">{m.name}</div>
              <div className="text-muted-foreground mt-1.5 flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
                <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
                {m.done}%
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Ring({ value, stroke, label, highlight }: { value: number; stroke: string; label: string; highlight: boolean }) {
  const r = 21
  const c = 2 * Math.PI * r
  return (
    <div role="meter" aria-label={`${label} done`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} className="relative size-12">
      <svg viewBox="0 0 48 48" className="size-12 -rotate-90">
        <circle cx={24} cy={24} r={r} fill="none" strokeWidth={3} className="stroke-muted" />
        <circle
          cx={24}
          cy={24}
          r={r}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          className={cn(stroke, "transition-[stroke-dashoffset] duration-700 ease-out")}
        />
      </svg>
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-mono text-xs font-medium",
          highlight ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {value === 100 ? <Check className="text-success-foreground size-4" aria-hidden /> : label}
      </span>
    </div>
  )
}

function MilestoneRow({ m }: { m: Milestone }) {
  const s = stateStyle[m.state]
  const checked = m.checklist.filter((c) => c.done).length
  return (
    <AccordionItem value={m.id} className="border-b last:border-b">
      <AccordionTrigger className="items-center py-5 hover:no-underline">
        <div className="grid flex-1 grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_9rem_8rem]">
          <span className="text-muted-foreground font-mono text-sm tabular-nums">{m.id}</span>
          <div className="min-w-0">
            <div className="truncate font-medium">{m.name}</div>
            <div className="text-muted-foreground mt-0.5 font-mono text-xs font-normal tabular-nums">
              {m.weight}% of spec
              {m.checklist.length > 0 && ` · ${checked}/${m.checklist.length} tasks`}
            </div>
          </div>
          <span className={cn("col-start-2 flex items-center gap-2 text-xs font-normal sm:col-start-auto", s.text)}>
            <span className={cn("size-1.5 rounded-full", s.dot)} aria-hidden />
            {s.label}
          </span>
          <div className="col-start-2 flex items-center gap-3 sm:col-start-auto">
            <div className="bg-muted h-1 flex-1 overflow-hidden rounded-full" aria-hidden>
              <div className={cn("h-full rounded-full", s.dot)} style={{ width: `${m.done}%` }} />
            </div>
            <span className="w-9 text-right font-mono text-xs font-normal tabular-nums">{m.done}%</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionPanel>
        <div className="space-y-6 pb-6 sm:pl-[3.5rem]">
          <p className="text-foreground/90 max-w-3xl leading-relaxed text-pretty">
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
}

function KnownGaps({ gaps }: { gaps: string[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? gaps : gaps.slice(0, GAPS_PREVIEW)
  return (
    <div>
      <ol className="divide-y border-t border-b text-sm">
        {shown.map((gap, i) => (
          <li key={gap} className="flex gap-4 py-3.5">
            <span className="text-muted-foreground/70 w-6 shrink-0 font-mono text-xs tabular-nums leading-5">{String(i + 1).padStart(2, "0")}</span>
            <span className="text-foreground/90 min-w-0 text-pretty [overflow-wrap:anywhere]">
              <Md>{gap}</Md>
            </span>
          </li>
        ))}
      </ol>
      {gaps.length > GAPS_PREVIEW && (
        <Button variant="ghost" size="sm" className="text-muted-foreground mt-3 -ml-2" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${gaps.length}`}
        </Button>
      )}
    </div>
  )
}

const authorStyle = (author: string) =>
  /codex/i.test(author)
    ? "bg-blue-500/10 text-blue-700 ring-blue-500/25 dark:text-blue-300"
    : /claude/i.test(author)
      ? "bg-orange-500/10 text-orange-700 ring-orange-500/25 dark:text-orange-300"
      : "bg-muted text-muted-foreground ring-border"

function AuthorBadge({ author }: { author: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset", authorStyle(author))}>
      {author}
    </span>
  )
}

// Loads another page of entries as the sentinel scrolls into view; the button is the keyboard/no-IO fallback.
function DecisionLog({ decisions }: { decisions: ProjectDocs["decisions"] }) {
  const [count, setCount] = useState(DECISIONS_PAGE)
  const sentinel = useRef<HTMLDivElement>(null)
  const more = count < decisions.length

  useEffect(() => {
    const el = sentinel.current
    if (!el || !more) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => c + DECISIONS_PAGE)
    }, { rootMargin: "200px" })
    io.observe(el)
    return () => io.disconnect()
  }, [more])

  const days = Object.entries(Object.groupBy(decisions.slice(0, count), (d) => d.date))

  return (
    <div className="space-y-10">
      {days.map(([date, entries]) => (
        <div key={date} className="grid grid-cols-1 gap-4 md:grid-cols-[9rem_minmax(0,1fr)]">
          <div className="md:pt-0.5">
            <div className="font-medium">{formatDate(date)}</div>
            <div className="text-muted-foreground font-mono text-xs tabular-nums">
              {decisions.filter((d) => d.date === date).length} decisions
            </div>
          </div>
          <ol className="border-border relative space-y-6 border-l pl-6">
            {entries!.map((d) => (
              <li key={d.title} className="relative min-w-0 [overflow-wrap:anywhere]">
                <span className="bg-background border-muted-foreground/60 absolute top-1.5 -left-[1.8rem] size-2.5 rounded-full border-2" aria-hidden />
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                  <span className="font-medium text-pretty">{d.title}</span>
                  {d.author && <AuthorBadge author={d.author} />}
                </div>
                {d.summary && (
                  <p className="text-muted-foreground mt-1.5 line-clamp-2 max-w-3xl text-sm text-pretty">
                    <Md>{d.summary}</Md>
                  </p>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}
      {more && (
        <div ref={sentinel} className="flex justify-center">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setCount((c) => c + DECISIONS_PAGE)}>
            Load more · {decisions.length - count} left
          </Button>
        </div>
      )}
    </div>
  )
}

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-20 scroll-mt-20 space-y-6">
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
