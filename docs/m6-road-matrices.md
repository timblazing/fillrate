# M6 road matrices

The first M6 increment added Python providers and fixtures. The second (below) stores
immutable snapshots, binds them to run settings and lets the worker route over them.
Estimated travel stays the default. `directed_road_travel` stays `planned` in the
capabilities document until the browser can select a matrix and the matrix inspector,
imported-matrix preview and a live pinned Valhalla deployment exist.

`travel_provider.py` defines `TravelProvider`, `TravelNode`, and `TravelSnapshot`.
Estimated, imported, and Valhalla providers return the same snapshot format. A snapshot
records ordered node IDs and coordinates, provider/version, dataset revision, profile,
options, raw distances and durations, their units, warnings, and conversion policy.
Distance and duration must agree on reachability; both are `null` for a missing edge.
The diagonal must be reachable and zero. Snapshots are limited to 1,001 nodes so the
initial in-memory implementation has a bounded size.

`snapshot.effective(nodes)` validates coordinate binding, selects/reorders nodes,
and converts to integer meters and seconds. It rounds once with nearest-integer,
ties-to-even semantics. Missing edges become `-1`; they never become a large physical
distance, zero, or a haversine fallback. Raw snapshot values remain unchanged.
The identity hashes the complete snapshot, including coordinates and metadata.

An imported snapshot can be replayed without a network provider:

```python
import json
from fillrate_optimizer.travel_provider import ImportedTravel, TravelNode

nodes = [TravelNode(id="D", lat=35, lon=-90), TravelNode(id="A", lat=35, lon=-89.99)]
provider = ImportedTravel(json.load(open("matrix.json")))
snapshot = provider.matrix(nodes)
distance_m, duration_s = snapshot.effective()
```

`ValhallaTravel(ValhallaConfig.from_env())` reads the endpoint only from deployment
configuration. It sends sequential POST requests to `sources_to_targets` with `truck`
costing, explicit costing options, kilometers, and verbose source/target indices.
It reassembles blocks by those indices rather than trusting response order. Request
failures, malformed blocks, wrong units, duplicate/missing indices, and invalid values
raise `ProviderError`; they never become unreachable edges. No partial snapshot returns.
The request/response format follows the [Valhalla matrix API](https://valhalla.github.io/valhalla/api/matrix/).

The configured block size defaults to 50 and shrinks to fit pair and location limits.
The point extent must fit the deployment's `max_matrix_distance`, independently of
Fillrate's leg limit. Transient transport failures retry at most twice with cancellable
backoff; permanent errors do not retry. Block requests have a 15-second timeout and
matrix assembly has a 300-second budget by default. Cooperative cancellation checks
run between requests and during retry backoff. The existing worker process kill remains
necessary for interrupting an in-flight blocking request.

The provider configuration requires these environment variables:

- `VALHALLA_URL`, the self-hosted endpoint; redirects and URL credentials are rejected.
- `VALHALLA_VERSION`, the pinned deployment version/image identity.
- `VALHALLA_DATASET_REVISION`, the recorded extract/dataset identity.
- `VALHALLA_GRAPH_CONFIG_HASH`, the graph build and effective server configuration identity.
- `VALHALLA_COSTING_OPTIONS`, a JSON object of resolved truck defaults and overrides.

Optional limits are `VALHALLA_BLOCK_SIZE`, `VALHALLA_MAX_MATRIX_PAIRS`,
`VALHALLA_MAX_MATRIX_LOCATIONS`, and `VALHALLA_MAX_MATRIX_DISTANCE_M`. Defaults are
50, 2,500, 100, and 400,000. These must match the pinned deployment's effective limits.
The client does not claim to discover server limits or fill in missing costing defaults.

`tests/test_travel_provider.py` proves directed reconstruction, unit conversion, coordinate
invalidation, missing edges, block limits, retries, deadlines, and cancellation. A real
PyVRP fixture solves depot → A → B with directed raw distances of 400 km + 200 km.
The raw 999 km return stays in the snapshot and contributes nothing to open-route mileage.
The existing independent validators reject missing physical legs and the load validator
now checks reported mileage against the physical matrix.

## Durable snapshots and worker selection

A snapshot is stored once under its identity: the SHA-256 of its canonical JSON (sorted keys,
defaults filled in, JavaScript number formatting), covering coordinates, provider, version,
dataset revision, profile, options, units, conversion policy and every raw value. The same
document always has the same identity in Python and Node; `packages/contracts/fixtures/travel-parity.json`
is asserted by both pytest and Vitest (identity, integer-meter conversion with a half-meter tie,
and preflight findings). Regenerate it with `uv run python -m tests.travel_parity`.

- **Storage.** `travel_snapshots` holds the gzip bytes, size and display metadata. SQLite triggers
  forbid `UPDATE` and `DELETE`; every read gunzips with a size bound and re-hashes, so a row that
  no longer matches its identity is `travel_snapshot_corrupt`. The limit is 64 MiB decoded and
  1,001 nodes (a full 1,001-node matrix with 5-decimal values is about 37 MB; measured on a Mac,
  Node validates, hashes and stores it in about 1.1 s and Python validates and re-hashes it in
  about 2 s).
- **Upload.** `POST /api/v1/travel-snapshots` (operator key) validates the document with the same
  rules as `TravelSnapshot` and returns `{id, created, ...}`; saving the same document again is a
  no-op. `GET /api/v1/travel-snapshots/<id>` returns metadata only. There is no browser control.
- **Selection.** `RunSettings.travel_snapshot_id` is the identity, or `null` for estimated travel
  (haversine × `travel_circuity`). With a snapshot, `travel_circuity` is not used for travel. The
  public synthetic API cannot set it, and the k explorer rejects it (it clusters on the symmetric
  spatial metric only).
- **Node namespace.** Depot and location IDs share one namespace, so a location with the depot's
  ID cannot be bound. A run needs the depot and every located stop with active demand (not
  excluded, with coordinates); the pipeline's allocated stops are a subset.
- **Edited coordinates.** Before anything is queued, every required node must exist in the snapshot
  at exactly the scenario's current coordinates. Otherwise the request fails with
  `travel_snapshot_stale` (422; `settings.travel_snapshot_id` and `location:<id>` fields) and a
  missing snapshot with `travel_snapshot_not_found` (404). The check lives in `Store.enqueue` and
  `Store.createExperiment`, so scenario runs, sweeps and any future caller share it. Stops whose
  lines are all excluded carry no demand and do not need to match. The worker repeats the check
  (`travel_snapshot_mismatch`) for rows that bypass the store.
- **Worker transport.** `/internal/worker/snapshot` returns a snapshot only for a live lease whose
  run selected that exact identity. The Python pipeline never trusts it: the document is
  re-validated and re-hashed, and a different hash is `travel_snapshot_identity`. Permanent
  failures with their own codes: `travel_snapshot_missing`, `_unavailable` (transport, absent row,
  invalid document), `_identity`, `_mismatch`, `_unbound` (a snapshot passed without a selection).
- **Preflight and reachability.** Submission preflight (TypeScript) and the pipeline (Python) read
  the selected directed matrix at integer meters. A stop is "far" when the depot → stop leg is
  missing or over the leg limit, and "far via stop" when a chain of allowed directed legs reaches
  it. A stop no chain reaches is `far_from_depot` at preflight and `unreachable` in the plan
  (`unreachable_in_partition` when another partition's bridge would have reached it). Return legs
  are never read. Rounding is nearest, ties to even, in both languages; a missing edge is `-1`,
  never a distance. Clustering still uses the symmetric haversine metric.
- **Independent validation.** The validator checks each route leg against the leg read directly
  from the snapshot, not only against the travel artifact, so a stale or forged cache entry whose
  hashes verify is rejected as an invalid plan.
- **Stage identities.** With a snapshot, the preflight and travel stages hash
  `travel_snapshot_id` instead of `travel_circuity`; estimated runs keep their existing keys, so
  their cache entries are unchanged. Later stages chain through output hashes. A different matrix
  recomputes travel and everything after it while allocation, aggregation and clustering are reused.
- **Comparison.** The signature gains `travel: {snapshot}` and drops the estimating circuity when a
  snapshot is selected, so road and estimated runs, or runs on different snapshots, are different
  cohorts ("Road travel snapshot" / "Estimated travel" chips). A circuity sweep axis is refused
  when the base run selects a snapshot.
- **Provenance and replay.** `RunSummary.travel` records mode, provider, version, dataset
  revision, profile and the snapshot identity. The replay bundle adds `travel-snapshot.json`
  (deflated); `replay.py` loads it offline, refuses a file that does not hash to the recorded
  identity, and checks that the travel provenance reproduces. Bundles are bounded to 16 MiB
  excluding the snapshot, which has its own 64 MiB bound.

Next M6 increments:

1. Add imported-matrix preview and a browser control for selecting a snapshot (showing the
   estimated/road difference), then a matrix inspector. Enable `directed_road_travel` and the
   `travel_modes` entry only with tested browser selection.
2. Add the pinned Compose service, extract preparation and recorded deployment coverage.
   Test against that live image, including out-of-coverage nodes and effective costing defaults.
   A worker job that builds a Valhalla snapshot (the provider exists; nothing calls it yet).
3. Fetch geometry only for inspected routes, with independent chunk/segment checks.
4. Add advanced fleet/window/depot features, manual evaluation and warm starts one at a time.
