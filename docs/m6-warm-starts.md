# M6 verified warm starts

Spec §3 ("verify … warm starts … against the pinned release"), §5 ("initial solution if supported")
and §10 ("Warm starts are enabled only when supported and validated"). Implementation:
`services/optimizer/src/fillrate_optimizer/warmstart.py`, `loads.py` (`initial_solution`,
`solve_partition`), `pipeline.py` (solve stage); web: `apps/web/src/lib/server/warm-start.ts`;
store: `Store.warmStartSummary` / `leaseWarmStartSummary`; transport `/internal/worker/warm_start`.

## What pinned PyVRP 0.14.0 does (tests/test_warm_start.py)

- `pyvrp.solve(data, stop, seed, …, initial_solution=Solution(data, routes))` takes route lists of
  client indices (0-based, depot excluded). `Model.solve` is `pyvrp.solve(model.data())`.
- The iterated local search starts with the initial solution as its best and replaces it only by a
  strictly cheaper candidate (`cost_eval.cost`, which is penalty-independent for feasible
  solutions). With a feasible initial solution and any iteration budget, the returned objective is
  never higher (fixtures across 5 seeds × budgets 1/10/200). With `MaxIterations(0)` the result is
  the initial solution.
- PyVRP raises only for malformed route lists (a client twice, an unknown client). It **accepts
  without error** an infeasible start (over capacity), an incomplete start, and a `Solution` built on
  different `ProblemData`. Fillrate therefore never relies on PyVRP to judge a warm start:
  `loads.initial_solution` requires every client exactly once, no empty route, the same data object
  the solve uses, and PyVRP `is_complete()` and `is_feasible()`; otherwise `WarmStartRejected`.

## Compatibility rule (per cluster)

1. **Travel:** the source plan was validated on the same travel identity: estimated travel with the
   same circuity, or the same stored directed snapshot. Else `travel_changed`.
2. **Visits:** a validated source cluster planned exactly the new cluster's solve visits (same visit
   IDs). A non-validated source cluster over the same locations gives `source_invalid`; anything
   else `visit_set_changed`. Visit IDs encode location, customer and split bundle, so a change in
   clustering, inventory or trailer splitting shows up here.
3. **Demands:** every visit keeps its location and load. Else `demand_changed`.
4. **Validator gate:** the pipeline's independent validator (`validate_cluster`) accepts the mapped
   routes on the new problem: coverage, capacity, physical legs against the raw travel artifact and
   snapshot, durations, windows and the optional diameter policy. Else `invalid_on_new_problem` with
   the first violations.
5. **Solver gate:** `initial_solution` accepts it. Else `solver_rejected` (defensive; a plan that
   passes rule 4 is feasible to the adapter's model).

A cluster that fails any rule is solved cold. Every solved cluster records
`ClusterSummary.warm_start = {status: used|skipped, reason, source_cluster_id, initial_cost,
final_cost, detail}`; `RunSummary.warm_start` records the source, plan identity and counts, and a
`warm_start` info diagnostic summarizes the outcome. Empty and budget-exhausted clusters record none.

## Identity and provenance

- `RunSettings.warm_start = {kind: "run", run_id}` (left out of dumps when unset, so earlier
  settings, summaries and bundled examples keep their hashes).
- The worker records the source plan as a `warm_start` stage artifact (no parents; its output hash is
  the plan identity). The solve stage lists it as a parent and adds `warm_start` to its effective
  settings, and each cluster task hash includes the plan identity. Preflight through problem keep
  the same identities as a cold run.
- Warm starts are solver provenance: `comparisonSignature` (and any future `problemFingerprint`)
  ignores them.

## Access

- The web resolves the source with `assertRunRead` (`principal()`): the caller's own run or a run on a
  bundled example. Another owner's run is `404 warm_start_source_not_found`; a run that has not
  succeeded is `409 warm_start_source_not_ready`.
- `Store.enqueue` and `Store.createExperiment` repeat the rule inside the queuing transaction
  (against the submitter), and `/internal/worker/warm_start` repeats it for the leased run's owner
  before returning the source run's summary. Python never opens SQLite.

## Source interface (for future sources)

The pipeline consumes a `WarmStartPlan` (Pydantic, exported to the contracts as `WarmStartPlan`):

```
{schema_version: 1,
 source: {kind: "run", run_id},
 travel: {mode: "estimated", circuity} | {mode: "snapshot", snapshot_id},
 clusters: [{cluster_id, status, location_ids, routes: [[{visit_id, location_id, load}]]}]}
```

`plan_from_summary` builds it from a run summary (validated clusters carry routes in service order;
others carry none). A saved manual baseline could become a source by adding a `kind` to
`WarmStartSource`, a store method that owner-checks it, and a loader that returns the same document;
the compatibility rule and validator gate apply unchanged. Manual plans are not a source today.

## Replay

The bundle ships `warm-start.json` (the recorded `warm_start` artifact) and `expected.json` records
`warm_start: {source, plan_id, outcomes}`. Replay requires the file to hash to `plan_id` and name the
settings' source, reruns from it, and requires each cluster's outcome to reproduce. A warm-started run
without its plan is refused (`REPLAY FAILED: warm_start`), never replayed cold.

## UI and API

- `POST /api/v1/scenarios/runs` accepts `settings.warm_start: {run_id}` (kind defaults to `run`).
- `POST /api/v1/runs` accepts `warm_start` among its bounded example overrides.
- `/runs/<id>` of a succeeded run shows **Re-run warm-started** to callers who can start that run
  (example runs: anyone who can start synthetic runs; scenario runs: the scenario owner). It reruns
  the same version and settings with this run as the source. A warm-started run shows a **Warm start**
  panel (source link, used/skipped per cluster, reason, objective before → after).
