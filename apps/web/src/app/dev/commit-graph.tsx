"use client"

import { addDays, formatISO, subMonths } from "date-fns"
import { useEffect, useMemo, useState } from "react"

import {
  ContributionGraph,
  ContributionGraphBlock,
  ContributionGraphCalendar,
  ContributionGraphFooter,
  ContributionGraphLegend,
  ContributionGraphTotalCount,
  type Activity,
} from "@/components/kibo-ui/contribution-graph"

const COMMITS_API = "https://api.github.com/repos/timblazing/fillrate/commits"
const CACHE_KEY = "fillrate:dev:commit-dates:3-months"
const MAX_PAGES = 10

// GitHub-style levels on the success token instead of Kibo's grey defaults.
const levelClass = [
  'data-[level="0"]:fill-muted',
  'data-[level="1"]:fill-success/30',
  'data-[level="2"]:fill-success/55',
  'data-[level="3"]:fill-success/80',
  'data-[level="4"]:fill-success',
].join(" ")

const dayKey = (d: Date) => formatISO(d, { representation: "date" })

/** Commit dates on `main` for the last three months (local time). Unauthenticated, so cached per browser session. */
async function fetchCommitDates(since: Date, signal: AbortSignal): Promise<string[]> {
  const cached = sessionStorage.getItem(CACHE_KEY)
  if (cached) return JSON.parse(cached) as string[]
  const dates: string[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${COMMITS_API}?sha=main&per_page=100&page=${page}&since=${since.toISOString()}`, { signal })
    if (!res.ok) throw new Error(`GitHub commits: HTTP ${res.status}`)
    const batch = (await res.json()) as { commit: { author: { date: string } | null } }[]
    for (const c of batch) if (c.commit.author) dates.push(dayKey(new Date(c.commit.author.date)))
    if (batch.length < 100) break
  }
  sessionStorage.setItem(CACHE_KEY, JSON.stringify(dates))
  return dates
}

// The last three months of commits to `main`, fetched from the GitHub API in the browser (the image has no .git).
export function CommitGraph() {
  const [dates, setDates] = useState<string[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [today] = useState(() => new Date())
  const start = useMemo(() => subMonths(today, 3), [today])

  useEffect(() => {
    const controller = new AbortController()
    fetchCommitDates(start, controller.signal)
      .then(setDates)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.warn("[dev] commit graph unavailable:", error)
        setFailed(true)
      })
    return () => controller.abort()
  }, [start])

  const data = useMemo<Activity[]>(() => {
    const counts = new Map<string, number>()
    for (const d of dates ?? []) counts.set(d, (counts.get(d) ?? 0) + 1)
    const max = Math.max(1, ...counts.values())
    const days: Activity[] = []
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const count = counts.get(dayKey(d)) ?? 0
      days.push({ date: dayKey(d), count, level: count === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4)) })
    }
    return days
  }, [dates, start, today])

  return (
    <ContributionGraph data={data} blockSize={14} blockMargin={4} blockRadius={3} fontSize={12} className="text-muted-foreground w-full">
      <ContributionGraphCalendar className="pb-1">
        {({ activity, dayIndex, weekIndex }) => (
          <ContributionGraphBlock activity={activity} dayIndex={dayIndex} weekIndex={weekIndex} className={levelClass}>
            <title>{`${activity.count} ${activity.count === 1 ? "commit" : "commits"} on ${activity.date}`}</title>
          </ContributionGraphBlock>
        )}
      </ContributionGraphCalendar>
      <ContributionGraphFooter className="items-center justify-between text-xs">
        <ContributionGraphTotalCount>
          {({ totalCount }) => (
            <span className="text-muted-foreground">
              {failed
                ? "Commit history unavailable (GitHub API limit). Try again later."
                : dates === null
                  ? "Loading commits from GitHub…"
                  : `${totalCount} commits to main in the last three months`}
            </span>
          )}
        </ContributionGraphTotalCount>
        <ContributionGraphLegend>
          {({ level }) => (
            <svg width={12} height={12} aria-hidden>
              <rect width={12} height={12} rx={3} data-level={level} className={levelClass} />
            </svg>
          )}
        </ContributionGraphLegend>
      </ContributionGraphFooter>
    </ContributionGraph>
  )
}
