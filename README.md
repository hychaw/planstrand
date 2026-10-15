<p align="center">
  <img src="src/assets/icons/strand-p.svg" alt="Planstrand Strand P logo" width="88" height="88">
</p>

<h1 align="center">Planstrand</h1>

<p align="center"><strong>Plan your time. Stay focused.</strong></p>

Planstrand is a local-first personal planner for turning tasks and routines into
a manageable day. Organize work in Folders, choose what to focus on, and reserve
time with WorkSessions. Calendar Events, recurring schedules and Weekly Templates
bring the rest of your week into the same organized workspace. Core planning works
offline, with your data stored on your computer and no mandatory account.

![Planstrand Today: Focus tasks and My Day in Blue Thread Dark](docs/assets/readme/today-focus.png)

## Download

**Planstrand V1.3 RC1** · Windows x64 · Prerelease · [Release notes](https://github.com/hychaw/planstrand/releases/tag/v1.3.0-rc.1)

| Download                                                                                                       | Choose this for                           |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [Windows Setup](https://github.com/hychaw/planstrand/releases/download/v1.3.0-rc.1/Planstrand-Setup.exe)       | Regular per-user Windows installation.    |
| [Windows Portable](https://github.com/hychaw/planstrand/releases/download/v1.3.0-rc.1/Planstrand-Portable.exe) | Running without traditional installation. |

Both normally store user data separately from the executable, in the same default
Planstrand profile. The portable executable does not automatically carry your data
between computers.

Windows x64 is the currently validated distribution platform. These are **unsigned
release-candidate builds**: SmartScreen, Smart App Control or organizational
policies may warn about or block execution. Installation and updates are manual.
Before upgrading, export an independent backup and
[verify restoration](docs/v1.2-backup-restore.md). A V1.2 → V1.3 in-place installer
upgrade was **not tested**. **V1.2 profiles cannot be opened by V1.1**; rollback
requires a separate pre-upgrade backup/profile. See the
[V1.3 release notes](docs/releases/v1.3.0-rc.1.md) for acceptance results,
checksums, compatibility requirements and known limitations.

[All releases](https://github.com/hychaw/planstrand/releases)

## A workspace for your plans

### Tasks and daily Planning

- **Tasks and Folders.** Capture Tasks in Inbox, organize them in hierarchical
  Folders, and keep a Task order that persists across restarts. Clearer context
  menus handle management; three-dot menus bring Planning and scheduling together.
- **Today and weekly Planning.** Move Tasks to Today, Tomorrow, This Week, Next Week
  or a selected date. Navigate between planning weeks and keep flexible work in
  Anytime This Week. Planning, deadlines and WorkSessions remain independent.
- **Focus and My Day.** Keep daily priorities beside your schedule. New Tasks
  created in My Day are planned for Today and appear in Focus. Schedule multiple
  WorkSessions for a Task, and edit their start and end times to the exact minute
  from My Day or Calendar. Dragging retains five-minute snapping; completing a
  WorkSession leaves its parent Task independent.

### Calendar and reusable routines

- **Calendar and Events.** Explore Day, Week, Month and Year views, alongside Task
  WorkSessions. V1.3 improves week-start behaviour, the current-time indicator and
  British Columbia timezone compatibility.
- **Recurring Events and Weekly Templates.** Use daily, weekly or monthly Events,
  editing one occurrence, this and future occurrences, or the series. Build reusable
  weekly schedules with multiple entries and date bounds. Activated templates
  appear in Calendar without creating Tasks or WorkSessions.
- **Device-local reminders.** Set reminders for standalone timed Events and
  WorkSessions. Delivery is best effort while Planstrand runs; notifications are
  not guaranteed when it is closed. Recurring and all-day Events do not support
  these reminders, and reminder preferences are not synchronized.

### A workspace you control

- **Local-first and offline.** Core planning works offline and stores data locally
  by default. Optional synchronization uses providers and services you explicitly
  configure and check for compatibility.
- **Update and backup safeguards.** Release-candidate discovery points to official
  releases; upgrades remain manual. Backup write verification and future-data
  compatibility guards help check exported data. Independent backups and restore
  rehearsals remain essential; invalid TLS certificates are rejected by default.
- **Make it yours.** Blue Thread brings a distinctive blue identity, light and dark
  appearance, Comfortable and Compact density, and a responsive desktop interface.

### Calendar · make room for routines and focused work

![Dark Calendar week with recurring Events, a standalone Event, and a Task-linked WorkSession](docs/assets/readme/calendar-week.png)

### Weekly Templates · shape a repeatable week

![Weekly Template management in dark mode with a reusable weekly schedule](docs/assets/readme/weekly-templates.png)

<details>
<summary>This Week · weekly planning</summary>

![Dark This Week view with weekday planning and Anytime This Week](docs/assets/readme/this-week.png)

</details>

<details>
<summary>Tasks and Folders</summary>

![Dark Tasks view organized into Inbox and nested user-created Folders](docs/assets/readme/tasks-folders.png)

</details>

## Get started

1. Download Planstrand Setup or Portable.
2. Launch the application.
3. Create Tasks in Inbox or Folders.
4. Plan work in Today or This Week.
5. Reserve focused time through WorkSessions in My Day or Calendar.
6. Add recurring Events or open Weekly Templates from Calendar to plan routines.

## Local data and privacy

On Windows desktop, the default user-data directory is `%APPDATA%\Planstrand`.
Tasks, Folders, Planning, Events, Weekly Templates, WorkSessions, and application preferences are
stored locally. Setup and Portable normally use this same profile.

Keep an independent backup through **Settings → Sync & Backup** before deleting
the profile or upgrading between release candidates. Deleting the entire profile
is different from a selective Task reset: it may remove Events, Settings, and
other local information too.

Core functionality requires no account. Explicitly configured synchronization or
integrations can send data to the remote services you choose. Planstrand does not
provide a hosted **SuperSync** service; synchronization is disabled by default.
Before upgrading existing sync clients, disconnect until server/provider and client
compatibility is verified. Do not use the upstream hosted service as a Planstrand
endpoint. See the [V1.3 limitations](docs/releases/v1.3.0-rc.1.md#known-limitations)
and [V1.2 sync and recovery requirements](docs/releases/v1.2.0-rc.1.md).

## Development

Use **Node.js 22.18.0** and **npm 11.18.0**, as pinned in the repository.

```sh
npm ci
npm run startFrontend
```

In a separate terminal, launch Electron:

```sh
npm start
```

The frontend copies both project license notices as assets. Production frontend
scripts also generate and publish `3rdpartylicenses.txt` for the About page;
a fresh development-only startup does not generate that dependency notice file.
See [development guidance](docs/development.md) for repository conventions and checks.

## License and Acknowledgements

Planstrand is developed and maintained by **How Yee Chaw** and distributed under
the [MIT License](LICENSE). Original Planstrand contributions are copyright
(c) 2026 How Yee Chaw.

Planstrand is an independent fork of [Super Productivity](https://github.com/super-productivity/super-productivity),
originally developed by Johannes Millan and contributors. Inherited upstream code
retains its original copyright and [MIT license](LICENSES/SUPER_PRODUCTIVITY_MIT.txt);
third-party notices remain applicable. Planstrand is not officially affiliated
with or endorsed by Super Productivity.
