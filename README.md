<h1 align="center">
  <img src="docs/assets/readme/planstrand-banner.svg" alt="Planstrand — Make room for what matters." width="100%">
</h1>

<p align="center">
  A local-first personal planner for a clearer day and a more intentional week.<br>
  Bring tasks, focused work and everyday routines into one workspace.
</p>

<p align="center">
  <strong>Works offline · No mandatory account · Blue Thread light &amp; dark</strong>
</p>

<p align="center">
  <a href="#download-v13-rc1">Download</a> ·
  <a href="#a-place-for-every-part-of-your-day">Explore</a> ·
  <a href="docs/wiki/3.10-Planstrand-V1.md">User guide</a> ·
  <a href="docs/releases/v1.3.0-rc.1.md">Release notes</a>
</p>

## Download V1.3 RC1

**1.3.0-rc.1 · Windows x64 · Prerelease**

| [↓ Windows Setup](https://github.com/hychaw/planstrand/releases/download/v1.3.0-rc.1/Planstrand-Setup.exe) | [↓ Windows Portable](https://github.com/hychaw/planstrand/releases/download/v1.3.0-rc.1/Planstrand-Portable.exe) |
| :--------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| Regular per-user Windows installation.                                                                     | Run without a traditional installation.                                                                          |

[Official release & checksums](https://github.com/hychaw/planstrand/releases/tag/v1.3.0-rc.1)
· [All releases](https://github.com/hychaw/planstrand/releases)

> **Before you install:** These Windows builds are **unsigned**. SmartScreen,
> Smart App Control or organizational policies may warn about or block execution.
> Installation and updates are manual. Before upgrading, export an independent
> backup and [rehearse restoration](docs/v1.2-backup-restore.md).

Run Setup to install, or launch the Portable executable. Both normally use the
same profile at `%APPDATA%\Planstrand`, separate from the executable. **Portable
does not automatically carry your data between computers.** See
[upgrade and data safety](#upgrade-and-data-safety) before using an existing profile.

## A place for every part of your day

### Find your focus

**Today** brings your priorities and schedule together. Choose what matters in
**Focus**, then make room for it in **My Day** with Task-linked WorkSessions.
New Tasks created in My Day are planned for Today and appear in Focus.

[![Today: Focus Tasks beside My Day, timed Events and a WorkSession in Blue Thread Dark](docs/assets/readme/today-focus.png)](docs/assets/readme/today-focus.png)

### Give your week some breathing room

Keep work organized in **Tasks and hierarchical Folders**, then decide when to
take it on in **This Week**. Plan for a day, move between weeks, or leave flexible
work in **Anytime This Week**. Planning, deadlines and WorkSessions stay independent.

**This Week · see what lies ahead.** Choose a day without committing to a time slot.

[![This Week with weekday Planning groups and Anytime This Week](docs/assets/readme/this-week.png)](docs/assets/readme/this-week.png)

**Tasks & Folders · keep work in order.** Use nested Folders and Task ordering that
survives restarts.

[![Tasks organized in Inbox and hierarchical Folders, with a nested Task](docs/assets/readme/tasks-folders.png)](docs/assets/readme/tasks-folders.png)

### Make time for work and routines

Explore **Calendar** in Day, Week, Month or Year view. Schedule multiple
**WorkSessions** for a Task and edit their start and end times to the exact minute.
Build a rhythm with daily, weekly or monthly **recurring Events** and reusable
**Weekly Templates**.

**Calendar · make space for focused work.** Keep Events and Task-linked WorkSessions
in view.

[![Calendar week with WorkSessions, recurring Events and template occurrences](docs/assets/readme/calendar-week.png)](docs/assets/readme/calendar-week.png)

**Weekly Templates · shape a repeatable week.** Activate a schedule without creating
Tasks or WorkSessions.

[![Weekly Templates with an active reusable schedule containing two entries](docs/assets/readme/weekly-templates.png)](docs/assets/readme/weekly-templates.png)

All five views show Blue Thread Dark. Select any screenshot to open the full image.
Blue Thread also offers light appearance and Comfortable or Compact density.

**A timely nudge.** Device-local reminders are available for standalone timed Events
and WorkSessions. Delivery is best effort while Planstrand runs; reliable closed-app
delivery is unavailable. Recurring and all-day Events do not support these reminders.
Reminder preferences are excluded from synchronization and model-only exports.

**Your workspace, on your computer.** Core planning works offline, stores data locally
and requires no account. Synchronization is optional and disabled by default;
configured providers or integrations can send data to the services you choose.

## What's new in V1.3

| Everyday planning                                                                                                                      | Scheduling and safeguards                                                                                                                                             |
| :------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **More flexible Planning:** Today, Tomorrow, This Week, Next Week, selected dates and Unplan, with navigation across weeks.            | **Precise WorkSessions:** exact-minute start/end editing in My Day and Calendar; dragging retains five-minute snapping.                                               |
| **Clearer Task controls:** persistent ordering, management context menus, and Planning/scheduling menus for Tasks and nested Tasks.    | **Calendar corrections:** configured week starts, the current-time indicator and British Columbia timezone compatibility.                                             |
| **My Day creation:** new Tasks automatically join Today and Focus. **Reminders:** improved controls and Windows notification handling. | **Upgrade safeguards:** clearer release-candidate discovery, stronger backup write verification and future-data guards; invalid TLS certificates rejected by default. |

Read the [V1.3 RC1 release notes](docs/releases/v1.3.0-rc.1.md) for Windows
acceptance results, compatibility, checksums and known limitations. Windows x64 is
the currently validated distribution platform.

## Start with one Task

1. Create a Task in **Inbox** or a Folder.
2. Plan it for **Today** or **This Week**.
3. Reserve time with a **WorkSession** in My Day or Calendar.
4. Add recurring Events or open **Weekly Templates** from Calendar for your routines.

The [Planstrand user guide](docs/wiki/3.10-Planstrand-V1.md) covers the current
interface, Planning, routines and local data.

## Upgrade and data safety

- **Keep an independent backup.** Export through **Settings → Sync & Backup →
  Import/Export** before upgrading or deleting a profile. Keep a protected copy
  outside the profile and sync destination, and preserve credentials and encryption
  keys separately. [Rehearse restoration](docs/v1.2-backup-restore.md) in a disposable
  profile with sync disconnected. Application-data backups are not complete
  filesystem-profile backups or automatic rollback; deleting the profile can also
  remove Events, settings and other local information.
- **Check upgrade compatibility.** A V1.2 → V1.3 in-place installer upgrade was
  **not tested** for this candidate. V1.3 retains V1.2's schemas, but unchanged
  schemas do not guarantee rollback. **V1.2 profiles cannot be opened by V1.1**;
  rollback requires a separate pre-upgrade backup/profile. Close Planstrand
  completely before upgrading.
- **Reconnect sync deliberately.** Disconnect existing sync clients until
  server/provider and client compatibility is verified. Planstrand provides
  **no hosted SuperSync service**; do not use the upstream hosted service as a
  Planstrand endpoint. Check restored data and persistence after restarting before
  reconnecting. See [V1.3 limitations](docs/releases/v1.3.0-rc.1.md#known-limitations)
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
See [development guidance](docs/development.md) for repository conventions and checks,
and the [documentation index](docs/README.md) for maintained technical guides.

## License and acknowledgements

Planstrand is developed and maintained by **How Yee Chaw** and distributed under
the [MIT License](LICENSE). Original Planstrand contributions are copyright
(c) 2026 How Yee Chaw.

Planstrand is an independent fork of [Super Productivity](https://github.com/super-productivity/super-productivity),
originally developed by Johannes Millan and contributors. Inherited upstream code
retains its original copyright and [MIT license](LICENSES/SUPER_PRODUCTIVITY_MIT.txt);
third-party notices remain applicable. Planstrand is not officially affiliated
with or endorsed by Super Productivity.
