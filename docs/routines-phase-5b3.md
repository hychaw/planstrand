# Routines Phase 5b.3 — Encrypted operation-tail recovery

Validated October 11, 2026 UTC, starting from a clean
`feature/v1.2-routines` tree at
`4f500c2bfa8eeb104b13d55df5719ebe137a1109`.

## Release decision

**The Phase 5b.2 encrypted Routines recovery blocker is resolved for supported
V1.2 snapshot-plus-tail history.** The actual operator CLI reconstructs normalized
records through the existing client reducers and validators after authorized
decryption. It does not synthesize Calendar occurrences or create other entities.
Unsupported or malformed history still fails without a new output file.

## Root cause and implementation

Generic server replay merges payloads into uppercase entity maps. That cannot
interpret the Routines action vocabulary, complete plan replacements, canonical
occurrence registers or terminal tombstones. Phase 5b.2 therefore correctly
refused Routines tails instead of exporting apparently successful incomplete data.

The operator CLI now selects the persisted `actionType` along with the existing
batch `entityIds` and `repairBaseServerSeq`. Its explicit replay adapter invokes
the **actual EventSeries, OccurrenceException and WeeklyTemplate client reducers**.
The Routines payload-validation branch was moved unchanged into a shared pure
helper used by both normal client validation and recovery. The existing IANA
zone predicate was separated from browser-specific zone discovery so those
reducers can load without `window` or mocked browser globals.

This remains the supported development-checkout tool. It uses Node 22.18.0,
ts-node with source-file preference, installed root dev dependencies and NgRx's
Angular compiler in the operator process. It does not load application services,
render Calendar projections or copy reducer semantics into the server.

The production server's unsupported-Routines guard remains the default. Even an
operator adapter that declines a Routines operation cannot fall through into
generic maps. Encrypted rows must be decrypted before the adapter is called.
Normalized state growth receives the existing exact replay-size check.

## Supported persisted operations

| Family                  | Reconstructed operations and invariants                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EventSeries             | Creation; legacy complete schedule edits; complete multi-segment plan replacement; terminal deletion; complete LWW compensation. Lineage ID, first-segment provenance, immutable creation/ownership metadata and global logical-slot offsets survive. |
| OccurrenceException     | Canonical complete upserts for override, cancellation and `inherit` restoration; complete LWW compensation. The canonical lineage/slot identity remains unchanged.                                                                                    |
| WeeklyTemplate          | Creation; complete definition updates covering rename, activation/deactivation and date bounds, including clearing an end date; terminal deletion and complete LWW compensation.                                                                      |
| Template entries        | Multiple owned series, individual entry tombstones, retained entries after parent deletion and late entry operations. No parent-deletion cascade or resurrection is invented.                                                                         |
| Recovery infrastructure | Full-state boundaries, causal REPAIR and subsequent tails, accepted server-sequence order, existing normalized Task batch deletion metadata and existing schema migration replay.                                                                     |

Duplicate creations do not undo later edits; duplicate complete register writes
remain idempotent. Live compensation cannot resurrect terminally deleted or
absent lineages. A complete tombstone can precede creation. Recovery replays
accepted history and its persisted compensation operations in server sequence
order; it does not perform a new cross-client conflict negotiation or reorder
history by wall-clock timestamps.

The account floor, operation requirements and reconstructed-state requirements
are retained in the protected backup. Encountering a Routines operation also
retains `ROUTINES_V1` across later state replacement, even if incidental row
capability metadata is missing. A retained account floor survives pruning of the
activating history. An unactivated legacy snapshot remains unactivated.

## Actual encrypted execution

Environment: Windows, Node 22.18.0, PostgreSQL 18.4 and Chrome 155.0.8059.40.
Only the disposable Phase 5b.2 PostgreSQL cluster was reused, explicitly bound to
`127.0.0.1:55441`. Fixtures used new generated users, credentials and temporary
files. No production database, real profile, personal storage, release or tag was
accessed or changed. The successful upgrade, WebDAV and two-client matrices were
not repeated.

1. **Previously failing captured scenario:** the five actual captured application
   operations from Phase 5b.2 were encrypted again with a new generated recovery
   password, stored as real Prisma/PostgreSQL rows and recovered with the actual
   `scripts/recover-user.ts` CLI. Normalized Routines records matched the source
   backup exactly; ordinary persisted records and capability requirements survived.
2. **Comprehensive snapshot plus 31 tail operations:** a real valid application
   snapshot was followed by encrypted fixtures using the existing persisted
   V1.2 action envelopes. These included daily, weekly and monthly series; an
   override and cancellation; restoration; a timed This-and-future split with
   global slot offset 10; multiple Weekly Template entries; rename, activation
   and date changes; series/template tombstones; late entry operations; complete
   compensation and duplicate delivery. All 32 operations recovered successfully.
   Records, ID arrays, plans, exceptions, ownership and tombstones matched the
   independently specified expected final state. Task, Folder, one-off Event,
   WorkSession and Planning records matched the original snapshot.
3. **Fresh V1.2 restoration:** the resulting CLI output imported through the
   actual current production renderer's backup UI into a fresh persistent Chrome
   profile. UI re-export used the supported protected-backup wrapper. All eight
   relevant persisted slices matched, and `ROUTINES_V1` remained present. Closing
   the browser process, reopening the same disposable profile and exporting again
   preserved the same records and requirements.

The comprehensive operation fixtures are representative persisted-format data;
they are not a claim that every edit was clicked in a source client. The separate
five-operation scenario is captured-client coverage. Both use real encryption,
PostgreSQL and the actual recovery CLI, without mocked decryption or reducers.

The optional native-profile restoration harness stalled before import and was
terminated using only its owned disposable processes. No native Phase 5b.3
restoration success is claimed. The completed fresh-profile persistence check
uses the current source-built production renderer in Chrome. No new desktop
installer or public V1.2 artifact was produced.

## Failure paths and scope boundaries

Real CLI tests verify no output on missing/wrong keys, a bit-flipped AES-GCM
ciphertext, invalid decrypted JSON, malformed Routines state/action payloads,
unknown actions, noncanonical occurrence IDs, altered immutable ownership,
misrouted entities/full-state actions, unsupported schema versions, invalid
causal bases, unknown operation vocabulary and unsupported batch footprints.
Leading, internal and trailing gaps fail explicitly. A retained leading full
snapshot followed by a contiguous tail succeeds. The Phase 5b.2 missing-final-op,
Task batch deletion and causal REPAIR regressions remain covered.

Malformed uppercase Routines snapshots from the old generic replay shape are
rejected. State and private-content sentinels never appear in CLI logs; summaries
print counts instead of decrypted client-supplied state keys. Generated passwords
are also checked for absence from stdout/stderr. Encryption and capability
enforcement were not weakened.

Remaining unsupported cases are explicit:

- Folder operation tails still require the existing supported client recovery or
  a complete retained full-state boundary. Folder records in snapshots survive.
- Markerless REPAIR remains ambiguous and refused.
- Invented Routines multi-entity batches, nonempty entity-change footprints,
  partial compensation payloads and future schema/action vocabularies are not
  accepted as alternative replay formats. V1.2 captures these Routines actions
  as single-register envelopes with empty `entityChanges`.
- An unsupported operation earlier in the selected range still prevents
  recovery, even when a later snapshot exists. No silent prefix skipping was added.
- Server HTTP restore remains unable to decrypt encrypted data and still refuses
  generic Routines replay. Authorized operator recovery is the completed path.

## Validation

- **38 actual PostgreSQL/encrypted CLI integration tests:** six preserved recovery
  regressions plus 32 focused Routines cases.
- **38 replay/HTTP fence unit tests:** includes unchanged default refusal and
  refusal when an operator adapter declines a Routines operation. HTTP service
  dependencies use the repository's existing mocked infrastructure.
- **141 existing client tests:** payload validation, the three Routines reducer
  families and IANA zone behavior.
- Actual captured-tail recovery and comprehensive 32-operation CLI execution.
- Actual production UI import, re-export and full browser-process restart.
- Server TypeScript build, focused integration-test type checking, production
  frontend build and changed-client-file ESLint checks.

The frontend build retains the existing 5.60 MB initial-bundle budget warning;
the focused Chrome run also reports the repository's existing unsupported Chrome
107 Browserslist entry. Both checks complete successfully with Chrome 155.

Disposable diagnostics are under `.tmp/phase5b3`, including
`recovery-tests-final.log`, `actual-recovery.cjs`, `actual-recovery-final.log`,
`browser-restore.spec.ts` and `browser-restore.log`. Generated plaintext backups,
profiles, credentials and database contents must not be published. An initial
database-port mismatch, protected-export wrapper assertion and Windows sandbox
temp-cache rename failure were harness/environment issues corrected before the
passing runs.

The final commit, required pre-commit checks and working-tree status are reported
with the task result. No production synchronization redesign, migration change,
UI feature, push, release or tag modification is included. Work stops at Phase 5b.3.
