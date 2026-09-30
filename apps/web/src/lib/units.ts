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

export function fillBand(fill: number): FillBand {
  if (fill < 0.6) return "low"
  if (fill < 0.85) return "fair"
  return "full"
}

/** CSS percentage with fixed precision, so server and client render identical style strings. */
export function cssPercent(ratio: number) {
  return `${(Math.max(0, ratio) * 100).toFixed(2)}%`
}
