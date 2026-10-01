# M6 road matrices

The first M6 increment adds Python providers and fixtures. Browser and worker jobs
still use estimated travel. `directed_road_travel` stays `planned` in the capabilities
document until durable snapshots and job selection are implemented.

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

Next M6 increments:

1. Store immutable raw snapshots and bind their identities to run settings, stage reuse,
   comparison signatures, and replay exports. Revalidate edited coordinates before enqueueing.
2. Make both Python and submission preflight use the selected directed matrix for travel
   reachability. Keep clustering's symmetric spatial metric separate.
3. Add imported matrix preview and worker travel selection, then a matrix inspector. Show
   road/estimated measurement differences and enable controls only with tested capabilities.
4. Add the pinned Compose service, extract preparation and recorded deployment coverage.
   Test against that live image, including out-of-coverage nodes and effective costing defaults.
5. Fetch geometry only for inspected routes, with independent chunk/segment checks.
6. Add advanced fleet/window/depot features, manual evaluation and warm starts one at a time.
