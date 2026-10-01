import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { DevHeader } from "@/components/brand/dev-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { initializeDatabase } from "@/lib/server/database"
import { canUseReview } from "@/lib/server/review"

import { DeleteResponse } from "./delete-response"
import { OTHER, otherKey, reviewSections, type Answer, type Answers, type Question } from "../questions"

export const metadata: Metadata = { title: "Review responses · Fillrate", robots: { index: false } }

function label(q: Question, answers: Answers): string | null {
  const a: Answer | undefined = answers[q.id]
  if (a == null || (Array.isArray(a) ? !a.length : !a.trim())) return null
  if (q.kind === "text") return a as string
  const name = (v: string) => (v === OTHER ? `Other: ${answers[otherKey(q.id)] ?? ""}` : (q.options.find(([o]) => o === v)?.[1] ?? v))
  return Array.isArray(a) ? a.map(name).join(" · ") : name(a)
}

// Owner view of the design review answers. Same key as the review link.
export default async function ResponsesPage({ searchParams }: PageProps<"/dev/review/responses">) {
  const key = (await searchParams).key
  const reviewKey = typeof key === "string" ? key : null
  if (!canUseReview(reviewKey)) notFound()
  // Round-one rows stay in the table (and in docs/reviews); this view shows round two. JSON download has both.
  const all = initializeDatabase().listReviews()
  const reviews = all.filter((r) => Object.keys(r.answers).some((k) => k.startsWith("r2.")))
  const earlier = all.length - reviews.length
  const stamp = (ms: number) => new Date(ms).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Chicago" })

  return (
    <>
    <DevHeader />
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Review responses · round two</h1>
        <Badge variant="outline">{reviews.length}</Badge>
        {earlier > 0 && <span className="text-muted-foreground text-xs">{earlier} round-one or empty rows hidden</span>}
        <Button variant="outline" size="sm" className="ml-auto" render={<a href={`/dev/review/responses/json${reviewKey ? `?key=${encodeURIComponent(reviewKey)}` : ""}`} />}>
          Download JSON
        </Button>
      </header>
      {reviews.length === 0 && <p className="text-muted-foreground text-sm">No responses yet.</p>}
      {reviews.map((r) => {
        const answers = r.answers as Answers
        return (
          <article key={r.id} className="bg-card space-y-6 rounded-2xl border p-6">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">{r.reviewer || `Response ${r.id.slice(0, 8)}`}</h2>
              {r.submittedAt ? <Badge variant="success">Submitted {stamp(r.submittedAt)}</Badge> : <Badge variant="warning">Draft</Badge>}
              <span className="text-muted-foreground ml-auto text-xs">Last saved {stamp(r.updatedAt)}</span>
              <DeleteResponse id={r.id} reviewKey={reviewKey} />
            </div>
            {reviewSections.map((s) => (
              <section key={s.id} className="space-y-2">
                <h3 className="text-sm font-semibold">{s.title}</h3>
                <dl className="divide-y rounded-xl border text-sm">
                  {s.questions.map((q) => {
                    const value = label(q, answers)
                    return (
                      <div key={q.id} className="grid gap-1 px-3 py-2 sm:grid-cols-[1fr_1fr] sm:gap-4">
                        <dt className="text-muted-foreground text-pretty">{q.prompt}</dt>
                        <dd className={value ? "whitespace-pre-wrap" : "text-muted-foreground/60"}>{value ?? "—"}</dd>
                      </div>
                    )
                  })}
                </dl>
              </section>
            ))}
          </article>
        )
      })}
    </main>
    </>
  )
}
