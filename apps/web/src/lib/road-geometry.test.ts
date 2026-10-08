import { expect, test } from "vitest"

import { chunkLocations, decodePolyline6 } from "./road-geometry"

test("decodes a precision-6 polyline", () => {
  // Google's reference polyline "_p~iF~ps|U_ulLnnqC_mqNvxq`@" (precision 5) re-encoded at precision 6.
  const decoded = decodePolyline6("_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI")
  expect(decoded).toHaveLength(3)
  expect(decoded[0][0]).toBeCloseTo(-120.2, 6)
  expect(decoded[0][1]).toBeCloseTo(38.5, 6)
  expect(decoded[2][0]).toBeCloseTo(-126.453, 6)
  expect(decoded[2][1]).toBeCloseTo(43.252, 6)
})

test("chunks overlap by one location so no leg is lost", () => {
  const stops = Array.from({ length: 45 }, (_, i) => i)
  const chunks = chunkLocations(stops, 20)
  expect(chunks.map((c) => c.length)).toEqual([20, 20, 7])
  expect(chunks[1][0]).toBe(chunks[0][19])
  expect(chunks.reduce((n, c) => n + c.length - 1, 0)).toBe(44)
  expect(chunkLocations([1, 2], 20)).toEqual([[1, 2]])
})
