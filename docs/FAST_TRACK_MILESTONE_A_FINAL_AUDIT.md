# Fast-Track V1 Milestone A — final audit

Date: 2026-10-04. **Verdict: Milestone A ready for merge.**

Branch: `feature/fast-track-milestone-a`. Development was clean and matched
`origin/development` at the requested base
`c94f3c8823e776d7ff47437945e71d779a0b8f26`; the final merge base remains that SHA.
The normal final workflows tested runtime/test checkpoint
`f4bae3967c2c2f870c8e4fb3a0d1f5fb49784e5e`. Fixture-only checkpoint
`46c9b34f5b99c51402e1ac89e21076602a74e0d1` corrects one remaining plugin URL
assertion and was verified against that exact CI build. This audit adds documentation
only. The branch is pushed; development is not merged.

## Delivered behavior

| Surface           | Behavior                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigation        | `/inbox`, `/master-tasks`, `/folder/:id`, `/today`, `/this-week`, and existing `/schedule`. Folder tree in the sidebar; Today/This Week in mobile navigation. One Schedule entry retains its feature toggle. Legacy Tasks/Capture, Projects, Tags, Boards, Planner, and existing routes remain accessible. Configured startup routing is preserved. |
| Master Tasks      | Inbox first, recursive Folders including empty Folders, existing Task rows and subtask trees. Iterative adjacency traversal, shared Folder-path index, and grouped Task ownership avoid repeated whole-tree scans per Task.                                                                                                                         |
| Folders           | Create, rename, reparent, reorder, and domain-rule leaf deletion. Cycle validation and immutable Inbox rules are retained. Collapse state uses device-local storage, separate from Folder persistence.                                                                                                                                              |
| Task organization | Folder Add Task and the shared add-task bar use canonical `folderId` through existing creation behavior. Destination picker and basic Task-list drops issue one Task mutation; subtasks follow the top-level owner. Folder headings support reparent drops and root placement; buttons provide alternatives.                                        |
| Inbox             | Effective ownership uses existing Folder helpers. Explicit Inbox, deleted/missing references, and legacy fallback Tasks resolve to Inbox. Folder deletion preserves Tasks.                                                                                                                                                                          |
| Search            | Existing engine and Task-opening behavior retained; results show effective ancestor Folder paths, including Inbox fallback.                                                                                                                                                                                                                         |
| This Week         | Current localized week, week-level placement, seven day sections, deterministic Planning order, day movement, reorder, and unplan through existing Planning commands. Unplanned capture remains accessible.                                                                                                                                         |
| Today             | Membership comes from canonical day Planning. Planning remains independent of due fields, compatibility tags, and timed scheduling. Inbox and unplanned capture remain accessible.                                                                                                                                                                  |
| WorkSessions      | Existing Calendar/Schedule and Task scheduling dialog reused. Timed scheduling retains WorkSession commands; removing Planning preserves the timed session.                                                                                                                                                                                         |

Major areas: `pages/planstrand`, Folder tree/route utilities, app routes,
sidebar/mobile navigation, shared add-task bar, search, public Planning command
forwarding, translations, targeted tests/fixtures, implementation plan, and V1 guide.
Task rendering, inspector, scheduling, archive, sync, and domain persistence are reused.
No dependency, schema, sync entity, conflict algorithm, or persistent Folder UI field
was introduced.

## Local validation

- Combined targeted milestone suite: **242 passed**, covering Folder state/tree,
  effective Task ownership, creation/movement, Planning, Today/week commands,
  search, navigation, capture, WorkSessions, and schedule dialog/selectors.
- **19 distinct focused browser tests passed** across the final focused checks,
  including all three milestone flows, affected navigation/migration/legacy DnD,
  desktop subtask blur, Schedule views, History access, and both plugin lifecycle tests.
- Development build, all changed TS/SCSS `checkFile` checks, and `git diff --check` passed.
- The host exposes no usable system IANA timezone to Chrome. Local browser checks
  use explicit `Asia/Singapore`, aligned with Node where date assertions require it.
  WorkSession timezone validation was preserved. HMR-interrupted checks were rerun
  after edits settled. An additional legacy Today context-menu diagnostic reproduced
  its known development assertion failure; it is not counted as a passing check.

## Final GitHub Actions and baseline classification

[Final CI](https://github.com/hychaw/planstrand/actions/runs/37168598721) and
[normal final E2E](https://github.com/hychaw/planstrand/actions/runs/37168602263)
are complete. Their overall status is failure, classified below.
The known [development baseline](https://github.com/hychaw/planstrand/actions/runs/37153757477)
at `625fc45c3550ded2e73b8cc7d9fbbe6b0bfbe0b9` used the same normal provider inputs;
Phase 4's final audit records its evidence. Comparisons normalize source line offsets
and retain complete test titles, rather than comparing only totals.

| Job                                         | Final result                                  | Classification                                                                                                                                                                                                                                                       |
| ------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend build; production build/Lighthouse | Passed                                        | Clean runtime build evidence.                                                                                                                                                                                                                                        |
| Server unit tests                           | 1,391 passed; 48 existing skips               | Same baseline counts.                                                                                                                                                                                                                                                |
| Six SuperSync shards                        | 326 passed; 0 failed; 14 existing skips       | All six passed, matching baseline. Corrected cascade-delete setup now completes all assertions.                                                                                                                                                                      |
| Regular E2E                                 | 405 passed; 22 failed; 2 existing skips       | 21 failure identities are in development's 24. One plugin re-enable test expected the old Today URL; corrected at `46c9b34f5` and the complete two-test plugin lifecycle passed against the downloaded final CI artifact. All three milestone tests passed remotely. |
| WebDAV v2                                   | 39 passed; 22 failed; 11 not run              | Exact baseline failure identities and counts.                                                                                                                                                                                                                        |
| Released clients                            | 3 failures plus 2 upgrade failures; 8 not run | Exact five baseline failure identities.                                                                                                                                                                                                                              |
| CI Lint/tooling                             | Failed                                        | Same two historical ENOENT tests for absent `build-create-windows-store-on-release.yml` and `build.yml`; no new lint errors.                                                                                                                                         |
| CI Tests                                    | Skipped after Lint failed                     | Existing CI evidence gap; local targeted suite is reported separately.                                                                                                                                                                                               |

There are **no remaining newly introduced product regressions or unresolved new
test assertions**. Three baseline-only regular failures passed in this run; those
passes are not attributed to milestone fixes. Historical failures were not chased.
The final plugin correction changes a test expectation only; broad workflows were
not repeated for that one-line correction after complete focused verification on
the CI runtime. The last normal workflow is not claimed fully green or to have
tested that subsequent fixture-only commit.

The first checkpoint exposed duplicate navigation selectors and background clicks
landing on Create Folder. Those were corrected without weakening behavior assertions.
The full repeat followed runtime/navigation fixes. An intervening fixture-only run
was cancelled when the remaining navigation results arrived, avoiding a superseded
validation run. Workflow definitions and skips were unchanged.

## Intentionally deferred

Branding, animation, exhaustive responsive polish, complex drag geometry,
inline WorkSession summaries in Today/This Week, and harmonizing legacy header,
Task chips, and creation feedback with Folder wording remain shipping polish.
Advanced old Phases 8–12 work is post-V1. Standalone Events have not begun.
See the updated implementation plan and `wiki/3.10-Planstrand-V1.md` for the
Fast-Track strategy and user-facing guide.
