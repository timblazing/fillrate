// Gallery-only stand-in for the optimizer pipeline (spec §8, §8a) so every specimen shows one internally
// consistent run. Allocation, aggregation, k-means on 3D unit vectors, and diameter repair follow the spec.
// Truck building is a sweep heuristic standing in for PyVRP; the real solve lives in services/optimizer (M3).

import type {
  Cluster,
  OrderLine,
  PipelineSettings,
  RunMetrics,
  Stop,
  Truck,
  UnshippedLine,
} from "@/lib/fulfillment"
import { TRAILER_CAPACITY } from "@/lib/units"

import { depot, mulberry32, products, syntheticScenario } from "./synthetic"

const EARTH_MILES = 3958.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversineMiles(a: [number, number], b: [number, number]) {
  const [lat1, lon1] = a
  const [lat2, lon2] = b
  const h =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)))
}

type Vec = [number, number, number]
const unit = (lat: number, lon: number): Vec => [
  Math.cos(rad(lat)) * Math.cos(rad(lon)),
  Math.cos(rad(lat)) * Math.sin(rad(lon)),
  Math.sin(rad(lat)),
]
const sq = (a: Vec, b: Vec) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

export const defaultSettings: PipelineSettings = {
  // Fixed k from the explorer is the normal path once the diameter policy is off (spec v1.8 §15 item 15).
  k: 6,
  kmeansSeed: 0,
  nInit: 4,
  circuity: 1.2,
  maxLegMiles: 500,
  maxDiameterMiles: null,
  inventoryPct: 100,
  strategy: "date-value",
  fulfillment: "piece",
}

// ---------------------------------------------------------------- k-means (k-means++ init, Lloyd iterations)

export function kmeans(points: Vec[], k: number, seed: number, nInit = 1) {
  let best: { labels: number[]; inertia: number } | null = null
  for (let run = 0; run < nInit; run++) {
    const rand = mulberry32(seed * 7919 + run * 104_729 + k)
    const centers: Vec[] = [points[Math.floor(rand() * points.length)]]
    const d2 = points.map((p) => sq(p, centers[0]))
    while (centers.length < k) {
      const total = d2.reduce((s, v) => s + v, 0)
      let r = rand() * total
      let idx = 0
      for (; idx < points.length - 1; idx++) {
        r -= d2[idx]
        if (r <= 0) break
      }
      centers.push(points[idx])
      for (let i = 0; i < points.length; i++) d2[i] = Math.min(d2[i], sq(points[i], points[idx]))
    }
    const labels = new Array<number>(points.length).fill(0)
    for (let iter = 0; iter < 40; iter++) {
      let moved = 0
      for (let i = 0; i < points.length; i++) {
        let bi = 0
        let bd = Infinity
        for (let c = 0; c < k; c++) {
          const d = sq(points[i], centers[c])
          if (d < bd) {
            bd = d
            bi = c
          }
        }
        if (labels[i] !== bi) moved++
        labels[i] = bi
      }
      const sums = centers.map(() => [0, 0, 0, 0])
      points.forEach((p, i) => {
        const s = sums[labels[i]]
        s[0] += p[0]
        s[1] += p[1]
        s[2] += p[2]
        s[3]++
      })
      sums.forEach((s, c) => {
        if (s[3]) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]
      })
      if (!moved && iter > 0) break
    }
    const inertia = points.reduce((s, p, i) => s + sq(p, centers[labels[i]]), 0)
    if (!best || inertia < best.inertia) best = { labels, inertia }
  }
  return best!
}

function widestPair(latlon: [number, number][], circuity: number) {
  let max = 0
  for (let i = 0; i < latlon.length; i++)
    for (let j = i + 1; j < latlon.length; j++) max = Math.max(max, haversineMiles(latlon[i], latlon[j]))
  return max * circuity
}

// ---------------------------------------------------------------- the run

export type PipelineResult = {
  settings: PipelineSettings
  lines: OrderLine[]
  stock: Record<string, number>
  residual: Record<string, number>
  stops: Stop[]
  clusters: Cluster[]
  trucks: Truck[]
  unshipped: UnshippedLine[]
  metrics: RunMetrics
  autoKSearch: { k: number; overLimit: number }[]
  repairs: { from: number; into: [number, number]; widestBefore: number }[]
  splits: { stop: string; visits: number }[]
  timings: Record<"allocate" | "aggregate" | "cluster" | "solve" | "validate" | "metrics", number>
}

const cache = new Map<string, PipelineResult>()

export function runPipeline(overrides: Partial<PipelineSettings> = {}): PipelineResult {
  const settings = { ...defaultSettings, ...overrides }
  const key = JSON.stringify(settings)
  const hit = cache.get(key)
  if (hit) return hit

  const base = syntheticScenario()
  const locById = new Map(base.locations.map((l) => [l.id, l]))
  const stock = Object.fromEntries(
    Object.entries(base.stock).map(([p, n]) => [p, Math.round((n * settings.inventoryPct) / 100)])
  )
  const remaining = { ...stock }
  const unshipped: UnshippedLine[] = []

  // 1. Allocate, piece by piece: order date, then net value per piece (desc), then stable ID.
  const lines = base.lines.map((l) => ({ ...l, allocated: 0 }))
  const eligible = lines.filter((l) => locById.get(l.locationId)!.source !== "unresolved")
  for (const l of lines) {
    if (locById.get(l.locationId)!.source === "unresolved") {
      unshipped.push({
        lineId: l.id,
        orderId: l.orderId,
        productId: l.productId,
        locationId: l.locationId,
        orderDate: l.orderDate,
        pieces: l.ordered,
        ordered: l.ordered,
        amount: l.ordered * l.valuePerPiece,
        reason: "data-quality",
        detail: "No coordinates: ZIP is PO-box-only, so there is no ZCTA fallback. Place it on the map to include it.",
      })
    }
  }
  const order = [...eligible].sort(
    (a, b) =>
      a.orderDate.localeCompare(b.orderDate) ||
      (settings.strategy === "date-value" ? b.valuePerPiece - a.valuePerPiece : 0) ||
      a.id.localeCompare(b.id)
  )
  const takenBy: Record<string, string[]> = {}
  for (const l of order) {
    const take = Math.min(l.ordered, remaining[l.productId])
    l.allocated = take
    remaining[l.productId] -= take
    if (take > 0) (takenBy[l.productId] ??= []).push(l.id)
    if (take < l.ordered) {
      const before = takenBy[l.productId] ?? []
      const short = l.ordered - take
      unshipped.push({
        lineId: l.id,
        orderId: l.orderId,
        productId: l.productId,
        locationId: l.locationId,
        orderDate: l.orderDate,
        pieces: short,
        ordered: l.ordered,
        amount: short * l.valuePerPiece,
        reason: "no-stock",
        detail:
          take > 0
            ? `Partly filled: ${take} of ${l.ordered} pcs. Stock ran out on this line.`
            : `Stock of SKU ${products.find((p) => p.id === l.productId)!.sku} was used up by earlier or higher-value lines.`,
        competing: before.slice(-3).reverse(),
        competingCount: before.length,
      })
    }
  }

  // 2. Aggregate allocated lines into stops, one per location; split any stop over one trailer.
  const byLoc = new Map<string, OrderLine[]>()
  for (const l of order) if (l.allocated > 0) byLoc.set(l.locationId, [...(byLoc.get(l.locationId) ?? []), l])
  const stops: Stop[] = []
  const splits: PipelineResult["splits"] = []
  for (const [locId, locLines] of byLoc) {
    const loc = locById.get(locId)!
    const depotMiles = haversineMiles([depot.latitude, depot.longitude], [loc.latitude, loc.longitude]) * settings.circuity
    const total = locLines.reduce((s, l) => s + l.allocated * l.lfPerPiece, 0)
    const make = (suffix: string, sl: OrderLine[], load: number, value: number, split?: Stop["split"]): Stop => ({
      id: `S-${locId.slice(2)}${suffix}`,
      locationId: locId,
      label: loc.label,
      city: `${loc.city}, ${loc.state}`,
      latitude: loc.latitude,
      longitude: loc.longitude,
      load,
      value,
      lineIds: sl.map((l) => l.id),
      orderIds: [...new Set(sl.map((l) => l.orderId))],
      split,
      depotMiles,
      cluster: null,
      truck: null,
    })
    if (total <= TRAILER_CAPACITY) {
      stops.push(make("", locLines, total, locLines.reduce((s, l) => s + l.allocated * l.valuePerPiece, 0)))
      continue
    }
    // Fill whole pieces greedily in allocation order, one trailer per visit.
    const visits: { lines: OrderLine[]; load: number; value: number }[] = [{ lines: [], load: 0, value: 0 }]
    for (const l of locLines) {
      let left = l.allocated
      while (left > 0) {
        let v = visits[visits.length - 1]
        const fit = Math.floor((TRAILER_CAPACITY - v.load) / l.lfPerPiece)
        if (fit === 0) {
          v = { lines: [], load: 0, value: 0 }
          visits.push(v)
          continue
        }
        const n = Math.min(fit, left)
        v.load += n * l.lfPerPiece
        v.value += n * l.valuePerPiece
        if (!v.lines.includes(l)) v.lines.push(l)
        left -= n
      }
    }
    splits.push({ stop: `S-${locId.slice(2)}`, visits: visits.length })
    visits.forEach((v, i) =>
      stops.push(make(`·${i + 1}`, v.lines, v.load, v.value, { index: i + 1, of: visits.length }))
    )
  }

  // Stops the depot cannot reach within the leg limit are reported, not dropped silently.
  const reachable = stops.filter((s) => s.depotMiles <= settings.maxLegMiles)
  const reported = new Set<string>()
  for (const s of stops) {
    if (s.depotMiles <= settings.maxLegMiles) continue
    for (const id of s.lineIds) {
      if (reported.has(id)) continue
      reported.add(id)
      const l = lines.find((x) => x.id === id)!
      unshipped.push({
        lineId: l.id,
        orderId: l.orderId,
        productId: l.productId,
        locationId: l.locationId,
        orderDate: l.orderDate,
        pieces: l.allocated,
        ordered: l.ordered,
        amount: l.allocated * l.valuePerPiece,
        reason: "unreachable",
        detail: `Allocated but not loaded: ${Math.round(s.depotMiles)} solver mi from ${depot.label}, over the ${settings.maxLegMiles} mi leg limit.`,
      })
    }
  }

  // 3. Cluster reachable stops with k-means on 3D unit vectors; 4. bisect clusters over the diameter.
  const vecs = reachable.map((s) => unit(s.latitude, s.longitude))
  const ll = reachable.map((s) => [s.latitude, s.longitude] as [number, number])
  const tooWide = (members: [number, number][]) =>
    settings.maxDiameterMiles != null && widestPair(members, settings.circuity) > settings.maxDiameterMiles
  const overLimit = (labels: number[], k: number) => {
    let n = 0
    for (let c = 0; c < k; c++) {
      const members = ll.filter((_, i) => labels[i] === c)
      if (tooWide(members)) n++
    }
    return n
  }
  const autoKSearch: PipelineResult["autoKSearch"] = []
  let k: number
  let labels: number[]
  if (settings.k === "auto") {
    k = 0
    labels = []
    for (let kk = 1; kk <= 16; kk++) {
      const res = kmeans(vecs, kk, settings.kmeansSeed, settings.nInit)
      const over = overLimit(res.labels, kk)
      autoKSearch.push({ k: kk, overLimit: over })
      if (over === 0) {
        k = kk
        labels = res.labels
        break
      }
    }
  } else {
    k = settings.k
    labels = kmeans(vecs, k, settings.kmeansSeed, settings.nInit).labels
  }

  const repairs: PipelineResult["repairs"] = []
  let groups: { members: number[]; repairedFrom?: number }[] = Array.from({ length: k }, (_, c) => ({
    members: labels.flatMap((l, i) => (l === c ? [i] : [])),
  }))
  for (let guard = 0; guard < 24; guard++) {
    const idx = groups.findIndex(
      (g) => g.members.length > 1 && tooWide(g.members.map((i) => ll[i]))
    )
    if (idx < 0) break
    const g = groups[idx]
    const widestBefore = widestPair(g.members.map((i) => ll[i]), settings.circuity)
    const halves = kmeans(g.members.map((i) => vecs[i]), 2, settings.kmeansSeed).labels
    const a = g.members.filter((_, j) => halves[j] === 0)
    const b = g.members.filter((_, j) => halves[j] === 1)
    const from = g.repairedFrom ?? idx + 1
    groups.splice(idx, 1, { members: a, repairedFrom: from }, { members: b, repairedFrom: from })
    repairs.push({ from, into: [idx + 1, idx + 2], widestBefore })
  }
  // Number clusters west to east so colors read in a stable order.
  groups = groups
    .filter((g) => g.members.length)
    .map((g) => ({ ...g, lon: g.members.reduce((s, i) => s + ll[i][1], 0) / g.members.length }))
    .sort((x, y) => x.lon - y.lon)

  // 5. Per-cluster loads: sweep stops by bearing around the cluster, cut at trailer capacity, then order
  //    each truck nearest-neighbour from the depot (open route). A stand-in for the PyVRP solve.
  const clusters: Cluster[] = []
  const trucks: Truck[] = []
  groups.forEach((g, gi) => {
    const id = gi + 1
    const members = g.members.map((i) => reachable[i])
    const cLat = members.reduce((s, m) => s + m.latitude, 0) / members.length
    const cLon = members.reduce((s, m) => s + m.longitude, 0) / members.length
    const bearing = (s: Stop) => Math.atan2(s.latitude - cLat, s.longitude - cLon)
    const swept = [...members].sort((a, b) => bearing(a) - bearing(b))
    const loads: Stop[][] = []
    let cur: Stop[] = []
    let curLoad = 0
    for (const s of swept) {
      if (curLoad + s.load > TRAILER_CAPACITY && cur.length) {
        loads.push(cur)
        cur = []
        curLoad = 0
      }
      cur.push(s)
      curLoad += s.load
    }
    if (cur.length) loads.push(cur)

    const clusterTrucks = loads.map((load, ti): Truck => {
      const seq: Stop[] = []
      const left = [...load]
      let at: [number, number] = [depot.latitude, depot.longitude]
      const legs: number[] = []
      // Start with the stop nearest the depot, then nearest neighbour.
      while (left.length) {
        let bi = 0
        let bd = Infinity
        left.forEach((s, i) => {
          const d = haversineMiles(at, [s.latitude, s.longitude])
          if (d < bd) {
            bd = d
            bi = i
          }
        })
        const [s] = left.splice(bi, 1)
        legs.push(bd * settings.circuity)
        seq.push(s)
        at = [s.latitude, s.longitude]
      }
      const truckId = `C${id}-T${ti + 1}`
      seq.forEach((s) => {
        s.cluster = id
        s.truck = truckId
      })
      const loadSum = seq.reduce((s, x) => s + x.load, 0)
      return {
        id: truckId,
        cluster: id,
        index: ti + 1,
        stops: seq.map((s) => s.id),
        legs,
        load: loadSum,
        value: seq.reduce((s, x) => s + x.value, 0),
        loadedMiles: legs.reduce((s, x) => s + x, 0),
        fill: loadSum / TRAILER_CAPACITY,
      }
    })
    trucks.push(...clusterTrucks)
    const fills = clusterTrucks.map((t) => t.fill)
    clusters.push({
      id,
      stops: members.map((m) => m.id),
      trucks: clusterTrucks.map((t) => t.id),
      load: members.reduce((s, m) => s + m.load, 0),
      value: members.reduce((s, m) => s + m.value, 0),
      avgFill: fills.reduce((s, f) => s + f, 0) / fills.length,
      minFill: Math.min(...fills),
      widestPair: widestPair(members.map((m) => [m.latitude, m.longitude]), settings.circuity),
      meanToCentroid:
        (members.reduce((s, m) => s + haversineMiles([m.latitude, m.longitude], [cLat, cLon]), 0) / members.length) *
        settings.circuity,
      loadedMiles: clusterTrucks.reduce((s, t) => s + t.loadedMiles, 0),
      centroid: [cLat, cLon],
      repairedFrom: g.repairedFrom,
    })
  })

  // 7. Metrics: three groups, side by side, no composite score.
  const revenueOrdered = lines.reduce((s, l) => s + l.ordered * l.valuePerPiece, 0)
  const revenueAllocated = lines.reduce((s, l) => s + l.allocated * l.valuePerPiece, 0)
  const revenueShipped = trucks.reduce((s, t) => s + t.value, 0)
  const fills = trucks.map((t) => t.fill)
  const metrics: RunMetrics = {
    k: clusters.length,
    trucks: trucks.length,
    avgFill: fills.reduce((s, f) => s + f, 0) / fills.length,
    minFill: Math.min(...fills),
    widestPair: Math.max(...clusters.map((c) => c.widestPair)),
    meanToCentroid: clusters.reduce((s, c) => s + c.meanToCentroid * c.stops.length, 0) / reachable.length,
    loadedMiles: trucks.reduce((s, t) => s + t.loadedMiles, 0),
    revenueOrdered,
    revenueAllocated,
    revenueShipped,
  }

  const residual = Object.fromEntries(Object.entries(remaining))
  const n = lines.length
  const result: PipelineResult = {
    settings,
    lines,
    stock,
    residual,
    stops,
    clusters,
    trucks,
    unshipped,
    metrics,
    autoKSearch,
    repairs,
    splits,
    // Representative wall times (seconds) for the stage view; the fixture itself runs in milliseconds.
    timings: {
      allocate: 0.08 + n / 90_000,
      aggregate: 0.03,
      cluster: 0.4 + autoKSearch.length * 0.06,
      solve: clusters.length * 10.2,
      validate: 0.05,
      metrics: 0.02,
    },
  }
  cache.set(key, result)
  return result
}

export const baseline = () => runPipeline()
