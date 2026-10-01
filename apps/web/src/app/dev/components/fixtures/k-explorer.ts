// k explorer stand-in (spec §8a "Cluster stability"): clustering only, over a k range × seeds 0–9.
// Inertia per k, clusters needing diameter repair, seed stability (mean pairwise ARI), and per-stop
// assignment confidence from the co-assignment matrix. Descriptive statistics, not solver objectives.

import { baseline, haversineMiles, kmeans } from "./pipeline"

const EARTH_MILES = 3958.8
const rad = (d: number) => (d * Math.PI) / 180

function adjustedRand(a: number[], b: number[]) {
  const n = a.length
  const table = new Map<string, number>()
  const ra = new Map<number, number>()
  const rb = new Map<number, number>()
  for (let i = 0; i < n; i++) {
    const key = `${a[i]}:${b[i]}`
    table.set(key, (table.get(key) ?? 0) + 1)
    ra.set(a[i], (ra.get(a[i]) ?? 0) + 1)
    rb.set(b[i], (rb.get(b[i]) ?? 0) + 1)
  }
  const c2 = (x: number) => (x * (x - 1)) / 2
  let index = 0
  for (const v of table.values()) index += c2(v)
  let sa = 0
  let sb = 0
  for (const v of ra.values()) sa += c2(v)
  for (const v of rb.values()) sb += c2(v)
  const expected = (sa * sb) / c2(n)
  const max = (sa + sb) / 2
  return max === expected ? 1 : (index - expected) / (max - expected)
}

export type KRow = {
  k: number
  /** Mean within-cluster sum of squared distances over seeds, in solver mi². */
  inertia: number
  /** Clusters over the diameter limit before repair, reference seed. */
  repairs: number
  /** Mean pairwise adjusted Rand index across seeds. */
  stability: number
}

export type KExploration = {
  rows: KRow[]
  seeds: number[]
  stopIds: string[]
  /** Per k: reference-seed labels and per-stop confidence. */
  detail: (k: number) => { labels: number[]; confidence: number[] }
}

let cached: KExploration | null = null

export function exploreK(kMin = 3, kMax = 12, seeds = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]): KExploration {
  if (cached) return cached
  const run = baseline()
  const { circuity, maxLegMiles } = run.settings
  // Repairs only count when the optional diameter policy is on; it is off by default (spec v1.8).
  const maxDiameterMiles = run.settings.maxDiameterMiles ?? Infinity
  const stops = run.stops.filter((s) => s.depotMiles <= maxLegMiles)
  const vecs = stops.map((s) => {
    const lat = rad(s.latitude)
    const lon = rad(s.longitude)
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)] as [number, number, number]
  })
  const toMi2 = (EARTH_MILES * circuity) ** 2

  const labelsByK = new Map<number, number[][]>()
  const rows: KRow[] = []
  for (let k = kMin; k <= kMax; k++) {
    const runs = seeds.map((seed) => kmeans(vecs, k, seed))
    labelsByK.set(
      k,
      runs.map((r) => r.labels)
    )
    let ari = 0
    let pairs = 0
    for (let i = 0; i < runs.length; i++)
      for (let j = i + 1; j < runs.length; j++) {
        ari += adjustedRand(runs[i].labels, runs[j].labels)
        pairs++
      }
    const ref = runs[0].labels
    let repairs = 0
    for (let c = 0; c < k; c++) {
      const members = stops.filter((_, i) => ref[i] === c)
      let w = 0
      for (let i = 0; i < members.length && w <= maxDiameterMiles; i++)
        for (let j = i + 1; j < members.length; j++)
          w = Math.max(
            w,
            haversineMiles([members[i].latitude, members[i].longitude], [members[j].latitude, members[j].longitude]) * circuity
          )
      if (w > maxDiameterMiles) repairs++
    }
    rows.push({
      k,
      inertia: (runs.reduce((s, r) => s + r.inertia, 0) / runs.length) * toMi2,
      repairs,
      stability: ari / pairs,
    })
  }

  const detailCache = new Map<number, { labels: number[]; confidence: number[] }>()
  const detail = (k: number) => {
    const hit = detailCache.get(k)
    if (hit) return hit
    const all = labelsByK.get(k)!
    const ref = all[0]
    // Confidence: mean share of seeds that co-assign the stop with each of its reference-cluster mates.
    const confidence = stops.map((_, i) => {
      let sum = 0
      let mates = 0
      for (let j = 0; j < stops.length; j++) {
        if (j === i || ref[j] !== ref[i]) continue
        let together = 0
        for (const labels of all) if (labels[i] === labels[j]) together++
        sum += together / all.length
        mates++
      }
      return mates ? sum / mates : 1
    })
    const out = { labels: ref, confidence }
    detailCache.set(k, out)
    return out
  }

  cached = { rows, seeds, stopIds: stops.map((s) => s.id), detail }
  return cached
}
