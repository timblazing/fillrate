import type { MilestoneState, MilestoneStatus, Status } from "@/app/dev/status"

// Parses the planning docs for /dev. Isomorphic: the server parses the build-time copies and the
// browser re-parses the latest copies fetched from GitHub `main` (see progress-view.tsx).

export const DOC_PATHS = {
  spec: "docs/fillrate-technical-spec.md",
  progress: "docs/progress.md",
  decisions: "docs/decisions.md",
  status: "docs/status.json",
} as const

export type DocSources = Record<keyof typeof DOC_PATHS, string>

/** raw.githubusercontent.com allows CORS and caches for 5 minutes. */
export const RAW_BASE = "https://raw.githubusercontent.com/timblazing/fillrate/main/"

export type Block = { kind: "p"; text: string } | { kind: "ul" | "ol"; items: string[] }
export type ChecklistItem = { done: boolean; text: string }
export type SpecMilestone = { id: string; name: string; deliverable: string; exit: string }
export type ProgressMilestone = { id: string; done: boolean; items: ChecklistItem[] }
export type Decision = { date: string; title: string; author: string | null; summary: string }

/** Body of the first `## ` section whose heading starts with `heading`. */
function section(md: string, heading: string): string {
  const parts = md.split(/^## /m)
  const hit = parts.find((p) => p.startsWith(heading))
  return hit ? hit.slice(hit.indexOf("\n") + 1).trim() : ""
}

/** Paragraphs and flat lists; enough for the prose in progress.md. */
function blocks(md: string): Block[] {
  const out: Block[] = []
  let prevBlank = true
  for (const line of md.split("\n")) {
    const last = out.at(-1)
    const bullet = line.match(/^\s*(- |(\d+)\. )(.*)$/)
    if (!line.trim()) prevBlank = true
    else if (bullet) {
      const kind = bullet[2] ? "ol" : "ul"
      if (last?.kind === kind && !prevBlank) last.items.push(bullet[3])
      else out.push({ kind, items: [bullet[3]] })
      prevBlank = false
    } else if (last && !prevBlank) {
      if (last.kind === "p") last.text += " " + line.trim()
      else last.items[last.items.length - 1] += " " + line.trim()
    } else {
      out.push({ kind: "p", text: line.trim() })
      prevBlank = false
    }
  }
  return out
}

const states: MilestoneState[] = ["done", "active", "waiting", "planned"]

/** JSON.parse plus a shape check, so a malformed status.json fails loudly instead of rendering NaN. */
function parseStatus(json: string): Status {
  const s = JSON.parse(json) as Status
  const ok =
    typeof s.updated === "string" &&
    typeof s.focus === "string" &&
    typeof s.productBehavior === "number" &&
    Array.isArray(s.nextUp) &&
    s.nextUp.every((n) => typeof n === "string") &&
    typeof s.milestones === "object" &&
    Object.values(s.milestones ?? {}).every(
      (m: MilestoneStatus) =>
        typeof m.weight === "number" && typeof m.done === "number" && states.includes(m.state) && typeof m.notes === "string"
    )
  if (!ok) throw new Error("docs/status.json does not match the Status shape")
  return s
}

export function parseProjectDocs({ spec, progress, decisions, status }: DocSources) {
  const version = spec.match(/^Version: (.+?) · Revised (.+)$/m)
  const specMilestones: SpecMilestone[] = []
  for (const m of section(spec, "15.").matchAll(/^\| \*\*(M\d) — (.+?)\*\* \| (.+?) \| (.+?) \|$/gm)) {
    specMilestones.push({ id: m[1], name: m[2], deliverable: m[3], exit: m[4] })
  }

  const progressMilestones: ProgressMilestone[] = []
  for (const line of section(progress, "Milestones").split("\n")) {
    const top = line.match(/^- \[( |x)\] .*?\b(M\d)\b/)
    const item = line.match(/^\s+- \[( |x)\] (.+)$/)
    if (top) progressMilestones.push({ id: top[2], done: top[1] === "x", items: [] })
    else if (item && progressMilestones.length) progressMilestones.at(-1)!.items.push({ done: item[1] === "x", text: item[2] })
  }

  const decisionLog: Decision[] = decisions
    .split(/^## /m)
    .slice(1)
    .map((chunk): Decision | null => {
      const [head, ...rest] = chunk.split("\n")
      const h = head.match(/^(\d{4}-\d{2}-\d{2}):\s*(.+?)(?:\s+\(([^)]+)\))?\s*$/)
      const first = rest.find((l) => l.trim().startsWith("- ")) ?? rest.find((l) => l.trim()) ?? ""
      const summary = first.replace(/^\s*- /, "").replace(/^\*\*[^*]+:\*\*\s*/, "")
      return h ? { date: h[1], title: h[2], author: h[3] ?? null, summary } : null
    })
    .filter((d): d is Decision => d !== null)
    .reverse()

  return {
    spec: { version: version?.[1] ?? "?", revised: version?.[2] ?? "" },
    specMilestones,
    progressMilestones,
    waiting: blocks(section(progress, "Waiting on")),
    nextStep: blocks(section(progress, "Next step")),
    knownGaps: blocks(section(progress, "Known gaps")).flatMap((b) => (b.kind === "p" ? [b.text] : b.items)),
    decisions: decisionLog,
    status: parseStatus(status),
  }
}

export type ProjectDocs = ReturnType<typeof parseProjectDocs>
