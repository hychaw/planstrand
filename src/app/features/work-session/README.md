# WorkSession domain (Phase 1)

The normalized `workSession` slice persists only `id`, `taskId`, `start`, `end`, optional `completedAt`, `created`, and `modified`. Times are finite nonnegative persisted instants; `end` must exceed `start`. Uncompletion persists `completedAt: null`. Completion is an explicit action and never changes its Task.

The service rejects creation/reassignment to missing Tasks. The shared integrity meta-reducer also rejects these operations during replay, including invalid generic LWW replacement. It blocks deletion/archival of a Task with sessions, including subtask and project deletion cascades. Remove the sessions explicitly first. Task/session Trash and restoration relationships are deferred to their implementation phase.

An absent legacy slice defaults to the empty normalized state. A present slice must validate before hydration: unknown fields, malformed entities and dangling Task references fail closed without stripping fields, deleting sessions, reassigning Tasks or inventing values. Existing generic repair may rebuild IDs without modifying entity payloads; unsupported entity data remains invalid. The existing load/replay failure guards preserve prior state and surface failures through the normal validation/recovery and rejected-operation mechanisms.

Snapshots, backup/recovery, operation capture/replay, conflict resolution, and file sync use the normal model/adapter registry. API uploads require advertised `WORK_SESSION` support. Deploy the supporting server before allowing those uploads. No UI or legacy timed-Task conversion is part of this domain scaffold.
