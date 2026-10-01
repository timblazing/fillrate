"use client"

import { useState, useSyncExternalStore, type ReactNode } from "react"

import { toastManager } from "@/components/ui/toast"

type Saved<P> = { params?: Partial<P>; jobs?: Record<string, string> }

function parse<P>(raw: string | null): Saved<P> {
  try {
    return raw ? (JSON.parse(raw) as Saved<P>) : {}
  } catch {
    return {}
  }
}

/**
 * A lesson's per-browser state (spec §13: editable starter values and a reset action): the parameters
 * the learner changed and the ids of the jobs each step started. The runs themselves are durable on the server.
 */
export function useLessonState<P extends Record<string, string>, J extends string>(storageKey: string, defaults: P, runKey?: string) {
  const event = `${storageKey}:change`
  const raw = useSyncExternalStore(
    (callback) => {
      window.addEventListener(event, callback)
      window.addEventListener("storage", callback)
      return () => {
        window.removeEventListener(event, callback)
        window.removeEventListener("storage", callback)
      }
    },
    () => {
      try {
        return localStorage.getItem(storageKey)
      } catch {
        return null
      }
    },
    () => null,
  )
  const saved = parse<P>(raw)
  const params = { ...defaults, ...saved.params } as P
  const jobs = (saved.jobs ?? {}) as Partial<Record<J, string>>
  const [pending, setPending] = useState<J | null>(null)

  const write = (next: Saved<P> | null) => {
    try {
      if (next) localStorage.setItem(storageKey, JSON.stringify(next))
      else localStorage.removeItem(storageKey)
    } catch {}
    window.dispatchEvent(new Event(event))
  }
  const setParam = (patch: Partial<P>) => write({ ...saved, params: { ...saved.params, ...patch } })

  async function start(job: J, path: string, body: () => unknown) {
    setPending(job)
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID(), ...(runKey ? { "x-run-key": runKey } : {}) },
        body: JSON.stringify(body()),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message ?? "Request failed.")
      write({ ...saved, jobs: { ...saved.jobs, [job]: json.id } })
    } catch (error) {
      toastManager.add({ type: "error", title: "Not started", description: error instanceof Error ? error.message : undefined })
    } finally {
      setPending(null)
    }
  }

  return { params, jobs, pending, setParam, start, reset: () => write(null) }
}

export function Step({ n, title, observe, children }: { n: number; title: string; observe: string[]; children: ReactNode }) {
  return (
    <section className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" aria-labelledby={`step-${n}`}>
      <div className="flex flex-col gap-3">
        <h2 id={`step-${n}`} className="text-lg font-semibold tracking-tight">
          <span className="text-muted-foreground tabular-nums">{n}.</span> {title}
        </h2>
        <div className="flex flex-wrap items-end gap-3">{children}</div>
      </div>
      <div className="bg-card rounded-xl border p-4">
        <h3 className="text-muted-foreground mb-2 text-xs font-medium uppercase">What to look for</h3>
        <ul className="list-disc space-y-1.5 pl-4 text-sm text-pretty">
          {observe.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </div>
    </section>
  )
}

export const wholeNumber = (raw: string, min: number, max: number, name: string) => {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}.`)
  return n
}
