# Progress

Current baseline: `origin/main` at `e95f3cb`, reviewed 2026-10-06. This is the current evidence/gap record; [completion-plan.md](completion-plan.md) owns delivery order, [frontend-spec.md](frontend-spec.md) owns dashboard acceptance, and [owner-actions.md](owner-actions.md) owns deployment/input actions. The complete pre-rewrite dated log and detailed checklists are preserved in [history/progress-through-2026-10-06.md](history/progress-through-2026-10-06.md). Historical undated next steps are superseded.

## 2026-10-06: Completion and launch documentation rewrite (Codex)
- Reconciled technical specification and handoff against merged routing features and current status. Removed stale draft/unbuilt claims and the obsolete direct-main brief. Stable spec section numbers and M1–M8 identifiers remain.
- Added a documentation index, completion/launch plan, frontend/dashboard acceptance specification and consolidated owner actions. Preserved prior evidence in history rather than deleting it.
- Owner removed design-file work from completion scope. CSS tokens and the running gallery are the design reference. Dashboard integration/performance is required M8 work; M2 review acceptance remains historical evidence.
- Source review confirms gallery Blocks and product views are separate compositions sharing some lab components. No visual parity or performance completion is claimed by this pass. Frontend measurements and browser evidence are required next.
- Other session owns the `e95f3cb` image release and `release-verification.md` evidence PR. This work does not dispatch images, record a new digest or alter that file.
- Planning estimates are revised for the expanded M8 scope; no new runtime behavior is claimed. Validation: the actual `parseProjectDocs` function parsed all eight spec/progress milestones and the new dated decision; new/current planning links resolve, status weights sum to 100, and `git diff --check` passes. Runtime lint/typecheck/build and browser suites were not rerun for this docs-only change.

## Milestones (spec §15)
- [x] **M1 Thin durable fulfillment slice**
  - [x] SQLite durable jobs, leased Python worker, real PyVRP pipeline, independent validation and persisted exports.
  - [x] CI and combined amd64/arm64 image have historical smoke evidence.
- [x] **M2 Accepted design**
  - [x] Round-two Blocks, run page and shipment sheet accepted 2026-10-01; shared wording, fill thresholds and preflight policy applied.
  - [x] Design-file work removed from completion scope 2026-10-06. Separate dashboard completion is required under M8.
- [x] **M3 Operational core**
  - [x] Imports, versioned/branched scenarios, conflicts, submission preflight, monetary objective, reuse/checkpoints and partial error plans.
  - [x] Synthetic 2,000-order performance has recorded solver evidence; this is not frontend responsiveness evidence.
- [x] **M4 Trustworthy experiments / first release**
  - [x] k explorer, bounded/ranked experiments and comparable cohorts.
  - [x] Accepted hosted/request release: owner sign-in, isolation/quotas, target image recovery and on-server backups; second live account waived.
- [x] **M5 Allocation and import depth**
  - [x] Five allocation strategies, whole-order/CP-SAT, provenance, geocoding/cache/ZIP fallback and coordinate review.
- [ ] **M6 Roads and advanced routing**
  - [x] Directed snapshots, pinned Valhalla local evidence, durable snapshot jobs and inspected road geometry.
  - [x] Time windows/service durations, saved manual baselines/warm starts and heterogeneous fulfillment fleet.
  - [x] Solver Lab dimensions, fleets, depots, reloads, optional visits, alternative groups and pickup-delivery pairs with validation.
  - [ ] Owner VPS Valhalla deployment, coverage/resources and timings; conditional for hosted road-enabled launch.
- [x] **M7 Learning and export depth**
  - [x] Fulfillment and advanced-feature lessons, pipeline/explorer replay, planned timeline/playback, GeoJSON and matrix exports.
- [ ] **M8 Verification and handoff**
  - [x] Recorded 21 production browser flows at desktop/phone and 144 hosted/local checks (prior sessions; not rerun by this documentation pass).
  - [x] Request-access/admin phone review, npm-compatible scripts, native documentation and handoff.
  - [x] Historical image target timings/recovery on VPS/Pi; native timings only in a dev container.
  - [ ] Six-Block production coverage audit and dashboard integration acceptance.
  - [ ] Measured 2,000-order and matrix frontend responsiveness/performance acceptance.
  - [ ] Basemap public-use terms/attribution record and final candidate verification.
  - [ ] Current runtime image publication (other active session), then final dashboard image release and deployed-digest evidence.
  - [ ] Native target timings on VPS/Pi for full distribution handoff.

## Current state

The hosted first release is accepted, while latest source includes later routing and learning work. Current technical capabilities are determined by merged source and executable proofs, not the older release snapshot. See technical references and the dated history for per-feature tests. Publication and deployment for `e95f3cb` are not established by this documentation pass.

Gallery Blocks use illustrative fixtures; product result screens use persisted runs. Shared components exist, but full composition/interaction parity and optimization require the frontend audit. No `.fig` work is needed.

## Known gaps

- Dashboard coverage, responsive/accessibility review and measured frontend performance remain open under frontend-spec.md. Matrix heatmap cell rendering needs profiling at large sizes; no optimization is claimed.
- Latest image publication is owned by the other session. Deployment is separately owned by the user; do not infer a live upgrade from merged source or a successful image workflow.
- VPS Valhalla coverage/timings are absent. Local pinned/provider/geometry evidence is distinct from hosted evidence.
- Basemap public-use/provider terms record referenced by the spec is missing; create it after inspecting the shipped configuration.
- Native timings on VPS/Pi are missing. Historical image timings/recovery remain valid for their recorded digest only.
- Manual editing cannot move visits between clusters. Warm starts reuse only compatible cluster visit/demand/travel sets; saved manual baselines are now supported.
- Solver Lab supports advanced adapters but still uses JSON editing and estimated geographic travel/schematic display. Pickup-delivery pairs with reloads are refused. Generic Lab support does not imply business-pipeline support.
- Snapshot node identity/coordinate matching is exact; edited coordinates require a new snapshot. Large snapshots and replay bundles have substantial in-memory/transfer cost.
- Geocoding jobs run in the web process; restarts fail unfinished jobs, cached replies remain reusable. Census failures are explicit; ZIP fallback is approximate.
- Checkpoints from abandoned attempts can remain visible alongside final execution checkpoints. Matrix partition reuse is not implemented.
- Pre-2026-10-05 results may have unavailable timeline timing; schematic geometry and estimated durations must stay labeled. Road geometry is available only under the matching recorded Valhalla context.
- On-server daily backups have 30-day retention but no off-host copy. Per-IP quotas require a trusted proxy-only ingress/header configuration.
- Hosted cross-account isolation is automated-test evidence, not a two-live-account deployment check. That live check remains waived.
- Real sample rows are missing; monetary rates were N/A. Synthetic acceptance and trucks-then-miles can proceed.

## Waiting on the primary user (come back to this)

See [owner-actions.md](owner-actions.md). Deploy-by-digest is required for live upgrade; VPS Valhalla evidence is conditional on hosted road support; native target timings close the broader handoff. Real samples, rates and off-host backups retain their explicit optional/deferred scope. No design-file action remains.

## Next step

Audit the six design-system Blocks against production screens, capture concrete gaps and baseline frontend measurements, then implement the highest-impact workflow/composition fixes. The current image release can proceed independently in the other session. See [completion-plan.md](completion-plan.md) for dependencies and exit evidence.
