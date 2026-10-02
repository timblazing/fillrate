# Issues and project work

GitHub Issues are Fillrate's queue for actionable follow-up. The GitHub Project is the visual view of that queue. The repository remains the source of truth for product behavior and durable evidence:

- `docs/fillrate-technical-spec.md` defines intended behavior and acceptance criteria.
- `docs/progress.md` records milestone state, verification, known gaps and dependencies.
- `docs/decisions.md` records accepted decisions and their rationale.
- `docs/status.json` supplies estimates displayed on `/dev`.

Issues point to these records and track concrete work; they do not replace or copy the whole roadmap.

`docs/status.json`'s `nextUp` list is a short focus hint for sessions that ask where the project stands and what to work on next. It is not the issue backlog. Do not automatically create an issue for every focus item; create one when the chosen slice has concrete scope and acceptance criteria, or when a blocker/spec gap needs durable follow-up.

## When to open an issue

Open an issue when a bug, spec/documentation gap, decision, or unfinished task needs follow-up beyond the current session. Use the **Spec or documentation gap** template for ambiguity, missing acceptance criteria, incorrect docs, or implementation/spec mismatches. Use **Blocked session handoff** when a real blocker prevents completion and another session or owner action is needed. Do not create an issue for a temporary snag resolved in the same session.

An issue should state the relevant document section, exact next action, and evidence that will close it. Handoffs should also say what is complete, what failed, what was tried, and the task branch/PR. Redact credentials, live user data, and private operational details from public issues.

Link an issue from `docs/progress.md` when it represents a known gap already recorded there. Keep acceptance criteria and technical findings in the canonical docs; add a short issue link next to the relevant gap rather than duplicating its full description. Close issues after the acceptance criteria are met and the implementation PR is merged, or when the owner explicitly drops the work.

## Triage board

Use the [**Fillrate work** GitHub Project](https://github.com/users/timblazing/projects/2) to view repository issues and pull requests. Keep one item per actionable unit and use these status lanes:

| Status | Meaning |
| --- | --- |
| Triage | Needs owner review, clarification, or prioritization. |
| Ready | Clear acceptance criteria and ready to start. |
| In progress | A session is actively working on it. |
| Blocked | Waiting on owner input, a dependency, or an external condition. |
| Done | Merged or otherwise resolved; normally closed. |

Use the **Work type** field (Bug, Spec, Docs, Feature, Handoff) and **Priority** field (High, Normal, Low). GitHub reserves the field name `Type`, so the custom field uses `Work type`. Use the project's existing **Milestone** field for M1–M8 instead of maintaining a second milestone list. Add issues and PRs to the board as needed; don't turn every checklist line or completed evidence item into an issue.

## Session closeout

If a task is finished, update relevant project docs, verify the scoped changes, push the task branch and open its PR. If the task is blocked, first preserve useful work on its task branch, then either update an existing issue or open a handoff issue with a concrete next step. Update `docs/progress.md` for milestone-level changes and link the issue if that gap is part of the published roadmap. Leave the issue open until the work is integrated or explicitly dropped.
