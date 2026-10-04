# Judging Sync Severity

Triage rules — how to decide whether a sync bug is real and how bad it is.
Use these rules alongside the [contributor sync model](contributor-sync-model.md). Historical upstream examples below explain risks; re-measure dated statistics before relying on them.

1. **Prove which clients received a change.** Planstrand RC1 is publicly released; development pushes do not automatically publish it. Check tag ancestry and release artifacts. Historical upstream store/container channels may have shipped commits independently of tags; do not apply those publishing assumptions to Planstrand.
2. **Never infer "shipped" from dates or the latest tag — prove it.** Use
   `git merge-base --is-ancestor <commit> v<tag>` / `git tag --contains <commit>`. Tags are cut from
   a point in time, and sync features routinely land just after: **#8874's disjoint-field merge
   landed ~24h after v18.14.0 was tagged and is in no release**, so whole-entity-LWW field loss
   (rename dies when another device marks the task done, #9095) is live in **every shipped version**.
3. **"Restores released behavior" ≠ safe. The released behavior can be the bug.** #9061 froze the
   disjoint merge on exactly that reasoning and silently re-armed shipped data loss (#9095).
   A freeze/revert needs the same "what breaks for users?" analysis as a feature.
4. **Users do report sync bugs — in non-technical words. There is no `sync` label.** Keyword-grepping
   `sync`/`op-log`/`conflict` undercounts by ~50×. Search what users actually write: _lost,
   disappeared, gone, missing, duplicate, reverted, old version, overwritten, reset, not syncing_
   (#7892 "all data deleted overnight"; #8107 user rebuilt lost projects from memory; #7549 done
   tasks resurrecting). ~53 user-reported sync/data-loss issues from 44 authors in 90 days ≈ one
   every 2 days (measured 2026-07). And silent data loss is structurally under-reported — absence of reports is never
   evidence of absence.
5. **Audit-generated findings are low-precision, not low-yield — verify them, don't dismiss them.**
   ~89% of sync fixes since v18.14.0 repaired code present in the release, yet ~97% of the self-filed
   sync issues carried no reproduction (both measured 2026-07). So both failure modes are live: **do not close an unreproduced
   finding as speculation** (#8960/#9073/#8751/#9040 had no repro and were all real and shipped), and
   **do not fix one blind** — the _fix_ must carry a test that fails without it, and you must confirm
   the fix actually fires on a real op (#9045 shipped an `entityIds` security check that **never fired**;
   #9025 was self-retracted as "not a live data-loss bug"). The reproduction gates the _fix_, not belief.
