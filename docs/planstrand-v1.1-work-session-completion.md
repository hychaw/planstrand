# Independent WorkSession completion

The WorkSession domain already supports `completedAt`, `completeWorkSession`, and
`uncompleteWorkSession`. The service dispatches one persistent WORK_SESSION update
for the selected source identity. The reducer changes that session only; reopening
stores `completedAt: null`, which survives JSON serialization. Neither action changes
the parent Task, Planning assignment, or sibling sessions.

The missing product surface was the shared schedule block menu, which exposed only
Unschedule. The calendar read model also omitted completion state.

## Correction

- Carry the existing completion value into the disposable CalendarDisplayItem
  projection. No persisted fields or schema changes.
- Add **Mark WorkSession as completed** / **Mark as incomplete** to the session menu.
  Right-click or click an editable session in My Day or Calendar Day, Week, or Month.
- Keep completed blocks visible, with a check icon, restrained title strikethrough,
  and a WorkSession-specific completed tooltip. Existing move/resize remains available.
- Keep Task menus separate. Read-only/foreign items and drag previews cannot invoke
  session completion.
- Preserve all existing domain, migration, sync, and operation-log implementation.

## Verification

- 196 focused schedule/projection/WorkSession unit tests passed.
- 100 operation capture, replay suppression, and IndexedDB failure safety tests passed.
  New coverage verifies exactly one update per completion/incomplete intent and zero
  additional writes for remote copies; JSON replay remains idempotent.
- Controlled-time browser regression creates one Today-planned Task, drags it into
  My Day twice, completes one session, reloads, and verifies the sibling and Task stay
  incomplete, both sessions remain visible, and Planning stays unchanged. It checks
  the menu in Calendar Day/Week/Month, reopens the selected session, and reloads again.
- Full Planstrand browser run: 26/28 passed. The older drag-preview check passed on
  isolated rerun; the keyboard shell check passed against the production build.
  Both completion-regression runs passed.
- Lint, formatting, app TypeScript, production build, Electron build, and unpublished
  Windows unpacked package passed. Existing initial bundle budget warning remains.
- Actual packaged Electron launch was attempted with an isolated profile. Windows
  Device Guard blocked the new executable before startup, so this package's native
  UI smoke check could not run. No policy bypass was attempted.

One existing unit assertion still expected Task-source dragging to move its legacy
reservation. It now verifies the accepted new-session behavior while retaining the
legacy reservation, its sibling, and Task state. Runtime scheduling was not changed.

No merge, publication, release-tag change, or settings/visual redesign is included.
