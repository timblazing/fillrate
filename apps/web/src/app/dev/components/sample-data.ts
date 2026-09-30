// Synthetic time-window data for the Later milestones timeline specimen only (spec §14: never real data).

import type { TimelineRoute, UnassignedVisit } from "@/components/lab/route-timeline"

// Minutes from local midnight.
const h = (hh: number, mm = 0) => hh * 60 + mm

export const timelineRoutes: TimelineRoute[] = [
  {
    route: 1,
    vehicle: "Box truck A",
    segments: [
      { kind: "drive", start: h(8), end: h(8, 14) },
      { kind: "service", start: h(8, 14), end: h(8, 26), stopId: "c-01", window: [h(8), h(10)] },
      { kind: "drive", start: h(8, 26), end: h(8, 44) },
      { kind: "wait", start: h(8, 44), end: h(9) },
      { kind: "service", start: h(9), end: h(9, 8), stopId: "c-02", window: [h(9), h(12)] },
      { kind: "drive", start: h(9, 8), end: h(9, 31) },
      { kind: "wait", start: h(9, 31), end: h(10) },
      { kind: "service", start: h(10), end: h(10, 18), stopId: "c-03", window: [h(10), h(13)] },
      { kind: "drive", start: h(10, 18), end: h(10, 40) },
    ],
  },
  {
    route: 2,
    vehicle: "Cargo van B",
    segments: [
      { kind: "drive", start: h(8, 10), end: h(8, 32) },
      { kind: "service", start: h(8, 32), end: h(8, 42), stopId: "c-04", window: [h(8, 30), h(11)] },
      { kind: "drive", start: h(8, 42), end: h(9, 5) },
      { kind: "wait", start: h(9, 5), end: h(11) },
      { kind: "service", start: h(11), end: h(11, 15), stopId: "c-05", window: [h(11), h(14)] },
      { kind: "drive", start: h(11, 15), end: h(11, 40) },
      { kind: "wait", start: h(11, 40), end: h(12) },
      { kind: "service", start: h(12), end: h(12, 5), stopId: "c-06", window: [h(12), h(15)] },
      { kind: "drive", start: h(12, 5), end: h(12, 30) },
    ],
  },
  {
    route: 3,
    vehicle: "Box truck C",
    segments: [
      { kind: "drive", start: h(8), end: h(8, 20) },
      { kind: "service", start: h(8, 20), end: h(8, 45), stopId: "c-07", window: [h(8), h(17)] },
      { kind: "drive", start: h(8, 45), end: h(9, 5) },
      { kind: "wait", start: h(9, 5), end: h(13) },
      { kind: "service", start: h(13), end: h(13, 10), stopId: "c-08", window: [h(13), h(16)] },
      { kind: "drive", start: h(13, 10), end: h(13, 34) },
    ],
  },
]

export const timelineUnassigned: UnassignedVisit[] = [
  { stopId: "c-09", window: [h(7), h(7, 30)], reason: "Window closes before any vehicle can arrive" },
  { stopId: "c-10", window: [h(15), h(16)], reason: "No vehicle has capacity left after 13:00" },
]
