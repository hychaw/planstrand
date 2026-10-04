# Planstrand RC release checklist

- [ ] Verify desktop identity, protocol registration, isolated profile and Planstrand-only publishing target.
- [ ] Confirm reviewed SHA/clean tree; technical 19.1.0 and public tag v1.0.0-rc.1. Do not run npm version.
- [ ] Build production desktop and unsigned Windows x64 installer/portable with --publish never.
- [ ] Packaged smoke: first route, Folder, Task, Today, WorkSession, Event, restart, persistence, export/clean-profile restore.
- [ ] Install: verify title/directory/Start Menu/uninstall entry, upstream separation; uninstall and verify retained profile. Portable task/restart smoke.
- [ ] Import Super Productivity-compatible backup; verify Tasks/Projects and Folder/planning/WorkSession conversion.
- [ ] Review release notes, known limitations and MIT attribution; record actual validation results.
- [ ] After approval to push, push branch; configure planstrand-release environment with required reviewers before draft use.
- [ ] Dispatch release-planstrand.yml at explicit SHA with create_draft=false; inspect artifacts, SHA256SUMS and SOURCE_SHA.
- [ ] Final manual approval, then tag/draft prerelease in hychaw/planstrand only; publish only after artifact/note approval.
