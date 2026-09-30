// Shapes of the fulfillment pipeline (spec §5, §8, §8a, §10) as the UI consumes them.
// Provisional until packages/contracts generates types from the optimizer's OpenAPI schema (M1/M3).
// Units: linear feet in hundredths of a foot, money in integer cents, distances in solver miles.

import type { CoordinateSource } from "@/components/lab/provenance-badge"

export type Product = {
  id: string
  sku: string
  label: string
  /** Default linear feet per piece, hundredths. */
  lfPerPiece: number
  /** Net value per piece, cents. */
  valuePerPiece: number
}

export type Location = {
  id: string
  label: string
  city: string
  state: string
  latitude: number
  longitude: number
  source: CoordinateSource
}

export type OrderLine = {
  id: string
  orderId: string
  locationId: string
  productId: string
  /** ISO date, local to the scenario timezone. */
  orderDate: string
  ordered: number
  allocated: number
  lfPerPiece: number
  valuePerPiece: number
}

export type Stop = {
  id: string
  locationId: string
  label: string
  city: string
  latitude: number
  longitude: number
  /** Summed allocated linear feet (hundredths). At most one trailer after splitting. */
  load: number
  /** Summed allocated amount (cents). */
  value: number
  lineIds: string[]
  orderIds: string[]
  /** Set when an over-trailer stop was split into several visits. */
  split?: { index: number; of: number }
  /** Solver miles from the depot. */
  depotMiles: number
  cluster: number | null
  truck: string | null
  /** k-explorer assignment confidence, 0–1, when the run's k came from the explorer. */
  confidence?: number
}

export type Truck = {
  id: string
  cluster: number
  index: number
  /** Stop IDs in visit order. Open route: the truck does not return to the depot. */
  stops: string[]
  /** Solver miles per leg: depot → first stop, then stop → stop. */
  legs: number[]
  load: number
  value: number
  loadedMiles: number
  fill: number
}

export type Cluster = {
  id: number
  stops: string[]
  trucks: string[]
  load: number
  value: number
  avgFill: number
  minFill: number
  /** Widest pair distance, solver miles. */
  widestPair: number
  meanToCentroid: number
  loadedMiles: number
  centroid: [number, number]
  /** Present when this cluster came from bisecting an over-diameter k-means cluster. */
  repairedFrom?: number
}

export type UnshippedReason = "no-stock" | "unreachable" | "did-not-fit" | "data-quality"

export type UnshippedLine = {
  lineId: string
  orderId: string
  productId: string
  locationId: string
  orderDate: string
  /** Pieces that will not ship. */
  pieces: number
  ordered: number
  amount: number
  reason: UnshippedReason
  detail: string
  /** Earlier or higher-value lines that took the stock, for "no-stock". */
  competing?: string[]
  competingCount?: number
}

export type RunMetrics = {
  k: number
  trucks: number
  avgFill: number
  minFill: number
  widestPair: number
  meanToCentroid: number
  loadedMiles: number
  revenueOrdered: number
  revenueAllocated: number
  revenueShipped: number
  /** Mean pairwise adjusted Rand index for this k, when it came from the k explorer. */
  stability?: number
}

export type PipelineSettings = {
  k: number | "auto"
  kmeansSeed: number
  nInit: number
  circuity: number
  maxLegMiles: number
  maxDiameterMiles: number
  inventoryPct: number
  strategy: "date-value" | "first-come"
  fulfillment: "piece" | "whole-order"
}

export type StageId = "allocate" | "aggregate" | "cluster" | "solve" | "validate" | "metrics"
