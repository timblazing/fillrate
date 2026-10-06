# Fillrate documentation

Start with the [completion plan](completion-plan.md) to choose the next task. Fillrate already has an accepted hosted release; this plan finishes the current product and updates that deployment. A published image, a live deployment and a complete product have separate evidence.

| Record | Authority |
| --- | --- |
| [Technical specification](fillrate-technical-spec.md) | Product rules, architecture, model contracts, stable M1–M8 milestones and correctness criteria |
| [Frontend specification](frontend-spec.md) | Required dashboard composition, design-system integration, usability and performance acceptance |
| [Completion plan](completion-plan.md) | Remaining delivery order, dependencies and definition of complete/live |
| [Progress](progress.md) | Current implementation and verification evidence, known gaps |
| [Owner actions](owner-actions.md) | Deployment actions, business inputs and optional operational work |
| [Decisions](decisions.md) | Dated accepted choices; later decisions supersede earlier ones |
| [Status estimates](status.json) | `/dev` estimates, not release certification |
| [Release verification](release-verification.md) | Exact image, target hardware, deployed release and recovery evidence |
| [Handoff](handoff.md) | Setup, commands and operations links |

Supporting implementation references: [durable jobs](durable-foundation.md), [road matrices](m6-road-matrices.md), [Valhalla](valhalla.md), [route geometry](route-geometry.md), [warm starts](m6-warm-starts.md), [Solver Lab](solver-lab.md), [browser acceptance](browser-smoke.md), [hosted operations](hosted-operations.md), [local distribution](local.md), and [issue workflow](issues-and-work.md).

Current M8 evidence: [dashboard coverage audit](reviews/m8-dashboard-coverage-audit-2026-10-06.md) and [frontend performance baseline](reviews/m8-frontend-performance-baseline-2026-10-06.md), with paired captures under `reviews/assets/m8-dashboard-audit/`.

Older revision notes and the pre-rewrite progress snapshot are in [history](history/). They preserve evidence, not the current task queue. Design review answers remain in `reviews/`. `fillrate.fig` and OpenPencil are historical assets with no remaining completion requirement.
