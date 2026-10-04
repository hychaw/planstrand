# Planstrand v1.0.0-rc.1

A local-first planner with hierarchical Folders/Tasks, Today and weekly planning, time-blocked WorkSessions and local calendar Events. Core use works offline without an account; sync and integrations are optional.

RC targets unsigned Windows x64 Planstrand-Setup.exe and Planstrand-Portable.exe. Confirm availability and validation before publication. Verify SHA256SUMS.txt and SOURCE_SHA.txt. SmartScreen may warn because no publisher signature is provided.

Migration: export a full Super Productivity backup, keep an independent copy, import into clean Planstrand, then verify Tasks/Projects and Folder/planning/WorkSession compatibility conversion. Never reuse a live upstream profile or sync destination. Windows data defaults to %APPDATA%\Planstrand; uninstall retains data unless removed separately.

Public tag: v1.0.0-rc.1. Technical version: 19.1.0 for compatibility. Backup/sync schemas are unchanged. Technical version comparisons mean public 1.x tags require manual download checks.

Limitations: unsigned binaries, neutral interim icon, Windows-first validation, no stores, no macOS signing/notarization, no separate mobile distribution. Dropbox and bundled Google Calendar authorization await Planstrand-owned credentials. Plugin OAuth needs user/plugin-owned provider registrations. Use a separate web origin and sync location.

After V1: final artwork, wider platform packaging validation, mobile identity/app groups and owned credentials, signing, and a deliberate technical version/update policy.

Planstrand is an independent fork of Super Productivity by Johannes Millan and contributors, distributed under MIT. Original copyright/license attribution remains. No affiliation or endorsement is implied.

Hosted sync is not supplied by Planstrand; configure a server you control. This host can report an unknown system timezone; configure a valid OS timezone before scheduling WorkSessions or Events. RC automation uses UTC.
