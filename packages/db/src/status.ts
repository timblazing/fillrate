// The run and geocoding-job lifecycles, defined once. Pure and dependency-free so the store (server)
// and the run views (browser) share it.
//
//   queued ──▶ running ──▶ succeeded
//     │           ├──────▶ failed      (solver error, optimizer down, or a server restart)
//     │           └──────▶ cancelled
//     ├─────────────────▶ cancelled
//     └─────────────────▶ failed       (server restart)
//
// "interrupted" is terminal and only appears on runs made before direct solves.

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Statuses a run or geocoding job can still leave. Everything else is final. */
export const ACTIVE_STATUSES = ["queued", "running"] as const;
export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

/** The outcomes an active run can end in. */
export type RunOutcome = Exclude<RunStatus, ActiveStatus | "interrupted">;

/** Where each status may go next. The store's UPDATEs only ever take these edges. */
export const RUN_TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  queued: ["running", "cancelled", "failed"],
  running: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  interrupted: [],
};

/** Geocoding jobs follow the same shape without cancel. */
export type GeocodeJobStatus = Exclude<RunStatus, "cancelled" | "interrupted">;

export const isActive = (status: string): status is ActiveStatus => (ACTIVE_STATUSES as readonly string[]).includes(status);
export const canTransition = (from: RunStatus, to: RunStatus) => RUN_TRANSITIONS[from].includes(to);

/** Narrows a stored status column. Unknown values (from a newer database) read as failed rather than crashing a view. */
export const asRunStatus = (value: string): RunStatus => ((RUN_STATUSES as readonly string[]).includes(value) ? (value as RunStatus) : "failed");

/** SQL list for `status IN (...)`; the values are the constants above, never user input. */
export const sqlList = (statuses: readonly string[]) => statuses.map(s => `'${s}'`).join(",");
