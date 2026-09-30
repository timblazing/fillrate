"use client"

import { Check, CircleAlert, Maximize2, Send } from "lucide-react"
import { useCallback, useRef, useState } from "react"

import { DevHeader } from "@/components/brand/dev-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { CheckboxGroup } from "@/components/ui/checkbox-group"
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Radio, RadioGroup } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import { toastManager } from "@/components/ui/toast"

import { blocks } from "../components/sections/blocks"
import { Group, Specimen } from "../components/specimen"
import { isAnswered, OTHER, otherKey, reviewSections, type Answer, type Answers, type Question } from "./questions"

const STORAGE = "fillrate.review"
type Draft = { id: string; answers: Answers; submittedAt?: number | null }
type Status = { state: "idle" | "saving" | "saved" | "error"; at?: number; error?: string }

function readDraft(): Draft {
  try {
    const raw = localStorage.getItem(STORAGE)
    if (raw) return JSON.parse(raw) as Draft
  } catch {}
  return { id: crypto.randomUUID(), answers: {} }
}

function writeDraft(draft: Draft) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(draft))
  } catch {}
}

const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })

// Client-only (see loader.tsx): the draft comes from localStorage on first render.
// Rendered client-only (loader.tsx) because the draft is read from localStorage on first render.
// M2 design review: each block from the gallery with its questions. Answers autosave to the server's SQLite file
// (and to this browser, so a failed save loses nothing).
export function Review({ reviewKey, canSave }: { reviewKey: string | null; canSave: boolean }) {
  const [draft, setDraft] = useState<Draft>(readDraft)
  const [status, setStatus] = useState<Status>({ state: "idle" })
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const save = useCallback(
    async (next: Draft, submit = false) => {
      if (!canSave) return false
      setStatus({ state: "saving" })
      try {
        const res = await fetch("/dev/review/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: next.id, reviewer: next.answers["you.name"] ?? "", answers: next.answers, submit, key: reviewKey }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? "Could not save.")
        setStatus({ state: "saved", at: body.savedAt })
        if (submit) {
          const done = { ...next, submittedAt: body.submittedAt as number }
          setDraft(done)
          writeDraft(done)
        }
        return true
      } catch (error) {
        setStatus({ state: "error", error: error instanceof Error ? error.message : "Could not save." })
        return false
      }
    },
    [canSave, reviewKey]
  )

  const setAnswer = (id: string, value: Answer) => {
    const next = { ...draft, answers: { ...draft.answers, [id]: value } }
    setDraft(next)
    writeDraft(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(next), 1200)
  }

  const submit = async () => {
    clearTimeout(timer.current)
    const ok = await save(draft, true)
    toastManager.add(
      ok
        ? { type: "success", title: "Submitted. Thank you!", description: "You can still change answers; they keep saving." }
        : { type: "error", title: "Couldn't submit", description: "Your answers are kept in this browser. Try again in a minute." }
    )
  }

  const answers = draft.answers
  const counts = reviewSections.map((s) => [s.questions.filter((q) => isAnswered(answers[q.id])).length, s.questions.length] as const)
  const answered = counts.reduce((n, [a]) => n + a, 0)
  const total = counts.reduce((n, [, t]) => n + t, 0)

  return (
    <div className="min-h-svh">
      <DevHeader>
        <SaveStatus status={status} canSave={canSave} />
        <span className="text-muted-foreground hidden font-mono text-xs tabular-nums sm:inline">
          {answered}/{total}
        </span>
      </DevHeader>

      <div className="mx-auto flex max-w-[88rem] gap-12 px-4 pt-10 pb-32 sm:px-6">
        <nav className="sticky top-20 hidden h-[calc(100svh-6rem)] w-48 shrink-0 overflow-y-auto text-sm lg:block" aria-label="Review sections">
          <ul className="space-y-px">
            {reviewSections.map((s, i) => {
              const [a, t] = counts[i]
              return (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-muted-foreground hover:text-foreground flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors">
                    <span className="font-mono text-xs tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {a === t ? <Check className="text-success-foreground size-3.5" aria-label="All answered" /> : <span className="font-mono text-xs tabular-nums">{a}/{t}</span>}
                  </a>
                </li>
              )
            })}
          </ul>
        </nav>

        <main className="min-w-0 flex-1 space-y-20">
          {!canSave && (
            <Alert variant="warning" className="max-w-3xl">
              <CircleAlert />
              <AlertTitle>Answers can&apos;t be sent from this link</AlertTitle>
              <AlertDescription>They are kept in this browser only. Ask Clay for the full review link.</AlertDescription>
            </Alert>
          )}

          {reviewSections.map((s, i) => (
            <Group key={s.id} id={s.id} index={i + 1} load="windowed" title={s.title} description={s.intro}>
              {s.block && (
                <Specimen
                  id={`${s.id}-screen`}
                  title={blocks[s.block].title}
                  bodyClassName="p-0 overflow-hidden"
                  actions={
                    <Button variant="outline" size="xs" className="gap-1.5" render={<a href={`/dev/blocks/${s.block}`} target="_blank" rel="noreferrer" />}>
                      <Maximize2 /> Open full screen
                    </Button>
                  }
                >
                  <BlockPreview id={s.block} />
                </Specimen>
              )}
              <div className="max-w-3xl space-y-10">
                {s.questions.map((q, qi) => (
                  <QuestionField key={q.id} n={`${i + 1}.${qi + 1}`} question={q} answers={answers} onChange={setAnswer} />
                ))}
              </div>
            </Group>
          ))}

          <div className="-mt-8 flex max-w-3xl flex-wrap items-center gap-3">
            <Button onClick={submit} disabled={!canSave || status.state === "saving"}>
              <Send /> {draft.submittedAt ? "Submit again" : "Submit"}
            </Button>
            {draft.submittedAt ? (
              <Badge variant="success">Submitted {time(draft.submittedAt)}</Badge>
            ) : (
              <span className="text-muted-foreground text-sm">
                {answered} of {total} answered
              </span>
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function BlockPreview({ id }: { id: keyof typeof blocks }) {
  const { Block } = blocks[id]
  return <Block />
}

function SaveStatus({ status, canSave }: { status: Status; canSave: boolean }) {
  if (!canSave) return <span className="text-warning-foreground text-xs">Saved in this browser only</span>
  if (status.state === "saving") return <span className="text-muted-foreground text-xs">Saving…</span>
  if (status.state === "saved") return <span className="text-muted-foreground text-xs">Saved {time(status.at!)}</span>
  if (status.state === "error")
    return (
      <span className="text-destructive-foreground text-xs" title={status.error}>
        Not saved · kept in browser
      </span>
    )
  return null
}

function QuestionField({
  n,
  question: q,
  answers,
  onChange,
}: {
  n: string
  question: Question
  answers: Answers
  onChange: (id: string, value: Answer) => void
}) {
  const legend = (
    <FieldsetLegend className="flex gap-2 text-sm leading-snug font-medium">
      <span className="text-muted-foreground font-mono tabular-nums">{n}</span>
      <span className="text-pretty">{q.prompt}</span>
    </FieldsetLegend>
  )
  const help = q.help && <p className="text-muted-foreground -mt-1 text-xs">{q.help}</p>

  if (q.kind === "text") {
    const value = (answers[q.id] as string | undefined) ?? ""
    return (
      <Fieldset className="flex flex-col gap-3">
        {legend}
        {help}
        {q.long ? (
          <Textarea aria-label={q.prompt} value={value} placeholder={q.placeholder} onChange={(e) => onChange(q.id, e.target.value)} className="font-[inherit]" />
        ) : (
          <Input aria-label={q.prompt} value={value} placeholder={q.placeholder} onChange={(e) => onChange(q.id, e.target.value)} className="max-w-sm" />
        )}
      </Fieldset>
    )
  }

  const selected = answers[q.id]
  const otherOn = Array.isArray(selected) ? selected.includes(OTHER) : selected === OTHER
  const options = [...q.options, ...(q.other ? ([[OTHER, "Other"]] as const) : [])]
  const optionClass = "has-data-checked:border-primary/40 has-data-checked:bg-primary/4 hover:bg-muted/40 flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-normal transition-colors"

  return (
    <Fieldset className="flex flex-col gap-3">
      {legend}
      {help}
      {q.kind === "single" ? (
        <RadioGroup value={(selected as string | undefined) ?? ""} onValueChange={(v) => onChange(q.id, v as string)} className="grid gap-2 sm:grid-cols-2">
          {options.map(([value, label]) => (
            <Label key={value} className={optionClass}>
              <Radio value={value} className="mt-0.5" /> <span className="text-pretty">{label}</span>
            </Label>
          ))}
        </RadioGroup>
      ) : (
        <CheckboxGroup value={(selected as string[] | undefined) ?? []} onValueChange={(v) => onChange(q.id, v)} className="grid gap-2 sm:grid-cols-2">
          {options.map(([value, label]) => (
            <Label key={value} className={optionClass}>
              <Checkbox value={value} className="mt-0.5" /> <span className="text-pretty">{label}</span>
            </Label>
          ))}
        </CheckboxGroup>
      )}
      {otherOn && (
        <Input
          aria-label={`${q.prompt} (other)`}
          autoFocus
          placeholder="Other…"
          value={(answers[otherKey(q.id)] as string | undefined) ?? ""}
          onChange={(e) => onChange(otherKey(q.id), e.target.value)}
          className="max-w-md"
        />
      )}
    </Fieldset>
  )
}
