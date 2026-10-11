# Scoped production recovery workflow comparison

**RC1 contract update, October 11:** the supported-data tail-recovery gate below
is superseded by the explicitly narrowed [final RC1 requirement](routines-rc1-final-readiness.md).
Verified complete backup/snapshot restoration is required; universal encrypted
tail replay is not promised. The unsupported vocabulary below remains current
and refused. No recovery safety guard or operation admission changes with this decision.

Starting revision: `751af9172690d7cd73373ffaeddc989136a7ae6b` on
`feature/v1.2-routines`. This comparison covers current persistent producers and
the operator admission boundary; it does not reinterpret historical formats.

The requested Task scheduling, rescheduling, unscheduling, conversion to/from
subtasks, and ordinary Project creation/update are now admitted through the
existing production browser replay host. Source calendar/mutation values use
the existing authenticated Task replay context and capability fence. Whole-window
batch/LWW handling, asynchronous archives and persisted-state export stay shared
with production. No separate recovery reducer or clock inference was added.

Actual production capture exposed two necessary follow-up formats: Project
creation emits `[MenuTree] Update Project Tree`; Today-preserving unscheduling
emits `[Tag] Update Tag`. Both use their existing feature reducers in recovery.

The mixed snapshot boundary exposed two additional defects fixed in this change:
the durable `TASK_REPLAY_CONTEXT_V1` floor on a full-state operation was being
mistaken for a single Task's context, and legacy conversion/unscheduling defaults
could override versioned source values. Unmarked historical operations retain
their existing synchronization behavior and remain refused by operator recovery.

## Remaining reachable unsupported vocabulary

The once-only pre-edit comparison found these current persistent producer groups
outside admission. They remain outside this narrowly authorized implementation:

- Task creation with scheduling/deadline fields; subtask creation/movement;
  restore-deleted, project movement, deadline/reminder/Today-list/Tag actions,
  short syntax, repeat-configuration changes, attachment and Task-time actions.
- Project advanced configuration, ordering, archive/complete/reopen, deletion
  and list movement actions, beyond ordinary Add/Update Project.
- Tag creation/deletion/order/advanced configuration; Tag-tree/menu-folder changes.
- Global configuration, Notes, Sections, Boards, Planner actions outside Planning
  register placement, Metrics, SimpleCounters, issue-provider changes, repeat
  configurations, time tracking, plugin metadata/user data and reminders.
- WorkSession LWW compensation and Task compensation for an already archived
  snapshot winner remain explicitly refused. Unknown/multi-entity formats,
  ambiguous legacy context and markerless REPAIR remain fail-closed.

Representative current producer definitions are `TaskSharedActions`,
`features/tasks/store/task.actions.ts`, `features/project/store/project.actions.ts`,
`features/config/store/global-config.actions.ts` and the other persistent action
groups. These are reachable production operations; they cannot be presented as
exclusively historical limitations. No newly required architectural extraction
was encountered for the requested families. The broader supported-data recovery
release gate remains **NO-GO** until remaining coverage is addressed or the
release recovery contract is explicitly narrowed.

## Focused evidence

`e2e/recovery-production-workflows.cjs source` generates the committed fixture
from actual application services/action creators and normal operation capture.
It records 20 operations and 10 complete persisted checkpoints, including a
WorkSession linked to the converted Task and a second snapshot plus mixed tail.
Each encrypted CLI result matched the entire source snapshot and capability
requirements. The mixed recovered backup passed browser import/export and two
full Chrome process launches of the same profile in another timezone. Its
browser clock stayed on the source logical day to exclude ordinary next-day
Today-order cleanup; Windows time/security settings were unchanged.

The new encrypted integration spec exercises complete checkpoint hashes and
seven refusal histories. Four new browser unit regressions cover context
transport, legacy fallback precedence, capability stripping and full-state floor
retention. Existing passing architecture, sync, migration and native matrices
were not repeated. Local diagnostics and recovered synthetic exports are under
ignored `.tmp/recovery-production-gaps`; they are not user backups.
