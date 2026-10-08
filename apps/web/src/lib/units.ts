// Display formatting for the internal units in spec §5 and §7:
// linear feet are integer hundredths of a foot, money is integer cents, and solver distances are miles
// (haversine × circuity factor in the default travel mode).

/** A 53 ft trailer, in hundredths of a foot. */
export const TRAILER_CAPACITY = 5_300

export function formatFeet(hundredths: number, digits = 1) {
  return `${(hundredths / 100).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} ft`
}

export function formatMoney(cents: number, { compact = false }: { compact?: boolean } = {}) {
  const dollars = cents / 100
  // Hand-rolled compact form: Intl compact output differs between Node and browsers and breaks hydration.
  if (compact && Math.abs(dollars) >= 1_000_000) return `${dollars < 0 ? "−" : ""}$${(Math.abs(dollars) / 1_000_000).toFixed(2)}M`
  if (compact && Math.abs(dollars) >= 10_000) return `${dollars < 0 ? "−" : ""}$${Math.round(Math.abs(dollars) / 1_000)}K`
  return dollars.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
}

export function formatMiles(miles: number) {
  return `${Math.round(miles).toLocaleString("en-US")} mi`
}

export function formatPercent(ratio: number, digits = 0) {
  return `${(ratio * 100).toFixed(digits)}%`
}

export function formatCount(n: number) {
  return n.toLocaleString("en-US")
}

/** Fill bands used by every truck-fill visual, so "low" means the same thing everywhere. */
export type FillBand = "low" | "fair" | "full"

/** Band edges: under LOW is flagged, FULL and up reads as full. Legends read these so they never drift.
 * Run-display settings only; they never affect the solver. 80% is the primary user's low-fill line
 * (design review round one); 90% is a provisional default to confirm in round two. */
export const FILL_LOW = 0.8
export const FILL_FULL = 0.9

export function fillBand(fill: number): FillBand {
  if (fill < FILL_LOW) return "low"
  if (fill < FILL_FULL) return "fair"
  return "full"
}

/** "1 stop", "4 stops". Pass `plural` for irregular nouns. */
export function plural(n: number, noun: string, pluralNoun = `${noun}s`) {
  return `${formatCount(n)} ${n === 1 ? noun : pluralNoun}`
}

/** CSS percentage with fixed precision, so server and client render identical style strings. */
export function cssPercent(ratio: number) {
  return `${(Math.max(0, ratio) * 100).toFixed(2)}%`
}

/** `mode` is "estimated" for every current run; runs stored by older versions may say "snapshot" (a recorded matrix). */
type TravelBasisInput = { mode: string } | null | undefined

/**
 * How a run measured its miles (spec §7, §10): estimated (haversine × circuity), never road miles. Runs stored
 * by older versions that used a recorded matrix get a plain label instead.
 */
export function travelBasis(travel: TravelBasisInput, circuity: number) {
  if (travel && travel.mode !== "estimated") {
    return { step: "Recorded", unit: "matrix miles", note: "From a travel matrix recorded by an older version, open routes", sentence: "Miles come from a travel matrix recorded by an older version of Fillrate." }
  }
  return { step: `× ${circuity}`, unit: "haversine miles", note: `Estimated: haversine × ${circuity}, open routes`, sentence: `Miles are estimated (haversine × ${circuity}), not road miles.` }
}
