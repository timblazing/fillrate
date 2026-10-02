// Types for the hand-kept estimates on /dev. The values live in docs/status.json so the page can
// refresh them from GitHub `main` without a rebuild. Update that file whenever a milestone moves
// (see AGENTS.md, "Progress page").

export type MilestoneState = "done" | "active" | "waiting" | "planned"

export type MilestoneId = string

export type MilestoneStatus = {
  /** Share of the whole spec, in percent. All weights sum to 100. */
  weight: number
  /** How much of this milestone is done, in percent. Fixtures and gallery mocks don't count (spec §15). */
  done: number
  state: MilestoneState
  notes: string
}

export type Status = {
  /** ISO date the estimates were last revised. */
  updated: string
  /** Milestone the work is currently on; highlighted in the pipeline. */
  focus: MilestoneId
  /** Percent of the spec that is working product behavior, counting only real runs (no foundation, no fixtures). */
  productBehavior: number
  milestones: Record<MilestoneId, MilestoneStatus>
  /** Ordered next steps; the first one is what an agent should pick up. */
  nextUp: string[]
}
