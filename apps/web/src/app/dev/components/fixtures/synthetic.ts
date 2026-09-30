// Synthetic fulfillment scenario for the gallery: one depot, ~2,000 open orders, six products, scarce stock.
// Deterministic (seeded), and never real customer data (spec §14). Account labels are generated IDs.

import type { Location, OrderLine, Product } from "@/lib/fulfillment"

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gaussian(rand: () => number) {
  const u = Math.max(rand(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export const depot = {
  id: "depot-mem",
  label: "Memphis DC",
  city: "Memphis",
  state: "TN",
  latitude: 35.0621,
  longitude: -89.9767,
}

export const scenario = {
  name: "Mid-South open orders",
  version: 14,
  planningDate: "2026-09-30",
  timezone: "America/Chicago",
  author: "Clay",
}

export const products: Product[] = [
  { id: "p-1100", sku: "1100", label: "Steel shelving kit", lfPerPiece: 50, valuePerPiece: 18_900 },
  { id: "p-1240", sku: "1240", label: "Patio set, 4 pc", lfPerPiece: 150, valuePerPiece: 42_900 },
  { id: "p-2010", sku: "2010", label: "Water heater, 50 gal", lfPerPiece: 75, valuePerPiece: 61_500 },
  { id: "p-3320", sku: "3320", label: "Vanity, 48 in", lfPerPiece: 60, valuePerPiece: 38_900 },
  { id: "p-4105", sku: "4105", label: "Mattress, queen", lfPerPiece: 40, valuePerPiece: 52_500 },
  { id: "p-5600", sku: "5600", label: "Floor tile, pallet", lfPerPiece: 200, valuePerPiece: 124_000 },
]

// Stock as a share of open demand, per product. Mattresses and patio sets are the scarce ones.
const stockRatio: Record<string, number> = {
  "p-1100": 1.08,
  "p-1240": 0.74,
  "p-2010": 0.91,
  "p-3320": 1.0,
  "p-4105": 0.62,
  "p-5600": 0.86,
}

const metros: [city: string, state: string, lat: number, lon: number, weight: number][] = [
  ["Nashville", "TN", 36.1627, -86.7816, 6],
  ["Memphis", "TN", 35.1495, -90.049, 5],
  ["Atlanta", "GA", 33.749, -84.388, 6],
  ["St. Louis", "MO", 38.627, -90.1994, 5],
  ["Birmingham", "AL", 33.5186, -86.8104, 4],
  ["Louisville", "KY", 38.2527, -85.7585, 4],
  ["New Orleans", "LA", 29.9511, -90.0715, 4],
  ["Kansas City", "MO", 39.0997, -94.5786, 4],
  ["Little Rock", "AR", 34.7465, -92.2896, 3],
  ["Jackson", "MS", 32.2988, -90.1848, 3],
  ["Tulsa", "OK", 36.154, -95.9928, 3],
  ["Indianapolis", "IN", 39.7684, -86.1581, 3],
  ["Dallas", "TX", 32.7767, -96.797, 2],
  ["Huntsville", "AL", 34.7304, -86.5861, 2],
  ["Chattanooga", "TN", 35.0456, -85.3097, 2],
  ["Knoxville", "TN", 35.9606, -83.9207, 2],
  ["Springfield", "MO", 37.209, -93.2923, 2],
  ["Shreveport", "LA", 32.5252, -93.7502, 2],
  ["Baton Rouge", "LA", 30.4515, -91.1871, 2],
  ["Mobile", "AL", 30.6954, -88.0399, 2],
  ["Montgomery", "AL", 32.3792, -86.3077, 2],
  ["Lexington", "KY", 38.0406, -84.5037, 2],
  ["Cincinnati", "OH", 39.1031, -84.512, 2],
  ["Oklahoma City", "OK", 35.4676, -97.5164, 1],
  ["Evansville", "IN", 37.9716, -87.5711, 1],
  ["Tupelo", "MS", 34.2576, -88.7034, 1],
  ["Jonesboro", "AR", 35.8423, -90.7043, 1],
  ["Fort Smith", "AR", 35.3859, -94.3985, 1],
  ["Gulfport", "MS", 30.3674, -89.0928, 1],
  ["Paducah", "KY", 37.0834, -88.6, 1],
  ["Columbia", "MO", 38.9517, -92.3341, 1],
  ["Houston", "TX", 29.7604, -95.3698, 1],
]

export type SyntheticScenario = {
  locations: Location[]
  lines: OrderLine[]
  orderCount: number
  /** Available pieces per product at the depot (spec §5 Inventory). */
  stock: Record<string, number>
}

function isoDate(daysAfter: number) {
  const d = new Date(Date.UTC(2026, 7, 10) + daysAfter * 86_400_000)
  return d.toISOString().slice(0, 10)
}

let cached: SyntheticScenario | null = null

export function syntheticScenario(): SyntheticScenario {
  if (cached) return cached
  const rand = mulberry32(20260929)
  const pick = <T,>(items: T[], weight: (t: T) => number) => {
    const total = items.reduce((s, t) => s + weight(t), 0)
    let r = rand() * total
    for (const t of items) {
      r -= weight(t)
      if (r <= 0) return t
    }
    return items[items.length - 1]
  }

  const locations: Location[] = []
  for (let i = 0; i < 640; i++) {
    const [city, state, lat, lon] = pick(metros, (m) => m[4])
    const rural = rand() < 0.18
    const sd = rural ? 0.75 : 0.2
    const r = rand()
    const source: Location["source"] =
      r < 0.86 ? "census" : r < 0.93 ? "imported" : r < 0.975 ? "zcta" : r < 0.99 ? "manual" : "unresolved"
    locations.push({
      id: `L-${String(10_000 + i * 7).padStart(5, "0")}`,
      label: `Acct ${40_100 + i * 13}`,
      city,
      state,
      latitude: +(lat + gaussian(rand) * sd).toFixed(4),
      longitude: +(lon + gaussian(rand) * sd * 1.2).toFixed(4),
      source,
    })
  }

  const lines: OrderLine[] = []
  const orderCount = 2_000
  for (let o = 0; o < orderCount; o++) {
    // A few accounts order often; most order once or twice in the open window.
    const loc = locations[Math.floor(Math.pow(rand(), 1.35) * locations.length)]
    const orderId = `SO-${260_400 + o}`
    const date = isoDate(Math.floor(rand() * 48))
    const lineCount = rand() < 0.62 ? 1 : rand() < 0.75 ? 2 : 3
    const used = new Set<string>()
    for (let l = 0; l < lineCount; l++) {
      const product = pick(products, (p) => (p.id === "p-5600" ? 0.6 : p.id === "p-1240" ? 0.8 : 1))
      if (used.has(product.id)) continue
      used.add(product.id)
      const bulk = product.id === "p-5600" && rand() < 0.03
      const ordered = bulk ? 22 + Math.floor(rand() * 18) : 1 + Math.floor(Math.pow(rand(), 1.8) * (product.lfPerPiece >= 150 ? 5 : 10))
      // Contract pricing: net value per piece varies a little by account.
      const valuePerPiece = Math.round((product.valuePerPiece * (0.88 + rand() * 0.2)) / 100) * 100
      lines.push({
        id: `${orderId}-${l + 1}`,
        orderId,
        locationId: loc.id,
        productId: product.id,
        orderDate: date,
        ordered,
        allocated: 0,
        lfPerPiece: product.lfPerPiece,
        valuePerPiece,
      })
    }
  }

  const demand: Record<string, number> = {}
  for (const line of lines) demand[line.productId] = (demand[line.productId] ?? 0) + line.ordered
  const stock = Object.fromEntries(products.map((p) => [p.id, Math.round((demand[p.id] ?? 0) * stockRatio[p.id])]))

  cached = { locations, lines, orderCount, stock }
  return cached
}
