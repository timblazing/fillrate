# Complete Fillrate and update the live release

Published-image baseline: `e95f3cb`; image release evidence merged in PR #72 at `4caa595` on 2026-10-06. Existing hosted/request access was accepted earlier; current source is ahead of that evidence. This plan replaces stale next-step lists while preserving the technical spec and M1–M8 history. It adds no new solver engine scope.

## Definition of complete and live

The current product is complete when the required frontend specification passes, documented capabilities match working behavior, all applicable correctness/access/browser checks pass on the final candidate, and the handoff accurately describes that candidate. It is live when the tested multi-architecture image is pinned and deployed, migrations/worker health and the primary workflow pass on the VPS, and the exact deployed digest and checks are recorded. Publication alone closes neither deployment nor product completion.

A hosted launch with estimated travel is supported. Road-enabled launch additionally requires VPS Valhalla coverage/provider identity, matrix and geometry checks and recorded resource/timing evidence. Keep road availability truthful until that evidence exists. Native target timings complete the broader M8 handoff but do not block an otherwise verified hosted release. Optional inputs and off-host backups retain their accepted scope below.

## Delivery order and reviewable slices

| Priority / slice | Owner | Dependencies | Exit evidence |
| --- | --- | --- | --- |
| Complete: current image publication | Release session, merged #72 | Green runtime source `e95f3cb` | Run 37482591185 passed both architecture smokes; manifest/digest recorded in release-verification.md; deployment remains separate |
| P1: dashboard coverage audit | Implementation session | Current frontend + accepted gallery Blocks | All six frontend-spec rows have observed gaps/intentional differences, production paths and desktop/phone captures; prioritize workflow defects first |
| P1: dashboard integration | [Issue #88](https://github.com/timblazing/fillrate/issues/88) | Audit findings | Orders/configuration → run/results → explorer/comparison delivered in scoped PRs with real data, functional and visual evidence; shared gallery/product composites where appropriate |
| P1: frontend performance | [Issue #89](https://github.com/timblazing/fillrate/issues/89) | Baseline measurements; integrate alongside UI fixes | Recorded 2,000-order/matrix measurements meet frontend-spec budgets; identified bottlenecks fixed; no fixture output used as product evidence |
| P1: manual accessibility acceptance | [Issue #90](https://github.com/timblazing/fillrate/issues/90) | Automated candidate rerun | Contrast-incomplete cases and representative VoiceOver, gallery and device checks are reviewed and recorded |
| P1: candidate verification | Implementation session | Final integrated dashboard candidate | Lint/typecheck/build, relevant full suites and contracts, hosted/local acceptance, complete applicable browser coverage; capability and docs reconciliation |
| P1: final image and deployment | [Issue #91](https://github.com/timblazing/fillrate/issues/91) | Candidate green; image workflow | Both architecture smokes and published digest; pre-upgrade backup, deploy-by-digest, migration/health/access and live synthetic workflow checks; rollback reference |
| In v1 (owner, 2026-10-07): VPS roads | [Issue #92](https://github.com/timblazing/fillrate/issues/92) | OK + bordering states, prebuilt tiles | Done 2026-10-07: pinned provider/graph identity and coverage, VPS matrix/route checks, memory/disk/latency evidence, app path through Fillrate on the same bundle. Open: owner's signed-in UI check on the live site |
| P2: native target handoff | [Issue #93](https://github.com/timblazing/fillrate/issues/93) | VPS/Pi access and matching source/settings | Bun/npm/uv timings and startup evidence on both targets, with runtime versions and limitations |

The current publication task completed in #72 independently of dashboard work. It proves only its source image; dashboard runtime changes will need a later image release. Preserve the recorded release-verification evidence and do not duplicate the completed dispatch.

## Launch checklist

- [ ] Dashboard coverage/integration/performance evidence passes [frontend-spec.md](frontend-spec.md).
- [ ] Final candidate verification is recorded with exact source; older green checks are labeled historical.
- [x] Basemap v1 decision and specified attribution links are recorded in [basemap.md](basemap.md): owner accepts keyless CARTO risk, and rendered credits were checked in light/dark themes. Key/tier configuration remains a later owner follow-up.
- [ ] `image.yml` succeeds for the final runtime source on amd64 and arm64; registry manifest/digest confirmed.
- [ ] Owner backs up, pins the tested digest, upgrades and records migrations, health and worker connectivity.
- [ ] Live HTTPS verifies anonymous/pending/admin policy, approved owner sign-in and one synthetic import → run → inspect → export; no live two-account test is added to the previously waived gate.
- [ ] Backup timer/retention and restore/rollback compatibility are confirmed for the upgraded storage release; worker/storage changes rerun relevant recovery evidence.
- [ ] Public copy, capability declarations, handoff and current progress match the deployed features and travel mode.
- [ ] Hosted Valhalla roads (in v1, OK + bordering states): VPS service evidence is recorded (docs/valhalla.md); the owner's signed-in UI check and copy that names the coverage remain.

## Scope boundaries and operating rules

Preserve completed M1–M5/M7 evidence and solver pins. M2 is accepted design intent, not an excuse to skip current dashboard acceptance. `fillrate.fig`/OpenPencil maintenance is removed from scope. Real sample rows help validate business fit but synthetic acceptance can proceed without them. Monetary optimization remains optional while rates are unavailable; trucks-then-miles remains default. Off-host backup was deferred by the owner and remains an explicit resilience limitation, not a silently added gate. Do not reintroduce the waived second live-account check.

Use isolated task branches/worktrees and reviewed PRs. Keep current progress concise; retain dated evidence in history or new dated records. Update status estimates only with justified implementation movement; this plan does not increase productBehavior. Once a slice starts, use the existing issue queue/project workflow for independently trackable work, with links to its spec and exit evidence. External writes follow the active session authorization rules.
