// User-facing wording (spec v1.8 §15, M2 scope items 1, 10 and 15). Code, contracts, database columns
// and exports keep the internal names (`load`, `route`, `truck`, `unplanned`); only labels map here,
// so the UI never scatters its own spelling of them.

import type { RunSummary } from "@fillrate/contracts"

import { plural } from "./units"

/** One truck with its stops and order lines. The vehicle keeps its name ("trailer fill", "53 ft trailer"). */
export const SHIPMENT = "Shipment"
export const shipments = (n: number) => plural(n, "shipment")
export const shipmentLabel = (index: number) => `${SHIPMENT} ${index}`

/** Pieces that don't go out. Internal: `unplanned`. */
export const UNSHIPPED = "Unshipped"

/** PyVRP's pickup-and-delivery "shipments" (§3, M6), renamed so they never clash with ours. */
export const PICKUP_DELIVERY = "pickup-delivery pairs"

/** The 500-mile rule, said the same way everywhere (item 15). */
export const legRule = (miles = 500) => `No single drive over ${miles} mi, including depot → first stop.`

/** Header note for exports, which keep internal names. */
export const EXPORT_NOTE = "Internal names: load/truck = Shipment in the app; unplanned = Unshipped."

/** The ★ label for non-dominated runs (round two, `r2.compare.star`). Internally still "non-dominated". */
export const BEST_TRADEOFF = "Best trade-off"
export const BEST_TRADEOFF_HINT = "Best trade-off: no other run is as good on all three groups and better on one"

/** Fallback objective copy until both cost rates exist (item 14). */
export const COST_FALLBACK = "Using fewest trucks, then miles until truck and mile costs are set."

// ---- Unshipped reason groups (item 10) -----------------------------------------------------------

export type UnshippedGroup = "no-stock" | "leg-limit" | "did-not-fit" | "address" | "other"

type Reason = RunSummary["unplanned"][number]["reason"]

export const reasonGroup: Record<Reason, UnshippedGroup> = {
  stock_shortage: "no-stock",
  unreachable: "leg-limit",
  unreachable_in_partition: "leg-limit",
  oversize_piece: "did-not-fit",
  excluded_unresolved_coordinates: "address",
  excluded_by_user: "address",
  candidate_invalid: "other",
  no_valid_candidate: "other",
}

/** The four groups he recognised, in his order; "Other" appears only when present. */
export const unshippedGroups: { id: UnshippedGroup; label: string; hint: string }[] = [
  { id: "no-stock", label: "No stock", hint: "Earlier-dated or higher-value lines took the available pieces." },
  { id: "leg-limit", label: "Beyond the 500 mi leg limit", hint: "No route reaches the stop without a single drive over 500 mi." },
  { id: "did-not-fit", label: "Did not fit on a truck", hint: "A piece is longer than one trailer." },
  { id: "address", label: "Bad or missing address data", hint: "No usable coordinates, or excluded before the run." },
  { id: "other", label: "Other", hint: "Validation failure or solver budget; not proof the stop is impossible." },
]

export const reasonLabel: Record<Reason, string> = {
  stock_shortage: "No stock",
  unreachable: "Beyond 500 mi leg limit",
  unreachable_in_partition: "Beyond 500 mi leg limit in its cluster",
  oversize_piece: "Piece longer than a trailer",
  excluded_unresolved_coordinates: "No coordinates",
  excluded_by_user: "Excluded by you",
  candidate_invalid: "Failed validation",
  no_valid_candidate: "No valid shipment found",
}

// ---- Preflight checks (item 8) ---------------------------------------------------------------------

export type PreflightCheck = NonNullable<RunSummary["preflight"]>[number]["check"]

export const preflightChecks: Record<PreflightCheck, { title: string; blocking: boolean }> = {
  missing_coordinates: { title: "Addresses with no coordinates", blocking: true },
  far_from_depot: { title: "Stops no route reaches within 500 mi per drive", blocking: true },
  oversize_stop: { title: "A stop larger than one trailer (split across shipments)", blocking: false },
  far_via_stop: { title: "Over 500 mi from the depot, reached through another stop", blocking: false },
  approximate_coordinates: { title: "Placed by ZIP code only", blocking: false },
}
