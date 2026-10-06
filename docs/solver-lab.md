# Solver Lab

The Solver Lab (`/labs`, M6) runs generic routing problems on the pinned PyVRP 0.14.0 without orders, products, allocation or clustering. It reuses the durable job queue, the worker, the contracts and the artifact store of the fulfillment pipeline (spec §4 "Progressive depth"). A lab instance is the spec §5 "normalized routing" boundary written directly: visits are created as clients, not derived from orders.

Implemented capabilities (each a `capabilities.py` behavior with a pytest fixture):

| Capability | Provided by | Fixture |
| --- | --- | --- |
| `solver_lab` | native PyVRP, independently validated | `tests/test_lab.py::test_lab_run_agrees_with_independent_validation` |
| `multiple_load_dimensions` | native (`delivery` / `capacity` vectors) | `tests/test_lab.py::test_weight_dimension_binds_and_changes_the_plan` |
| `heterogeneous_fleet` | native (`VehicleType` per type) | `tests/test_lab.py::test_mixed_fleet_uses_cheaper_type_within_its_count` |
| `multiple_depots` | native (several `Depot`s, `VehicleType.start_depot`/`end_depot`) | `tests/test_lab.py::test_vehicles_start_and_end_at_their_types_depots`, `::test_validator_rejects_routes_that_use_the_wrong_depot` |
| `reloads` | native (`VehicleType.reload_depots`, `max_reloads`) | `tests/test_lab.py::test_reloads_let_one_vehicle_serve_more_than_its_capacity`, `::test_validator_checks_loads_per_trip_and_rejects_bad_reloads` |

Planned and refused by name (`planned_capability`, HTTP 422): `optional_clients`, `client_groups`, `paired_shipments`, `pickups_and_deliveries`, `lab_time_windows`, `routing_profiles`.

## Instance (`LabInstance`, schema version 1)

Multiple depots added optional fields only (`start_depot`/`end_depot` on a vehicle type, `start_depot`/`end_depot` on a route in the result, which is absent in results stored earlier), so the schema stays at version 1 and existing instances and their fingerprints stay valid.

Pydantic owns the schema (`services/optimizer/src/fillrate_optimizer/lab/schema.py`); `bun run contracts:generate` exports it to `packages/contracts`. Every quantity is an integer in an explicit unit.

- `coordinates`: `planar` or `geographic`.
  - Planar: abstract benchmark coordinates `x`, `y` (never latitude/longitude). Distance is the rounded euclidean distance in "planar units"; one "planar time unit" elapses per distance unit. The UI draws planar instances as an SVG on equal axes, never on a map.
  - Geographic: `lat`, `lon`. Distance is haversine × `travel.circuity` (default 1.2) in integer meters, the pipeline's estimated travel; duration is meters ÷ `travel.speed_m_per_s` (default 11.176, 25 mph) rounded to seconds. No road matrices yet.
- `dimensions`: 1–8 `{id, label, unit}`. Client `delivery` names any subset (missing = 0); every vehicle type's `capacity` names all of them.
- `depots`: 1–10 places with coordinates. Each vehicle type's `start_depot` and `end_depot` (depot ids, default the first depot) say where its vehicles start and end; a route starts and ends at a depot, possibly different ones (no open-route workaround). The solver does not choose a vehicle's depot: it is fixed per type.
- `vehicle_types[].reload_depots` and `max_reloads`: depot ids where a vehicle may reload between trips, and the most reloads per route (a route has up to `max_reloads + 1` trips). Capacity applies to each trip on its own, since the vehicle is full again after a reload; `max_distance` and `shift_duration` apply to the whole route. A reload takes no time and costs only the distance driven. Both absent means no reloading; one without the other is refused. Results carry `trips` per route (from/to depot, clients, load, utilization, distance) and each visit its `trip`. Route `load` is the total delivered; `utilization` is the fullest trip.
- `clients`: up to 500, each with `delivery` and `service_duration` (duration units).
- `vehicle_types`: up to 10, each with a finite `count` (1–500), `capacity`, `fixed_cost` (per used vehicle), `unit_distance_cost`, `unit_duration_cost`, optional per-route `max_distance` and `shift_duration`, and `start_depot`/`end_depot`.
- `solver`: `seed`, `max_iterations` (default 2,000; null = runtime only) and `max_runtime_s` (≤ 30, a safety cap). Iteration-limited runs repeat exactly on the same pinned PyVRP; runtime-limited ones depend on the machine.
- `cost_unit`: a label for the integer costs.

Instances are validated in TypeScript (`packages/db/src/lab.ts`: JSON Schema, planned fields, references, capacity fit) and again in Python when the worker runs them. A client whose delivery fits no vehicle type is refused before solving; so is one no vehicle type can serve alone within its `max_distance` and `shift_duration` (worker preflight, `preflight_blocked`).

## Engine (`fillrate_optimizer.lab`)

| Module | Role |
| --- | --- |
| `schema.py` | Instance and result models, `PLANNED_FIELDS` |
| `travel.py` | Raw distance and duration matrices (nodes 0..D-1 = depots in order, then the clients in order; `depot_nodes` and `client_nodes` give the explicit id → node maps) |
| `build.py` | PyVRP model: `add_depots`, `add_clients`, `add_vehicle_types`, `add_edges`, plus an objective range check |
| `validate.py` | `instance_problems`, `preflight`, and the independent `validate_plan` (`ROUTE_CHECKS`, `PLAN_CHECKS`) |
| `solve.py` | `run_lab`: build, solve with seed/stopping criteria, map routes back to IDs, validate, cross-check, `problem_fingerprint` |
| `job.py` | The worker's `lab` job: one `lab` artifact (a `LabResult`) |
| `replay.py` | Checks behind the downloadable reproduction script |
| `examples.py` | The bundled examples (`uv run python -m fillrate_optimizer.lab.examples` writes `examples/lab-*.json`) |

**Validation.** `validate_plan` takes the instance, the raw matrices and candidate routes (vehicle type + ordered client IDs, from PyVRP or written by hand) and recomputes coverage (`client_not_visited`, `duplicate_visit`, `unknown_client`), fleet counts per type (`fleet_exceeded`, `unknown_vehicle_type`), per-dimension loads before and after every visit (reset at each reload) (`over_capacity` names the dimension), route depots (`too_many_reloads`, `wrong_reload_depot` and `empty_trip` for trips, `wrong_depot` when a route starts or ends somewhere other than its vehicle type's depots, `unknown_depot`), route limits (`max_distance_exceeded`, `shift_duration_exceeded`), distances (from the route's own start depot to its own end depot), durations (travel + service, no waiting since there are no windows) and the nominal objective. It never reads PyVRP's flags. `run_lab` then compares PyVRP's own per-route distance, duration, cost, loads and start/end depots with the recomputation and records any difference as `solver_mismatch`. `solver_feasible` (PyVRP) and `validated_feasible` (Fillrate) are kept separate.

**Objective.** PyVRP 0.14 nominal cost: per used vehicle its `fixed_cost`, plus `unit_distance_cost` × route distance and `unit_duration_cost` × route duration. The result reports the breakdown and, separately, PyVRP's excess load per dimension, excess distance and time warp. Penalty weights steer the search and are never reported as cost. Results say `proof: "heuristic"`; nothing is called optimal.

**Fingerprint.** `problem_fingerprint` hashes the dimensions and units, the depots, client demands and service durations, the full fleet definition (each type's start and end depot only when the instance has several depots, and its reload depots and `max_reloads` only for types that reload, so every single-depot fingerprint from before multiple depots is unchanged), the raw matrix identity, the objective definition and the cost unit (spec §10). Names, labels, descriptions and solver settings are excluded, so a reseeded run has the same fingerprint and only runs with matching fingerprints are comparable.

## Durable runs and API

A lab run is an ordinary run of kind `lab`. The instance is stored as a scenario version whose document has `kind: "lab_instance"`; such versions are never listed or opened as scenarios, cannot be saved over, swept or run by the pipeline, and only `lab` runs may use them (`Store.enqueue` checks the kind). The run's settings document is `{kind: "lab"}`. No migration was needed.

- Bundled examples are stored once under the public `examples` owner and run with the same admission as lesson examples (`syntheticAdmission`: accounts, operator, local mode, run key, or the anonymous public budget when enabled). Their runs are readable by everyone, like lesson runs.
- An owner's own instance (local/operator mode or a signed-in hosted account) is stored as that owner's private version and queued in the same write transaction that charges admission, so a refused admission leaves nothing behind. Reads, exports and cancellation follow the version owner (`assertRunRead`, `canCancel`).

| Endpoint | |
| --- | --- |
| `GET /api/v1/lab/examples` | Bundled instances with their asserted observations |
| `GET /api/v1/lab/runs` | Recent lab runs the caller can read |
| `POST /api/v1/lab/runs` | `{example}` or `{instance}`; `Idempotency-Key` header required |
| `GET /api/v1/lab/runs/<id>` | Status, progress, failure, instance and `LabResult` |
| `POST /api/v1/lab/runs/<id>/cancel` | Cancellation (kills the solver child process) |
| `GET /api/v1/lab/runs/<id>/export?format=json\|python` | Instance + result + provenance, or a reproduction script |

The Python script embeds the instance and the recorded outcome and calls `fillrate_optimizer.lab.replay` from a Fillrate checkout (`uv run python fillrate-lab-<id>.py` in `services/optimizer`). The fingerprint and validated feasibility must match; iteration-limited runs must also reproduce their objective and routes.

## Bundled examples

| Id | File | Observations (asserted in `tests/test_lab_examples.py`) |
| --- | --- | --- |
| `dimensions` | `lab-dimensions.json` | Planar, 12 clients, trucks of 1,200 kg and 4,000 L. Weight sets the count: 3 trucks (2,860 kg); no truck fills 60% of its volume. Seeds 0–3 agree. |
| `dimensions_volume` | `lab-dimensions-volume.json` | Weight removed: 2 trucks and a lower objective; checked against the two-dimension instance, both trucks are over 1,200 kg. |
| `fleet` | `lab-fleet.json` | Geographic (Memphis), 10 clients, 30 pallets; 3 vans (6 pallets) and 3 box trucks (14 pallets). Uses all 3 vans and 1 truck; fixed costs 85,000. |
| `fleet_trucks` | `lab-fleet-trucks.json` | Trucks only: 3 trucks, higher fixed and total cost. |
| `depots` | `lab-depots.json` | Planar, 12 clients, West and East depots 120 units apart, 2 vans of 12 parcels at each. Each route starts and ends at its van's depot and serves 3 stops on that side; objective 689 (400 fixed). Seeds 0–3 agree. |
| `depots_single` | `lab-depots-single.json` | The same stops and 4 vans, all at the West depot: two routes drive out to the East stops (each over 200 units), objective 1,096, same fixed cost. Learn: `/learn/multiple-depots`. |
| `reloads` | `lab-reloads.json` | Planar, 8 stops of 5 parcels beyond a yard; one van of 10 parcels reloads at the yard (max 3): one route of 4 full trips (dc→yard, yard→yard ×2, yard→dc), objective 533 (100 fixed + 433). Seeds 0–3 agree. |
| `reloads_off` | `lab-reloads-off.json` | The same stops without reloading: 4 vans of one trip each, fixed cost 400, distance 780, objective 1,180; the reloading van's route is longer than any of these. Learn: `/learn/reloads`. |

The `dimensions`/`dimensions_volume` and `fleet`/`fleet_trucks` pairs back the lessons `/learn/load-dimensions` and `/learn/heterogeneous-fleet`, which start them from the page and compare the persisted results.

## Adding a capability

Each later PR should stay small and touch only its own pieces:

1. **Schema:** add the fields to the relevant model in `lab/schema.py` and remove their `PLANNED_FIELDS` entries (mirror the removal in `PLANNED` in `packages/db/src/lab.ts`). 
2. **Builder:** change only the matching function in `lab/build.py` (`add_vehicle_types` for reloads, `add_clients` for prizes/required/groups, a new `add_shipments` for paired shipments) and, where the matrix gains nodes, `lab/travel.py`.
3. **Validator:** add one function to `ROUTE_CHECKS` or `PLAN_CHECKS` (for example reload trip loads, group exclusivity, shipment precedence, uncollected prizes), extend `build_route` only if the schedule or load profile changes, and extend `LabObjective` if the objective gains terms (prizes are a separate term, never folded into costs).
4. **Fingerprint:** add the new fields to `problem_fingerprint`.
5. **Capabilities and fixtures:** flip the planned behavior to implemented with a `tests/test_lab.py` fixture that shows native behavior and a validator rejection.
6. **TypeScript:** extend `labInstanceProblems` for new references, regenerate contracts, and show the new fields in `/labs/<id>`.

Known gaps: no time windows, road matrices or map for geographic lab instances (the plot is a labeled schematic projection), no form editor (JSON only), and no warm starts or manual route evaluation. The account data export (`/api/v1/me/export`) lists lab runs; each run's instance and result come from its run export.
