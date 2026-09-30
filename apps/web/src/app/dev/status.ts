// Hand-kept estimates for /dev. Everything else on that page is parsed from
// fillrate-technical-spec.md §15, docs/progress.md, and docs/decisions.md at build time.
// Update this file whenever a milestone moves (see AGENTS.md, "Progress page").

export type MilestoneState = "done" | "active" | "waiting" | "planned"

export type MilestoneStatus = {
  /** Share of the whole spec, in percent. All weights sum to 100. */
  weight: number
  /** How much of this milestone is done, in percent. Fixtures and gallery mocks don't count (spec §15). */
  done: number
  state: MilestoneState
  notes: string
}

export const status = {
  updated: "2026-09-30",
  focus: "M1",
  /** Percent of the spec that is working product behavior, counting only real runs (no foundation, no fixtures). */
  productBehavior: 5,
  milestones: {
    M1: {
      weight: 20,
      done: 50,
      state: "active",
      notes:
        "Done: monorepo, SQLite/Drizzle, leases, contracts, PyVRP capability fixtures, per-cluster solve, web image. Missing: worker transport and supervisor, the staged pipeline, the v1.6 objective and graph preflight, validator, persisted results, export, `ci.yml`, multi-arch smoke test.",
    },
    M2: {
      weight: 10,
      done: 40,
      state: "waiting",
      notes:
        "Six Blocks and a large component library exist but are gallery-only. They're waiting on the primary user's review, and `fillrate.fig` Components still mirrors shadcn rather than coss.",
    },
    M3: {
      weight: 20,
      done: 5,
      state: "planned",
      notes: "Gallery components can be reused. No CSV import, scenario versioning, settings, or real screens.",
    },
    M4: {
      weight: 15,
      done: 3,
      state: "planned",
      notes: "The k explorer and comparison UI exist only as fixtures. No sweeps, H3, or lesson.",
    },
    M5: { weight: 10, done: 0, state: "planned", notes: "Nothing yet beyond the \"order date, then value\" rule in the gallery fixture." },
    M6: { weight: 12, done: 2, state: "planned", notes: "PyVRP capability fixtures only (capacity, fixed cost, open routes, prohibited legs). No Valhalla." },
    M7: { weight: 6, done: 0, state: "planned", notes: "No lessons or Python export yet." },
    M8: { weight: 7, done: 2, state: "planned", notes: "Vitest persistence races and optimizer pytest exist; no browser, container or recovery suite." },
  } satisfies Record<string, MilestoneStatus>,
  /** Ordered next steps; the first one is what an agent should pick up. */
  nextUp: [
    "Authenticated loopback worker routes (`/internal/claim`, heartbeat, complete) and a Python supervisor with a single leased job.",
    "The real staged pipeline on a bundled synthetic scenario: preflight → allocate → aggregate → cluster/repair → PyVRP → validate.",
    "Spec v1.6 semantics: truck-count-first objective with derived bound, graph reachability preflight, independent metric reconstruction.",
    "Persisted map/table summary of a run, plus JSON/CSV export.",
    "`ci.yml`, automatic image builds, and an amd64/arm64 smoke run.",
  ],
}

export type MilestoneId = keyof typeof status.milestones
