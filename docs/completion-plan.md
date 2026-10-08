# Complete Fillrate and update the live release

Published and deployed baseline: `698fbd8`, image workflow 37680183468; digest and rollback evidence are in [the release record](releases/upgrade-698fbd8.md). Owner signed-in synthetic and road checks passed in #99; current source is ahead of that deployed image. This plan replaces stale next-step lists while preserving the technical spec and M1–M8 history. It adds no new solver engine scope.

Latest published candidate: `f855f65` (#100), tested image workflow 37710953655; `sha-f855f65` and `latest` share index `sha256:ad857042103b2959326be3eccdc08f4f16f3bc5f0a4a529b2be0ce2b859db59e`. It has not been deployed. The deployed baseline above remains authoritative for live behavior.

## Definition of complete and live

The current product is complete when the required frontend specification passes, documented capabilities match working behavior, all applicable correctness/access/browser checks pass on the final candidate, and the handoff accurately describes that candidate. It is live when the tested multi-architecture image is pinned and deployed, migrations/worker health and the primary workflow pass on the VPS, and the exact deployed digest and checks are recorded. Publication alone closes neither deployment nor product completion.

Hosted v1 uses Valhalla roads in OK and bordering states. Issue #98 automates matrices, blocks stops outside coverage, draws road shapes by default and fixes export labels. Local installs without Valhalla and Learn retain estimated travel. Road-enabled launch requires VPS Valhalla coverage/provider identity, matrix and geometry checks and recorded resource/timing evidence. Keep road availability truthful until that evidence exists. Native target timings complete the broader M8 handoff but do not block an otherwise verified hosted release. Optional inputs and off-host backups retain their accepted scope below.

## Current focus

Dashboard fixes and expanded audit evidence are in #100. Deliver #98 hosted road automation, close the remaining targeted #88 states alongside it, then close #89 representative performance acceptance. Publish the integrated candidate and verify its deployment. #93 native VPS timings remain optional handoff evidence. Manual accessibility/VoiceOver, physical-device testing, Raspberry Pi, design-file maintenance and new solver scope are excluded from the v1 demo.

## Delivery order and reviewable slices

| Priority / slice | Owner | Dependencies | Exit evidence |
| --- | --- | --- | --- |
| Complete: first image publication | Release session, merged #72 | Green runtime source `e95f3cb` | Run 37482591185 passed both architecture smokes; manifest/digest recorded in release-verification.md |
| P1: dashboard coverage audit | Implementation session | Current frontend + accepted gallery Blocks | All six frontend-spec rows have observed gaps/intentional differences, production paths and desktop/phone captures; prioritize workflow defects first |
| P1: dashboard integration | [Issue #88](https://github.com/timblazing/fillrate/issues/88) | Audit findings | Orders/configuration → run/results → explorer/comparison delivered in scoped PRs with real data, functional and visual evidence; shared gallery/product composites where appropriate |
| P1: hosted road workflow | [Issue #98](https://github.com/timblazing/fillrate/issues/98) | Integrated dashboard workbench | Automatic exact matrix reuse/build, named coverage blocks, cached road geometry by default, truthful CSV/GeoJSON exports; local/Learn estimated travel retained |
| P1: frontend performance | [Issue #89](https://github.com/timblazing/fillrate/issues/89) | Baseline measurements; integrate alongside UI fixes | Recorded 2,000-order/matrix measurements meet frontend-spec budgets; identified bottlenecks fixed; no fixture output used as product evidence |
| P1: candidate verification | Implementation session | Final integrated dashboard candidate | Lint/typecheck/build, relevant full suites and contracts, hosted/local acceptance, complete applicable browser coverage; capability and docs reconciliation |
| P1: final image and deployment | Release session (historical owner check #91 is closed) | Candidate green; image workflow | Both architecture smokes and published digest; pre-upgrade backup, deploy-by-digest, migration/health/access and live synthetic workflow checks; rollback reference |
| In v1 (owner, 2026-10-07): VPS roads | [Issue #92](https://github.com/timblazing/fillrate/issues/92) | OK + bordering states, prebuilt tiles | Done 2026-10-07: pinned provider/graph identity and coverage, VPS matrix/route checks, memory/disk/latency evidence, app path through Fillrate on the same bundle. Owner's signed-in UI check passed 2026-10-07 |
| P2: native target handoff | [Issue #93](https://github.com/timblazing/fillrate/issues/93) | VPS access and matching source/settings | Bun/npm/uv timings and startup evidence on the VPS, with runtime versions and limitations |

Historical publications and the deployed 698fbd8 baseline prove their recorded sources. Integrated dashboard runtime changes require a new tested image release; record it separately from deployment.

## Launch checklist

- [ ] Dashboard coverage/integration/performance evidence passes [frontend-spec.md](frontend-spec.md).
- [ ] Final candidate verification is recorded with exact source; older green checks are labeled historical.
- [x] Basemap v1 decision and specified attribution links are recorded in [basemap.md](basemap.md): owner accepts keyless CARTO risk, and rendered credits were checked in light/dark themes. Key/tier configuration remains a later owner follow-up.
- [x] `image.yml` for deployed baseline `698fbd8` passed on amd64 and arm64; registry manifest/digest confirmed.
- [x] Owner backup, digest pin and VPS upgrade for `698fbd8`; 12 migrations, database integrity, health, worker connection and backup timer verified. See [release record](releases/upgrade-698fbd8.md).
- [x] Live anonymous hosted/request behavior and anonymous admin denial checked after deployment.
- [x] Owner verified signed-in behavior and synthetic import → run → inspect → export on deployed `698fbd8` (#99); no live two-account test is added to the previously waived gate.
- [ ] Backup timer/retention and restore/rollback compatibility are confirmed for the upgraded storage release; worker/storage changes rerun relevant recovery evidence.
- [ ] Public copy, capability declarations, handoff and current progress match the deployed features and travel mode.
- [x] Hosted Valhalla roads (in v1, OK + bordering states): VPS service evidence is recorded (docs/valhalla.md), and the owner's signed-in UI check passed on 2026-10-07. Default road travel/geometry follows in #98.

## Scope boundaries and operating rules

Preserve completed M1–M5/M7 evidence and solver pins. M2 is accepted design intent, not an excuse to skip current dashboard acceptance. `fillrate.fig`/OpenPencil maintenance is removed from scope. Real sample rows help validate business fit but synthetic acceptance can proceed without them. Monetary optimization remains optional while rates are unavailable; trucks-then-miles remains default. Off-host backup was deferred by the owner and remains an explicit resilience limitation, not a silently added gate. Do not reintroduce the waived second live-account check.

Use isolated task branches/worktrees and reviewed PRs. Keep current progress concise; retain dated evidence in history or new dated records. Update status estimates only with justified implementation movement; this plan does not increase productBehavior. Once a slice starts, use the existing issue queue/project workflow for independently trackable work, with links to its spec and exit evidence. External writes follow the active session authorization rules.
