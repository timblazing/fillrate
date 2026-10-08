import "server-only"
import type { RunSettings } from "@fillrate/contracts"

import { ApiError } from "./errors"

// Playground mode (FILLRATE_PLAYGROUND=1): the hosted demo. Stateless: nothing is written to SQLite, and every
// stored-run route is closed. `src/proxy.ts` repeats the mode check because it cannot import server-only code.
export const playgroundMode = () => process.env.FILLRATE_PLAYGROUND === "1"

const positive = (name: string, fallback: number) => {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export const MAX_CLUSTER_SOLVE_SECONDS = 5

export const playgroundCaps = () => ({
  maxOrders: Math.floor(positive("PLAYGROUND_MAX_ORDERS", 2000)),
  solveSeconds: positive("PLAYGROUND_SOLVE_SECONDS", 60),
  clusterSolveSeconds: MAX_CLUSTER_SOLVE_SECONDS,
})

export function assertWithinCaps(orderCount: number, maxOrders = playgroundCaps().maxOrders) {
  if (orderCount > maxOrders) throw new ApiError(400, "too_many_orders", `The playground runs up to ${maxOrders.toLocaleString("en-US")} orders; this scenario has ${orderCount.toLocaleString("en-US")}. Run Fillrate locally for larger scenarios.`)
}

/** Caps each cluster's solver time so one run stays inside the whole-solve limit. */
export const clampSettings = <T extends Pick<RunSettings, "solver_time_limit_s">>(settings: T): T => ({
  ...settings,
  solver_time_limit_s: Math.min(settings.solver_time_limit_s ?? MAX_CLUSTER_SOLVE_SECONDS, MAX_CLUSTER_SOLVE_SECONDS),
})
