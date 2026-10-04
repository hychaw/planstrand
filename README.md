# Planstrand

A local-first planner combining hierarchical task organization, weekly planning, time-blocked WorkSessions, and calendar Events.

## What Planstrand is

A personal workspace for organizing tasks and planning work. Core planning works offline without an account.

## V1 features

- Folders and hierarchical Tasks.
- Today and weekly planning.
- Time-blocked WorkSessions attached to Tasks.
- Local calendar Events alongside planned work.
- Local persistence, backup export/import and optional sync.

Screenshots will follow packaged RC verification. The RC uses a neutral calendar icon; final artwork is pending.

## Installation and status

**Planstrand v1.0.0-rc.1 is being prepared; no release is published yet.** Downloads will appear in [Planstrand releases](https://github.com/hychaw/planstrand/releases) after manual approval.

Windows x64 targets: `Planstrand-Setup.exe` and `Planstrand-Portable.exe`. Unsigned builds may trigger SmartScreen; verify source and checksums before running downloaded builds. Technical version remains `19.1.0` for inherited compatibility; public tag is `v1.0.0-rc.1`.

## Local-first and privacy

Tasks, planning and Events live locally. Core use requires no account or analytics. Optional sync/integrations contact configured services. Desktop data uses a separate Planstrand profile; browser storage belongs to its origin. Keep independent backups.

## Sync and backups

Export/import backups through Settings. Optional file/WebDAV sync retains compatibility formats. Use a separate remote destination; sharing a live sync target with Super Productivity is not a supported migration path. Dropbox and bundled Google Calendar authorization are deferred until Planstrand-owned OAuth credentials exist. Other OAuth integrations require your own registrations/client configuration.

## Supported platforms

RC validation targets Windows x64. Web builds are available for development on a separate origin. Linux identity is prepared, with artifacts deferred. macOS signing/notarization, Android/iOS distribution and all app stores are deferred. Mobile source retains upstream IDs and must not be distributed as a separate app yet.

## Migration from Super Productivity

Export a full backup from Super Productivity, keep an independent copy, then import into a clean Planstrand profile. Verify Tasks/Projects and review planning before adopting the RC. Existing compatibility conversion handles Folders, planning and WorkSessions. Do not copy a live profile or point `--user-data-dir` at Super Productivity. Default Windows data is `%APPDATA%\Planstrand`; settings and local backups stay under that profile. Uninstall normally retains the profile; remove it separately only after saving backups.

## Known V1 limitations

Unsigned binaries, interim artwork, Windows-first validation, deferred mobile/store ownership and Dropbox credentials. Update notifications compare technical versions, so public 1.x RC tags require manual download checks. Wider platform validation and a Planstrand-native technical version policy remain follow-ups. See [release checklist](docs/PLANSTRAND_RELEASE_CHECKLIST.md).

## Development

Use Node.js 22.18.0 and npm 11.18.0 (recorded in package metadata).

```sh
npm ci
npm run startFrontend
npm run build
npx electron-builder --win nsis portable --x64 --publish never
```

Run focused tests and `npm run checkFile <file>` for changed TypeScript/SCSS. Release builds must include only deliberately configured Planstrand-owned credentials. See [identity decisions](docs/PLANSTRAND_RELEASE_IDENTITY.md) and [RC notes](docs/releases/PLANSTRAND_V1_RC1.md).

## Attribution

Planstrand is based on/forked from [Super Productivity](https://github.com/super-productivity/super-productivity), originally by Johannes Millan and contributors. Planstrand modifications are maintained independently by hychaw. No affiliation or endorsement by the upstream author is implied.

## License

Distributed under the [MIT license](LICENSE). Original copyright and license text are preserved.

Hosted sync is not supplied by Planstrand; configure a server you control. This host can report an unknown system timezone; configure a valid OS timezone before scheduling WorkSessions or Events. RC automation uses UTC.
