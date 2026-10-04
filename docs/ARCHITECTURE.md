# Planstrand Architecture Guide

## 1. Purpose

This document defines the technical direction for Planstrand.

It complements `docs/PRODUCT_SPEC.md` and should be read before making architectural changes.

Planstrand is derived from Super Productivity. The goal is to evolve the existing application rather than rewrite the codebase without a clear technical need.

---

## 2. Architectural Principles

1. **Preserve proven upstream foundations.**
   Reuse existing task, persistence, synchronization, platform, testing, and build infrastructure wherever practical.

2. **Prefer incremental migration over rewrites.**
   New Planstrand concepts should be introduced behind well-defined interfaces and adapted into existing systems.

3. **Local-first by default.**
   User interaction must not depend on a network round trip.

4. **Offline must be a first-class state.**
   Tasks, folders, planning, calendar interaction, and edits should remain usable offline.

5. **One logical task, many planning representations.**
   Master, This Week, Today, and Calendar must reference the same task rather than duplicate it.

6. **Work sessions are separate entities.**
   A work session schedules time for a task but does not redefine or complete the task.

7. **Sync must not own UI responsiveness.**
   Local state updates first; synchronization follows asynchronously.

8. **Privacy by design.**
   Personal sync payloads should be end-to-end encrypted before leaving the device.

9. **Public-repository safe.**
   No runtime secrets, private user data, or production credentials belong in Git.

10. **Cross-platform behavior should share domain logic.**
    Platform-specific wrappers should be kept thin.

---

## 3. Upstream Foundation

The current upstream project provides:

- Angular-based frontend builds,
- TypeScript,
- Electron desktop packaging,
- web/PWA builds,
- multi-platform application support,
- SuperSync,
- WebDAV/Dropbox sync support,
- Playwright end-to-end tests,
- task planning/timeboxing functionality,
- calendar integrations,
- local persistence,
- a package-based monorepo structure.

Planstrand should initially retain this stack.

A framework rewrite is explicitly not part of V1.

---

## 4. Repository Remotes

Recommended local remotes:

```text
origin
  → https://github.com/hychaw/planstrand.git

upstream
  → https://github.com/super-productivity/super-productivity.git
```

`origin` is the Planstrand project.

`upstream` is used only to inspect and selectively integrate useful fixes and changes from Super Productivity.

---

## 5. Branch Strategy

### master

Retained historical branch; not the default branch or an automatic publishing source.

### development

Default GitHub branch and integrated development branch.

Features are merged here after verification.

### feature branches

Use focused branches for significant work, for example:

```text
feature/task-hierarchy
feature/weekly-planning
feature/work-sessions
feature/calendar-redesign
feature/account-settings
```

Small documentation or maintenance changes may be committed directly to `development` when appropriate.

---

## 6. Commit Style

Commit messages should describe the software change directly.

Examples:

```text
Add recursive task folder model
Implement weekly planning view
Add work session scheduling
Refine mobile task inspector
Fix calendar session resizing
```

Keep commits focused and reviewable.

Avoid embedding secrets, generated personal data, or machine-specific paths in commits.

---

## 7. Domain Model

Planstrand should converge on the following domain concepts.

### Task

Persistent unit of work.

Important properties:

- id
- title
- completed
- parent folder reference
- priority
- due date/time
- planned week
- planned day
- optional estimate
- notes
- tags
- recurrence
- reminders
- created/modified timestamps

A Task does not contain one authoritative scheduled start/end time.

### Folder

Recursive organizational node.

A Folder may contain:

- Tasks
- Folders

The hierarchy should support arbitrary practical depth.

Folder identity must remain stable when reordered or moved.

### WorkSession

A scheduled block associated with one Task.

Suggested conceptual fields:

- id
- taskId
- start
- end
- completion state
- optional reminder overrides
- optional notes
- created/modified timestamps

Multiple WorkSessions may reference the same Task.

### Event

Calendar item independent from Task.

Suggested conceptual fields:

- id
- title
- start
- end
- recurrence
- reminders
- source
- external reference if applicable

### WeeklyTemplate

Reusable recurring baseline schedule.

Suggested conceptual fields:

- id
- title
- active date range
- weekly recurrence rules
- reminder rules
- exceptions

### Planning Membership

The app must distinguish:

- task exists,
- task is planned this week,
- task is planned today,
- task has scheduled work sessions.

These are independent dimensions where possible.

---

## 8. Identity and Referential Integrity

All major domain objects must use stable identifiers.

Moving a Task between folders must not create a new Task.

Planning a Task for a week/day must not create a new Task.

Creating a WorkSession must reference the existing Task by ID.

Completing or editing a Task should propagate consistently wherever that Task is shown.

---

## 9. State Management

Retain the upstream state-management approach unless a concrete limitation requires change.

New Planstrand features should:

- use normalized entities where practical,
- avoid storing duplicated derived state,
- derive view-specific collections from canonical entities,
- keep selectors pure,
- isolate persistence transformations,
- make migrations explicit.

Examples of derived state:

- tasks visible in This Week,
- tasks visible Today,
- overdue tasks,
- scheduled sessions for a day,
- hierarchy search results.

---

## 10. Persistence

### Local-first requirement

Every edit should be persisted locally before synchronization is required.

### Storage rules

Do not represent each task as a normal operating-system file.

Use the application’s local database/storage layer.

### Schema migrations

Any data-model change must include:

- migration strategy,
- backward-compatibility consideration,
- test coverage for migrated data,
- rollback/recovery consideration where practical.

Never silently discard existing upstream user data during a migration.

---

## 11. Synchronization

Planstrand should preserve an operation-friendly synchronization model.

### Required behavior

1. Apply user action locally.
2. Persist local result.
3. Queue synchronization operation.
4. Synchronize when connectivity permits.
5. Merge remote changes deterministically.
6. Update local state without blocking the user.

### Conflict goals

Prefer field-level or operation-level merges when safe.

For same-field conflicts:

- use deterministic resolution,
- preserve sufficient history for recovery when practical.

Destructive ambiguity should surface as a recoverable sync issue instead of silently discarding meaningful work.

---

## 12. Encryption

Personal content intended for cloud synchronization should be encrypted on-device before upload.

The sync server must not need plaintext task/calendar content for normal operation.

Encryption keys must not be committed to Git or stored in source-controlled configuration.

Recovery mechanisms should be designed separately from server-side decryption.

---

## 13. Authentication

Preferred authentication methods:

- passkeys,
- email magic links.

Account authentication and encryption key management are related but separate concerns.

Signing into an account must not automatically imply that the server can decrypt personal content.

---

## 14. External Calendar Integrations

External calendar providers are adapters, not Planstrand’s canonical data store.

Each imported item should retain:

- source provider,
- source calendar,
- external identifier,
- read/write capabilities,
- synchronization state.

Do not automatically export private work sessions.

Export behavior must be user-controlled.

---

## 15. Calendar Architecture

The calendar layer should render multiple item types through a shared presentation model.

Suggested normalized calendar render item:

```text
CalendarDisplayItem
- id
- kind
  - event
  - taskSession
  - deadline
  - weeklyTemplateOccurrence
  - externalEvent
- start/end when applicable
- allDay/deadline semantics
- source
- editable capabilities
- visual category metadata
```

This prevents each view from independently reconstructing scheduling semantics.

Year, Month, Week, and Day should consume the same normalized calendar data source.

---

## 16. Recurrence

Recurring series and individual occurrences must be distinguishable.

Editing an occurrence should support:

- this occurrence,
- this and future occurrences,
- entire series.

Exceptions should be stored explicitly rather than rewriting a long series of individual events.

---

## 17. Notifications

Notification scheduling should be represented in domain state, while delivery is platform-specific.

Shared domain logic decides:

- what should be reminded,
- when,
- whether it repeats.

Platform adapters decide how to deliver notifications on:

- web/PWA,
- desktop,
- mobile/native wrappers.

---

## 18. UI Architecture

### Desktop

Support multi-pane workflows without coupling domain data to pane state.

### Mobile

Use dedicated responsive compositions.

Do not depend on desktop-only hover interactions for required actions.

### Inspector pattern

Task/event editing should share one logical editor model while rendering as:

- side inspector on desktop,
- sheet/full-screen editor on mobile.

---

## 19. Navigation State

Navigation should retain appropriate transient UI state:

- selected calendar date,
- calendar view,
- task-list scroll position,
- expanded folders,
- active filters,
- week selection.

Transient UI state should not be confused with synchronized domain state unless there is clear user value in syncing it.

---

## 20. Search

Search should index user-visible task metadata without flattening the underlying hierarchy.

A hierarchy-aware result should include required ancestor nodes so the result remains understandable in context.

---

## 21. Backup Architecture

Sync and backup are separate systems.

Backup snapshots should allow recovery from:

- accidental deletion,
- bad synchronization,
- migration failures,
- corrupted local state.

Encrypted backup should be the preferred user-facing format.

Readable export formats should be explicit exports, not the canonical internal backup representation.

---

## 22. Trash

Soft deletion should be modeled explicitly.

Deleted objects should retain enough metadata to restore their relationships where possible.

Permanent deletion may occur after retention expiry or explicit user action.

---

## 23. Security Boundaries

Never commit:

```text
.env
.env.local
.env.production
*.key
*.pem
recovery keys
database passwords
OAuth client secrets
user backups
runtime databases
personal calendar exports
```

Only commit safe templates such as:

```text
.env.example
```

with non-secret placeholder values.

---

## 24. Testing Strategy

### Unit tests

Required for:

- reducers/state transitions,
- date calculations,
- recurrence rules,
- hierarchy operations,
- session/task behavior,
- migrations,
- conflict resolution.

### Integration tests

Required for:

- persistence,
- sync,
- backup/restore,
- external calendar adapters.

### End-to-end tests

Prioritize critical workflows:

1. create task,
2. organize task into nested folder,
3. plan task for week,
4. plan task for day,
5. drag task onto calendar,
6. create multiple work sessions,
7. complete one session without completing task,
8. complete task and verify all views,
9. offline edit then reconnect,
10. backup and restore.

Test desktop and representative mobile/tablet viewport behavior.

---

## 25. Performance

Large task hierarchies should remain responsive.

Avoid:

- full-tree recomputation on every minor input,
- unnecessary re-rendering,
- calendar recalculation unrelated to changed dates,
- synchronous network-dependent UI flows.

Consider virtualization only when needed; do not add complexity prematurely.

---

## 26. Accessibility

All primary functionality should support:

- keyboard navigation,
- visible focus states,
- semantic controls,
- screen-reader labels,
- sufficient contrast,
- reduced-motion preference.

Drag-and-drop actions must have a non-drag alternative.

---

## 27. Upstream Integration Policy

Do not blindly merge upstream `master`.

When incorporating upstream changes:

1. fetch upstream,
2. inspect changes,
3. identify security/bugfix relevance,
4. merge or cherry-pick intentionally,
5. resolve conflicts according to Planstrand architecture,
6. run tests,
7. document meaningful divergences.

Planstrand may increasingly diverge from upstream over time.

---

## 28. V1 Technical Non-Goals

Do not introduce these without a concrete need:

- framework migration,
- rewrite to React/Next.js,
- microservices architecture,
- mandatory cloud dependency,
- custom native iOS UI rewrite,
- custom watchOS application,
- complex AI scheduling system,
- premature horizontal scaling.

---

## 29. Definition of a Safe Change

A change is safe when it:

- preserves existing user data,
- passes relevant tests,
- works offline where expected,
- does not introduce plaintext secrets,
- does not duplicate task identity,
- behaves predictably across supported views,
- has a migration when persistent structure changes,
- is understandable in code review.

---

## 30. Source Documents

Implementation decisions should remain consistent with:

- `docs/PRODUCT_SPEC.md`
- `docs/DESIGN_SYSTEM.md`

When a technical constraint conflicts with the product specification, document the constraint and choose the smallest reasonable deviation rather than silently changing product behavior.
