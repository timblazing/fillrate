# Owner actions and inputs

This is the consolidated owner list. Implementation sessions own code, local verification and reviewable delivery artifacts. Owner-only access or business input must not be confused with unfinished implementation.

| Action | When needed | What to provide or record | Gate |
| --- | --- | --- | --- |
| Deploy tested image on VPS | After the release session records a published digest; repeat for final dashboard release | Backup/checksum, pinned digest, migration/health/worker checks, synthetic primary workflow and rollback reference in release verification | Required for the corresponding source to be called live |
| Review dashboard workflow | After coverage audit/integration produces real-screen evidence | Confirm business fit; explicitly decide meaningful departures from the accepted Blocks | Required if product behavior/design intent changes; routine implementation can proceed |
| Choose/prepare VPS Valhalla coverage | Before advertising hosted road support | Required states/region, host disk/RAM budget, pinned dataset/provider identity, coverage and matrix/geometry timings | Conditional road-enabled release gate; estimated-travel hosted use can proceed |
| Run native timings on VPS and Pi 5 | To close broader native M8 handoff | Exact source/runtime versions, install/start/run commands, comparable settings, timing evidence | Full native target evidence, not a hosted launch blocker |
| Supply anonymized order/inventory sample | When available | Representative columns, partial/oversize orders, shortages and expected planning interpretation; no customer identifiers needed | Business-fit follow-up; synthetic completion does not wait |
| Supply cost per truck and per mile | Only when monetary objective is wanted | Rates and units, confirm scenario applicability | Optional; N/A was accepted, trucks-then-miles stays default |
| Choose off-host backup destination | When stronger recovery is desired | Destination, retention/access policy and restore evidence | Deferred by prior owner decision; current on-server backups do not survive host/disk loss |

The owner has already completed hosted GitHub configuration and approved admin sign-in. Automated cross-user isolation remains required; a second live GitHub account was explicitly waived. No OpenPencil or `fillrate.fig` action remains. The active image-release session owns publication and its evidence PR; deployment is a separate action after that evidence exists.
