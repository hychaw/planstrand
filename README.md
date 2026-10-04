# Planstrand

A local-first, offline-first personal planner for organizing tasks, planning your week, and reserving time for focused work. Core planning works without an account or internet connection.

## Download

**Planstrand v1.0.0-rc.1 is PUBLIC.** The Windows x64 release candidate is available as an installer (`Planstrand-Setup.exe`) and a portable build (`Planstrand-Portable.exe`).

[Download from GitHub Releases](https://github.com/hychaw/planstrand/releases/tag/v1.0.0-rc.1) · [All releases](https://github.com/hychaw/planstrand/releases)

Binaries are unsigned and may trigger Windows SmartScreen. Check the release's source and SHA256 checksums before running a download.

## Core V1 features

- Hierarchical Folders and Tasks, with an Inbox for capture and Master Tasks for an overview.
- Today and This Week planning views.
- WorkSessions for task-linked time blocking.
- Local calendar Events alongside planned work.
- Local persistence and backup export/import.
- Optional sync and integrations using services you configure.

## Platforms and RC limitations

Windows x64 is the currently validated distribution platform. Web builds can be run locally for development on a separate origin. Linux packages, macOS signing/notarization, mobile distribution, and app stores are deferred; their source does not imply validated support.

RC1 has interim artwork and unsigned binaries. Dropbox and bundled Google Calendar authorization are deferred pending project-owned credentials; other OAuth integrations require your own client configuration. Update notifications use the inherited technical version (`19.1.0`), so check GitHub Releases manually for public RC updates. Keep backups while evaluating the RC.

## Local data and privacy

Tasks, planning, Events, settings, and backups live locally. Core use requires no account and has no analytics or tracking. Optional sync and integrations contact the services you configure; Planstrand does not host a public sync service.

Desktop uses a separate Planstrand profile (`%APPDATA%\Planstrand` on Windows). Browser storage belongs to its origin. Export backups through Settings and keep an independent copy outside the profile. Uninstalling normally retains the desktop profile.

## Migration from Super Productivity

Export a full backup from Super Productivity and keep an independent copy. Import it into a clean Planstrand profile, then verify your Tasks/Folders and review planning before adopting the RC. Do not copy a live profile or use the upstream profile as `--user-data-dir`. Use a separate sync destination; sharing a live sync target between the two applications is not a supported migration path.

## Development and contributing

Use Node.js 22.18.0 and npm 11.18.0, as recorded in package metadata.

```sh
npm ci
npm run startFrontend
```

In a second terminal, `npm start` launches Electron against the development frontend. See [Contributing](CONTRIBUTING.md) for focused checks, [development guidance](docs/development.md) for repository conventions, and the [Security policy](SECURITY.md) for vulnerability reporting. Community participation follows the [Code of Conduct](.github/CODE_OF_CONDUCT.md).

## License and attribution

Planstrand is an independent fork of [Super Productivity](https://github.com/super-productivity/super-productivity), originally by Johannes Millan and contributors. Planstrand changes are maintained by hychaw and contributors; no upstream affiliation or endorsement is implied.

Distributed under the [MIT license](LICENSE), with the original copyright and license text preserved in source and packaged distributions.
