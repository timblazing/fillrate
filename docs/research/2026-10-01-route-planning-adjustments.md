# Research proposal: learn from planner adjustments

Date: 2026-10-01. Author: Codex. Status: proposed, not owner-approved or implemented.

## Recommendation

Add a small planner-review loop to Fillrate before pursuing more optimization variants. The next useful question is whether the primary user would use a suggested shipment plan, and what they would change. Preserve the existing fulfillment pipeline and measure the corrections it needs.

Start with review outcomes and reason capture. Extend the already-planned M6 manual evaluator with revision lineage and a comparison against the original plan. Use recurring reasons to decide whether readiness, service requirements, finite fleet availability, or location corrections deserve more modeling. Defer dispatch integrations and automatic rule learning.

The accepted v1.9 workflow remains the baseline. The accompanying v1.10-proposed spec contains concrete additions for review, not a mandate to implement them. This proposal does not reopen completed milestones or introduce a first-release gate.

## Source and method

Betina Pinto de Moraes, *Route Optimization: Analysis of Operational Adjustments and Improvement Proposals*, FEUP master's dissertation, 2025. The cover dates the manuscript June 27; the university records the defense July 9 and submission July 15.

- [Original PDF](https://repositorio-aberto.up.pt/bitstream/10216/167712/2/732188.pdf)
- [University publication record](https://sigarra.up.pt/feup/en/pub_geral.pub_view?pi_pub_base_id=732188)
- [University thesis record](https://sigarra.up.pt/feup/pt/teses.tese?p_aluno_id=134508&p_lang=1&p_processo=31315)

Read all 61 PDF pages, including the literature review and bibliography. Inspected Figure 4.1 and Table 5.1 visually to check extracted text. Page references below use printed page numbers; add 16 for PDF page numbers. The downloaded PDF has SHA-256 `4f1f6bf9f5826286f6e54edbcc5689df2ebf97a5b3803dcbabc3c936230d51dd`. The source PDF and extracted text are research scratch files, not repository assets.

The empirical study covers Leroy Merlin Portugal's transition to a national distribution center. It follows system suggestions, planner revisions, and dispatch records for 7,923 shipments in March–May 2025. It is an observational implementation study, not a routing algorithm benchmark. Chapter 2's algorithm survey does not establish a reason to switch Fillrate's solver.

## Findings and their limits

| Evidence in the thesis | Interpretation for Fillrate |
| --- | --- |
| Three snapshots: automatic suggestion, revised plan, and dispatch record (§4.2, pp. 24–25). | Preserve distinct plan states and lineage. A solver result alone cannot measure adoption or execution. |
| Warehouse checks and picking can delay the goods assumed available by the planner (§3.1, pp. 15–16; §5.1, pp. 30–35). | Stock allocation and readiness for dispatch are separate facts. Ask whether this distinction matters in the primary user's operation before adding a readiness model. |
| Static carrier, slot, and regional configurations require corrections (§3.2, pp. 18–19). | Record reasons and scope before introducing more policies. Those are limitations of the studied installation, not proven universal OTM limitations. |
| Adjusted suggestions: NCS 58.85%, Lisboa 30.29%; dispatched as suggested: 22.68%, 40.40% (Table 5.1, p. 37). | Intervention rates can reveal a mismatch, but cannot identify its cause or prove a manual revision was better. These percentages are not Fillrate targets. |
| Coimbra delivery location changed to Mealhada on 41 of 60 observed days (§5.2.1, p. 38). | Repeated location corrections are candidates for reviewing canonical destination data, not automatic coordinate replacement. |
| Process stabilization, controlled configuration tests, and weekly feedback are recommendations (§5.3, pp. 38–40). | Pair immutable experiments with planner feedback. The thesis did not experimentally verify that these recommendations reduced changes or costs. |

The observation window is short, operational processes were changing, and data depend on manual records (§4.4, p. 27; §5.3, p. 38; chapter 6, pp. 41–42). The study does not report a controlled intervention, measured savings, or evidence that every edit improves a plan. Its route-change fields focus on delivery location, destination, and carrier; they do not establish a full arbitrary-length stop-sequence or piece-level comparison method.

### Metric ambiguity to avoid copying

Equation 4.2 uses total dispatched shipments as its denominator. The surrounding text sometimes describes the percentage as a share of suggested shipments. Table 5.1's NCS unchanged daily average is 11.15, suggested is 48.69, and dispatched is 52.36. Their ratios are about 22.90% and 21.29%, neither the reported 22.68%. Lisboa gives about 40.19% and 45.93%, neither 40.40%.

Mean daily ratios can differ from ratios of period totals. The raw daily records and aggregation method are unavailable here, so this discrepancy is unresolved; it is not enough to call the table wrong. Fillrate should export numerators, denominators, sample coverage, and aggregation rules. Use summed counts for period rates, with N/A for a zero denominator. Count distinct changed shipments separately from edit events.

## Fit with the existing spec

| Existing behavior or requirement | Gap | Proposed adjustment |
| --- | --- | --- |
| Immutable scenarios, run snapshots, artifact lineage (§5, §9). | No record of whether a planner would use a result. | Add a review record referencing a specific run and, when present, a revision. Keep it separate from solver status. |
| Manual reorder and vehicle assignment, same-matrix evaluation (§10; M6). | No required edit reason, parent-plan lineage, or shipment split/merge mapping. | Extend the manual evaluator with immutable revisions and explicit lineage. |
| Single-day time model includes release times (§5); native capabilities are gated (§3). | Inventory quantity does not establish picking readiness. | Investigate readiness first; enable release constraints only through a tested adapter. |
| Stable locations and coordinate provenance (§5–6). | Recurring destination corrections are not visible as a pattern. | Summarize confirmed repeated changes using stable location IDs and reviewed evidence. |
| Sweeps and compatible comparison cohorts (§8a, §10). | A high-ranked mathematical plan may still need rework. | Keep operational review metrics beside optimization metrics; do not silently change ranking. |
| Exports and synthetic lessons (§13; M7). | No demonstration of an accepted plan versus a corrected plan. | Add a small review lesson and export its reasons, revisions, and validation evidence. |
| Verification and handoff (§16; M8). | No prospective planner-use evidence. | Add an optional owner-approved pilot with complete denominators and paired cases. |

Existing preflight findings describe input or routing problems. Review reasons describe a planner's assessment after a result. A persisted reason is not a solver constraint or proof of a cause. Keep these concepts separate even if they share identifiers.

## Proposed delivery order

### A. Capture feedback before adding constraints

Suggested M7 slice, after the active M5 work and M6 evaluator foundation. A smaller capture-only slice can proceed without manual editing if the owner chooses it.

A review references an immutable run and records `accepted`, `needs_changes`, or `not_usable`, with timestamp and author label. Reviews may be superseded, but prior records remain. Author labels follow existing access rules and do not provide authentication. Unreviewed runs stay unreviewed; they do not count as accepted or rejected.

Use an optional structured reason plus a note. Initial proposed reasons are incorrect destination, goods not ready, vehicle availability, service requirement, grouping preference, data correction, and other. A needs-changes or not-usable outcome requires a reason or note. Store scope as run, shipment, visit, or line IDs, rather than a map selection or route index. Missing supported constraints should be identifiable from the note. Keep the taxonomy editable through versioned contracts when evidence supports new categories.

Exit evidence: review persistence survives refresh; superseding preserves history; invalid/partial plans can be reviewed without becoming valid; operator-protected data stay protected; JSON export includes review schema and provenance.

### B. Extend the M6 manual evaluator

The original solver plan remains immutable. A manual revision references its parent, stores edit events, reasons and piece/visit membership, and records validation against the original normalized problem and raw travel artifacts. Proposed supported edits start with visit reordering and reassignment. Split/merge edits require explicit lineage before they are exposed.

Do not infer shipment identity from generated route numbers. Match unchanged shipments by their ordered stable visit membership and assigned vehicle semantics. Splits and merges have many-to-many parent links; membership quantities conserve pieces. Unknown lineage is an explicit unmatched record, not a cancellation or a new shipment by guesswork.

A review-only plan may remain invalid and inspectable. Count planned pieces and revenue only from independently validated shipments. A changed coordinate, stock snapshot, eligibility rule, demand quantity, or effective fleet constraint creates a new scenario/run branch. Compare it as a changed assumption rather than a same-problem manual improvement. Route-order changes alone retain the original matrices and problem fingerprint.

Exit evidence: unchanged, reordered, reassigned, split, merged, and invalid revision examples preserve lineage and quantities. A claimed same-problem improvement has the same fingerprint. Changed assumptions cannot enter that comparison by accident.

### C. Add a review lesson and a short pilot

Use a synthetic fixture with one wrong destination, one invalid overload edit, and one valid reorder. Demonstrate which correction changes the problem and which can be evaluated on the same problem. Export enough data to inspect the original, edits, reasons, and validation without live SaaS calls.

For an owner-approved pilot, ask the primary user for sanitized cases spanning ordinary and difficult days, their actual planning cutoff, and what makes a shipment usable. For each case, freeze the source version, eligibility/allocation policy, matrices, fleet assumptions, seed, and budget. Save the initial plan and review before trying a parameter change. Record planning time only if the user measures it; missing time is N/A.

Each proposed rule change needs a hypothesis, a relevant set of cases, one declared changed assumption, saved before/after results, and a rollback. Replay both configurations on the same case inputs with equal budgets and independent replicates where needed. Review later cases as a check against fitting one incident. Describe results as observed associations unless the design supports a causal claim.

Do not set an adoption percentage from this paper. Record the primary user's acceptance criteria before assessing a change. A useful change reduces relevant rework while preserving validation, accounting, and acceptable fulfillment/truck/mileage outcomes. A case where the planner disagrees is evidence to inspect, not a failed user.

### D. Model only confirmed recurring needs

Readiness is the first hypothesis to investigate. If confirmed, record dispatch-ready pieces separately from on-hand stock, at line level with source and as-of time. Preserve whole-order semantics and avoid treating not-ready pieces as stock shortages. Unknown readiness remains unknown. A future explicit eligibility policy can select ready pieces before allocation; waiting within the planning horizon requires tested release-time support. Any readiness policy or snapshot enters stage identities and comparison signatures.

Repeated destination corrections should lead to a reviewed scenario edit, preserving original address and coordinate provenance. Do not infer aliases from proximity alone or apply one customer's change to every customer at the same address.

Finite fleet, day-specific receiving slots, and regional preferences should follow capability tests and user evidence. The thesis's pallet model, 100 km grouping rule, and carrier contracts do not justify changing Fillrate's 53 ft trailers, linear-foot capacity, per-leg 500-mile rule, or customer-aware aggregation.

## Metric contract proposed for implementation

All rates use a declared case set and latest review as of an export cutoff. Include totals and missing/unmatched counts. A revision comparison declares which fields count as a material change; administrative labels and generated route numbers do not.

| Metric | Definition | Availability |
| --- | --- | --- |
| Review coverage | Reviewed eligible runs / all eligible completed runs in the case set. | Capture-only slice. Report separately from acceptance. |
| Accepted unchanged | Latest reviews marked accepted with no material revision / reviewed eligible runs. | Capture-only slice; planner judgment, not execution evidence. |
| Suggestions materially revised | Distinct original shipments with a material planner edit / original suggested shipments in reviewed cases. | Revision slice. Split/merge parents count once; multiple edits do not inflate the numerator. |
| Suggestions removed | Original shipments with confirmed removal and no successor lineage / original suggested shipments in reviewed cases. | Revision slice. A split or merge is not removal. |
| Planner-created shipments | Revision shipments explicitly created without suggestion lineage, as a count. | Revision slice. If a share is shown, denominator is all revision shipments. |
| Rework time | Measured active review/edit time per reviewed case, with timed-case count and median/range. | Optional measurement; never derive it from elapsed wall time. |
| Repeated correction | Cases with the same scoped correction / reviewed cases where that scope was present. | Enough reviewed cases; report numerator and opportunity count. |
| Executed unchanged | Observed execution shipments matching a suggestion under declared fields / all observed executed shipments in the case set. | Deferred execution import. Unknown lineage is unmatched; no dispatch data means N/A. |

Review outcomes never enter the current Best option order automatically. Operational acceptability and mathematical quality can disagree. Show both and let the owner decide whether a new explicit selection policy is needed.

## Changes to review and owner questions

The spec diff adds proposal subsections in §5, §10, §13, §15 and §16, and a primary-reference note in §19. It fixes two documentation inconsistencies: the overview described only M1 foundations despite completed pipeline work, and §11/§3 still presented cluster diameter as an enabled default despite the accepted v1.8 policy. The progress target version is corrected from v1.8 to accepted v1.9, with this draft tracked separately.

Questions for the next planning discussion:

1. Does the friend plan from all on-hand stock, allocated stock, or only picked/dispatch-ready pieces?
2. What changes does he usually make to a proposed shipment, and why?
3. Would a review with a reason be useful before manual plan editing exists?
4. Can he supply sanitized before/after cases and time his review? Execution records are optional and belong to a later scope.

These questions do not block this research proposal. They determine which additions deserve implementation. M5/M6 work and current release checks continue under the accepted spec.
