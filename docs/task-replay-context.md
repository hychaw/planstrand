# Task replay context v1

Ordinary persistent `TaskSharedActions.updateTask` operations and synthetic
`[TASK] LWW Update` operations carry an authenticated outer-payload
`taskReplayContext`. The existing semantic capability fence now requires
`TASK_REPLAY_CONTEXT_V1`; archive-command support alone does not imply support
for this contract. There is no schema or application version bump.

The strict version-1 fields are:

- `modified`: the source update's sampled timestamp, or the winning LWW record's
  recorded value. `null` explicitly preserves absence on replacement snapshots;
  it is forbidden on ordinary updates. A new patch without a record timestamp
  samples a new source mutation time. Operation ordering timestamps and vector
  clocks keep their existing meanings.
- `today`: the source store's logical calendar day.
- `todayStart`, `todayEnd`: the source-local day boundaries as absolute millisecond
  timestamps, with the configured logical-day offset already applied. They form
  a half-open interval for LWW timed Today membership. They retain source timezone
  and DST effects without consulting a replay host's timezone rules or requiring
  an IANA name that some Windows/Intl combinations cannot resolve.
- `completionDay`, when completing an ordinary update: the source-local calendar
  date of its actual `doneOn` value. Missing completion timestamps are filled from
  the same sampled update time before the reducer runs.

The operation-capture meta-reducer prepares ordinary updates synchronously before
mutation; the existing prepared-action mapping retains the values for deferred
writes and retries. The conflict factory captures synthetic-operation calendars
before persistence/application. Conversion, delete compensation and versioned
mirrored disjoint merges retain authenticated context; reducers do not re-sample
those values. Patch field clears and operation footprints are unchanged.

Versioned Task recreation requires the actual source `created` timestamp in its
payload. Module-load defaults cannot establish a missing historical creation time;
recreation fails instead of inventing one.

Clients predating this semantic capability are refused by the existing server
reader/writer fence. Servers without capability enforcement cannot receive these
operations. Missing, malformed, unsupported, or capability-stripped context is
rejected. Unmarked legacy operations retain existing synchronization semantics;
that does not make their receiver-clock-dependent histories recoverable.

This milestone does not integrate the recovery CLI or claim complete Task/Event
tail support. The generic server snapshot replay explicitly refuses this context.
Recovery still needs a production replay host with complete canonical windows,
awaited archive writes, strict failure propagation and validated full-state export.
Legacy ambiguous histories and other unsupported Task/Event operations must
continue to fail closed; neither snapshots nor ordering timestamps supply missing
historical clock/calendar context.
