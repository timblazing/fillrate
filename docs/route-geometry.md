# Road geometry for inspected routes (M6/M7)

Spec §4 (map behavior), §7 (Valhalla), §10 (route inspection), §13 (GeoJSON). Valhalla's Route API draws the roads of
**one inspected truck**. It is a display of Valhalla's route for the same legs, not evidence about the solve: the plan was
optimized and validated on the recorded travel matrix, and Valhalla's route can differ from that matrix.

## Context rule (hard)

Geometry exists only for a succeeded pipeline run whose `travel_snapshot_id` is a snapshot with `provider: "valhalla"`
**and** only while this deployment's Valhalla identity equals the one recorded in the snapshot: provider version, dataset
revision, graph/config hash, costing (`truck`) and costing options (compared as canonical JSON). Otherwise the API answers
`409 geometry_unavailable` with a `reason`:

| reason | meaning |
| --- | --- |
| `estimated_travel` | the run used straight-line x circuity (or a haversine snapshot) |
| `imported_matrix` | the run used an imported matrix |
| `provider_context_mismatch` | Valhalla here differs from the snapshot's recorded context |
| `valhalla_not_configured` | the `VALHALLA_*` deployment variables are not set |

The web server decides this first (`packages/db/src/route-geometry.ts`), and the optimizer re-checks it
(`route_geometry.check_context`) together with the snapshot's content hash and node coordinates. Nothing is fetched or
drawn for estimated or imported runs, and no road line is ever substituted for a straight one or the reverse.

## Fetching

`POST /api/v1/runs/<id>/geometry` `{ "truck": "<truck id>" }` with an `Idempotency-Key`: the web server builds the truck's
physical stop sequence exactly as validated (the depot, then each visit's location in `sequence` order; an open route has
no return leg) and posts it with the snapshot to the optimizer's loopback `POST /route-geometry` (worker bearer token).
Python chunks the stops into `/route` requests of at most `VALHALLA_MAX_ROUTE_LOCATIONS` locations (default 20, the
server's `max_locations` for the truck costing) with one location shared between consecutive chunks, never resequencing.
Each request uses `break` locations, `costing: truck` with the recorded costing options, `units: kilometers`,
`shape_format: polyline6` and `directions_type: none`. Polyline6 shapes decode to `[lon, lat]` LineStrings, one per leg,
with the route's own leg length and time.

* A rejected chunk (HTTP 4xx, malformed response) is retried leg by leg so one bad leg does not hide the others. A leg that
  still fails is reported as `no_route` with the provider's message, and is drawn as nothing, never as a straight line.
* Identical consecutive coordinates are a zero-length leg (`same_location`); no request is made.
* A transient failure (timeout, connection, 5xx, 429) fails the whole fetch with `502 provider_unavailable`; there are no
  retries. The fetch has a request cap (120) and a total time limit (90 s), 15 s per request.
* Each leg is checked against the snapshot's matrix: the matrix distance (meters) and duration (seconds) the run used, the
  route's distance and duration, their absolute and relative difference, and `notable` when the distance differs by more
  than both 50 m and 1% or the time by more than both 30 s and 5%. Differences are recorded and shown; they are never hidden.
  CostMatrix values can depend on block composition, so some legs differ by several percent.

`GET /api/v1/runs/<id>/geometry` returns eligibility and which trucks are cached; `GET ...?truck=<id>` returns the cached
geometry or `404 geometry_not_fetched`. Every route resolves the caller with `principal()` and `assertRunRead` (another
owner's run is a 404; public example runs follow the existing example-run rules). A cache miss spends one unit of the
daily `geometry:<owner>` bucket (`QUOTA_ROUTE_GEOMETRY_PER_DAY`, default 100; public example runs
`PUBLIC_ROUTE_GEOMETRY_PER_HOUR`, default 120 when `PUBLIC_SYNTHETIC_RUNS=1`); a cached truck is free.

## Cache

Table `route_geometry` (migration 0010): key = hash of run, truck, snapshot identity and deployment identity; payload = a
content-addressed artifact (gzip JSON in `artifacts`, same store as stage artifacts but separate from a run's results,
manifests, export JSON and replay bundles). Rows are deleted with their run or owner and unreferenced artifacts are purged.
Changing the deployment identity changes the key, so stale geometry is neither read nor drawn.

## GeoJSON export

`GET /api/v1/runs/<id>/export?format=geojson` is unchanged: schematic straight lines (`geometry: "schematic_straight_line"`).
Add `&geometry=road` to include fetched road geometry: each fetched truck contributes one `LineString` per leg with
`role: "route_leg"`, `geometry: "valhalla_road"`, provider, provider version, dataset revision, graph/config hash, costing
and options, the route and matrix distance/time with deltas, and the note that the solver used the recorded matrix, not
these paths. A fetched truck's schematic line is replaced by its legs; trucks without fetched geometry keep their
`schematic_straight_line` route (spec §13 "where available"). Legs with no route are absent and listed under
`fillrate.road_geometry.legs_without_route`; `fillrate.geometry` is `mixed` when any road legs are present.

## UI

On `/runs/<id>` the Map tab (selected shipment) and the Timeline tab (its shipment) offer "Show road geometry" for eligible
runs. The map legend lists "Road geometry (Valhalla truck, <dataset>)" as a solid line and "Schematic straight line" as a
dashed one (the style differs, not only the color); the copy explains that the roads are a display, not proof of what the
solver used, and a collapsible table lists matrix versus road distance and time per leg. Ineligible runs say why. With road
geometry the Timeline cursor moves along each leg's road line, proportional to distance along the line, over the planned leg
duration; it remains a simulation without live traffic or GPS. Drive, wait and service states show on the map and the
timeline. Without geometry the existing schematic labels and behavior apply.

## Verification

`services/optimizer/tests/test_route_geometry.py` (fake transport: chunking and overlap, polyline6, discrepancies, open
routes, refusals, rejection handling; an opt-in live test when `VALHALLA_URL` is set), `packages/db/tests/route-geometry.test.ts`,
`apps/web/src/lib/geojson.test.ts`, `apps/web/src/lib/road-geometry.test.ts`, `scripts/test-hosted.mjs` and
`bun run test:browser --flow=road-geometry`, which is skipped with a message unless the `VALHALLA_*` variables are set.
