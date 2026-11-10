"use client"

import { useEffect, useState } from "react"

/**
 * Polls `url` while `active(value)` holds, pausing while the tab is hidden; stops on the first inactive reply.
 * Shared by the run, explorer and experiment views so every live view follows the same lifecycle.
 */
export function usePolled<T>(
  url: string,
  initial: T,
  active: (value: T) => boolean,
  { first = 1_000, every = 2_000, slow }: { first?: number; every?: number; slow?: { after: number; every: number } } = {}
) {
  const [value, setValue] = useState(initial)
  const live = active(value)
  useEffect(() => {
    if (!live) return
    const started = Date.now()
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (!document.hidden) {
        const res = await fetch(url, { cache: "no-store" }).catch(() => null)
        if (res?.ok && !stopped) {
          const next = (await res.json()) as T
          setValue(next)
          if (!active(next)) return
        }
      }
      if (!stopped) timer = setTimeout(tick, slow && Date.now() - started > slow.after ? slow.every : every)
    }
    timer = setTimeout(tick, first)
    return () => {
      stopped = true
      clearTimeout(timer)
    }
    // `active` and the timings are fixed per call site; re-arm only when the URL or liveness changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, live])
  return [value, setValue] as const
}
