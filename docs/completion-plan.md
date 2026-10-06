# Complete Fillrate and update the live release

Baseline: merged `main` at `e95f3cb` on 2026-10-06. Existing hosted/request access was accepted earlier; current source is ahead of that evidence. This plan replaces stale next-step lists while preserving the technical spec and M1–M8 history. It adds no new solver engine scope.

## Definition of complete and live

The current product is complete when the required frontend specification passes, documented capabilities match working behavior, all applicable correctness/access/browser checks pass on the final candidate, and the handoff accurately describes that candidate. It is live when the tested multi-architecture image is pinned and deployed, migrations/worker health and the primary workflow pass on the VPS, and the exact deployed digest and checks are recorded. Publication alone closes neither deployment nor product completion.

A hosted launch with estimated travel is supported. Road-enabled launch additionally requires VPS Valhalla coverage/provider identity, matrix and geometry checks and recorded resource/timing evidence. Keep road availability truthful until that evidence exists. Native target timings complete the broader M8 handoff but do not block an otherwise verified hosted release. Optional inputs and off-host backups retain their accepted scope below.

## Delivery order and reviewable slices

| Priority / slice | Owner | Dependencies | Exit evidence |
| --- | --- | --- | --- |
| P0: current image publication | Other active release session | Green `main` at `e95f3cb` | `image.yml` run ID, both architecture smokes, published manifest and digest in its docs-only PR; no duplicate dispatch here |
| P1: dashboard coverage audit | Implementation session | Current frontend + accepted gallery Blocks | All six frontend-spec rows have observed gaps/intentional differences, production paths and desktop/phone captures; prioritize workflow defects first |
| P1: dashboard integration | Implementation session | Audit findings | Orders/configuration → run/results → explorer/comparison delivered in scoped PRs with real data, functional and visual evidence; shared gallery/product composites where appropriate |
| P1: frontend performance | Implementation session | Baseline measurements; integrate alongside UI fixes | Recorded 2,000-order/matrix measurements meet frontend-spec budgets; identified bottlenecks fixed; no fixture output used as product evidence |
| P1: candidate verification | Implementation session | Final integrated dashboard candidate | Lint/typecheck/build, relevant full suites and contracts, hosted/local acceptance, complete applicable browser coverage; capability and docs reconciliation |
| P1: final image and deployment | Release session + owner | Candidate green; image workflow | Both architecture smokes and published digest; pre-upgrade backup, deploy-by-digest, migration/health/access and live synthetic workflow checks; rollback reference |
| Conditional: VPS roads | Owner + implementation support | Valhalla host resources/dataset decision | Pinned provider/graph identity and coverage, real matrix/route checks, memory/disk and latency evidence; required for road-enabled release |
| P2: native target handoff | Owner + implementation support | VPS/Pi access and matching source/settings | Bun/npm/uv timings and startup evidence on both targets, with runtime versions and limitations |

The current release task can finish independently of dashboard work. It proves only its source image, and dashboard runtime changes will need a later image release. This session must not dispatch, invent its digest, or overwrite `release-verification.md` while the other session owns it.

## Launch checklist

- [ ] Dashboard coverage/integration/performance evidence passes [frontend-spec.md](frontend-spec.md).
- [ ] Final candidate verification is recorded with exact source; older green checks are labeled historical.
- [ ] Basemap provider attribution, public-use terms and capacity assumptions are documented (the spec references `docs/basemap.md`, currently missing); inspect the shipped style/provider before launch review.
- [ ] `image.yml` succeeds for the final runtime source on amd64 and arm64; registry manifest/digest confirmed.
- [ ] Owner backs up, pins the tested digest, upgrades and records migrations, health and worker connectivity.
- [ ] Live HTTPS verifies anonymous/pending/admin policy, approved owner sign-in and one synthetic import → run → inspect → export; no live two-account test is added to the previously waived gate.
- [ ] Backup timer/retention and restore/rollback compatibility are confirmed for the upgraded storage release; worker/storage changes rerun relevant recovery evidence.
- [ ] Public copy, capability declarations, handoff and current progress match the deployed features and travel mode.
- [ ] If advertising hosted Valhalla roads, the conditional road gate has VPS evidence; otherwise describe estimated/imported travel and availability explicitly.

## Scope boundaries and operating rules

Preserve completed M1–M5/M7 evidence and solver pins. M2 is accepted design intent, not an excuse to skip current dashboard acceptance. `fillrate.fig`/OpenPencil maintenance is removed from scope. Real sample rows help validate business fit but synthetic acceptance can proceed without them. Monetary optimization remains optional while rates are unavailable; trucks-then-miles remains default. Off-host backup was deferred by the owner and remains an explicit resilience limitation, not a silently added gate. Do not reintroduce the waived second live-account check.

Use isolated task branches/worktrees and reviewed PRs. Keep current progress concise; retain dated evidence in history or new dated records. Update status estimates only with justified implementation movement; this plan does not increase productBehavior. Once a slice starts, use the existing issue queue/project workflow for independently trackable work, with links to its spec and exit evidence. External writes follow the active session authorization rules.
