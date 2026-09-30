# Planstrand V1 Product Specification

## 1. Product Overview

Planstrand is a local-first, cross-platform personal planning application that combines hierarchical task management, weekly planning, daily planning, time blocking, recurring schedules, and calendar views in one system.

The core workflow is:

**Capture → Organize → Plan the Week → Plan the Day → Schedule Work Sessions → Complete**

A task is a persistent object that can move through planning stages without being duplicated.

Planstrand is derived from Super Productivity and will preserve required upstream license notices while developing an independent product identity, workflow, interface, and feature model.

---

## 2. Product Goals

Planstrand should:

1. Make it easy to capture tasks before all details are known.
2. Allow users to organize tasks using folders and nested subfolders.
3. Support planning at three different levels:
   - general/master task list,
   - weekly task list,
   - daily task list.
4. Allow tasks to be scheduled into one or more calendar work sessions.
5. Keep task completion separate from work-session completion.
6. Support normal calendar events that are not tasks.
7. Support recurring schedules such as lectures, labs, work hours, gym sessions, and other weekly routines.
8. Work well on Windows, iPhone, and iPad, with Apple Watch visibility through calendar integration initially.
9. Remain usable offline.
10. Synchronize data across devices through an account-based sync system.
11. Keep user content private, with end-to-end encryption for synchronized personal content.
12. Present a polished, restrained interface that does not look like a generic dashboard template.

---

## 3. Core Concepts

### 3.1 Task

A Task represents something the user wants to complete.

A task can exist without:
- due date,
- planned week,
- planned day,
- estimated duration,
- scheduled work session,
- reminder,
- folder.

Only the title is required.

A task may be completed manually by the user. Work-session completion must never automatically complete the task.

### 3.2 Folder

Folders are recursive containers.

A folder may contain:
- tasks,
- other folders,
- both at the same time.

Tasks may exist at any level of the hierarchy.

Example:

```text
School
├── CPEN 311
│   ├── Labs
│   │   ├── Finish Lab 2 report
│   │   └── Prepare Lab 3
│   └── Lectures
│       └── Review Lecture 6
├── ELEC 3XX
│   └── Assignment 1
└── Email professor
```

There is no requirement that a task live in the deepest folder.

### 3.3 Work Session

A Work Session is a calendar time block associated with a task.

A single task may have:
- zero work sessions,
- one work session,
- many work sessions.

Example:

```text
Task: Finish Lab 3
Due: Friday
Estimated total duration: Unknown

Tuesday  15:00–16:30  Work on Lab 3
Thursday 18:00–20:00 Continue Lab 3
```

The user does not need to know the total duration of the task before creating or planning it.

### 3.4 Event

An Event is a normal calendar item that does not have to correspond to a task.

Examples:
- lecture,
- dentist appointment,
- dinner,
- flight,
- meeting.

### 3.5 Weekly Template

A Weekly Template is a repeating baseline schedule active within a chosen date range.

Examples:
- semester lecture schedule,
- recurring lab times,
- regular work hours,
- weekly gym sessions.

A template occurrence may be modified or cancelled independently without changing the entire series.

### 3.6 Reminder

A Reminder is independent from a task deadline.

A task or event may have:
- no reminders,
- one reminder,
- multiple reminders.

Work sessions may also have their own reminders.

---

## 4. Planning Model

Planstrand has four planning layers.

### 4.1 General / Master Tasks

Contains all tasks.

Tasks may be:
- in Inbox,
- inside folders,
- inside nested folders,
- directly under a high-level folder.

The General Tasks page is a single continuous hierarchical page. It must not behave like a file browser where opening a folder hides the rest of the hierarchy.

### 4.2 This Week

A task placed in This Week means:

> I intend to make progress on this task during this week.

No duration is required.

No calendar block is required.

A task may be in This Week without being assigned to a specific day.

### 4.3 Today

A task placed in Today means:

> I intend to work on this task today.

No duration is required.

No work session is required.

### 4.4 Calendar / Work Sessions

A task becomes time-blocked only when one or more Work Sessions are created.

A work session specifies:
- date,
- start time,
- end time or session length.

The session length is not assumed to be the total task duration.

---

## 5. Task Data Model

### Required

- title
- completion state

### Optional

- folder
- priority
- due date
- due time
- planned week
- planned day
- estimated total duration
- notes / description
- tags
- subtasks / checklist
- recurring rule
- reminders
- work sessions
- created timestamp
- modified timestamp

### Priority

Supported values:

- None
- P1 — Critical
- P2 — High
- P3 — Normal
- P4 — Low

Priority is independent from due date.

### Estimated Duration

Estimated total duration is optional.

A task may remain “Unknown” forever.

If an estimate exists, the UI may show approximate remaining effort based on completed work sessions, for example:

`2h worked · ~4h estimated remaining`

If no estimate exists, the UI should not invent a remaining duration.

### Completion

Only the user decides when the task itself is complete.

Completing a work session does not complete the task.

Completed tasks:
- remain visible by default,
- use muted styling,
- use strikethrough,
- can be hidden with a view option.

---

## 6. General Tasks Page

The General Tasks page renders the full recursive hierarchy on one page.

Example:

```text
GENERAL TO-DO

▼ School
   ▼ CPEN 311
      ▼ Labs
         ☐ Finish Lab 2 report              P1   Due Fri
         ☐ Prepare Lab 3                    P2

      ▼ Lectures
         ☐ Review Lecture 6                 P3

   ▼ ELEC 3XX
      ☐ Assignment 1                       P1   Due Oct 8

▼ Career
   ▼ Co-op
      ▼ Applications
         ☐ Apply to AMD                     P1
         ☐ Review job board                 P2

   ☐ Message recruiter                     P2

▼ Personal
   ☐ Buy groceries                         P4
```

### Required behavior

- recursive folder nesting,
- inline expand/collapse,
- remember collapsed state,
- Expand All,
- Collapse All,
- drag tasks between folders,
- drag folders between folders,
- manual ordering by default,
- optional sorting:
  - priority,
  - due date,
  - created date,
  - alphabetical,
- create task inside any folder,
- create subfolder inside any folder,
- tasks may exist directly at any folder level,
- search preserves hierarchy,
- filters preserve hierarchy.

### Optional alternate view

A flat “All Tasks” view may show all matching tasks without hierarchy.

The hierarchical view remains the default.

---

## 7. Inbox

Inbox is a zero-friction capture area.

Creating a task in Inbox requires only a title.

The user may organize it later by:
- moving it into a folder,
- assigning a priority,
- adding a due date,
- placing it in This Week,
- placing it in Today,
- scheduling a work session.

---

## 8. This Week View

This Week is a planning workspace, not a calendar.

Its purpose is to answer:

> What do I want to make progress on this week?

Tasks can be grouped by:
- folder,
- priority,
- day if assigned,
- custom order.

A task does not need:
- duration,
- scheduled session,
- exact day.

Moving a task into This Week must not duplicate it.

---

## 9. Today View

Today combines a daily task list and a daily schedule.

### Desktop layout

Preferred layout:

```text
┌──────────────┬────────────────────────────┬───────────────────────────────┐
│ Navigation   │ Today's Tasks              │ Today's Schedule              │
│              │                            │                               │
│ Today        │ Overdue                    │ 08:00                         │
│ This Week    │ ☐ Submit application       │                               │
│ Tasks        │                            │ 09:00 Lecture                 │
│ Calendar     │ Today                      │                               │
│              │ ☐ Finish lab               │ 12:00 Lunch                   │
│ folders      │ ☐ Review notes             │                               │
│              │                            │ 15:00 Work on Lab             │
│              │ Scheduled                  │                               │
│              │ ✓ Email professor          │ 18:00 Gym                     │
└──────────────┴────────────────────────────┴───────────────────────────────┘
```

### Required behavior

- drag task from Today into timeline,
- create a work session when dropped,
- prompt for session length,
- session length may be:
  - 30 min,
  - 1 hour,
  - 1.5 hours,
  - 2 hours,
  - custom,
- default session length is user-configurable,
- resize scheduled work sessions,
- move work sessions,
- complete a work session independently,
- keep underlying task unfinished unless user completes it,
- show Overdue section,
- show Today section,
- show Scheduled section,
- show Completed section.

---

## 10. Calendar

Calendar views:

- Year
- Month
- Week
- Day

Week is the preferred default desktop view.

### Calendar item types

Calendar should visually distinguish:

1. normal events,
2. recurring events,
3. task work sessions,
4. deadlines,
5. weekly-template occurrences,
6. external calendar events.

### Deadlines

A due date is not the same as a work session.

Example:

- Assignment due Friday at 23:59.
- Work sessions scheduled Tuesday and Thursday.

Friday should still display a deadline marker.

### Drag and resize

Users must be able to:
- drag events,
- drag work sessions,
- resize duration,
- move between days.

### New calendar item

The user can create:
- standalone event,
- work session for an existing task,
- new task plus work session.

---

## 11. Weekly Template

Weekly Template supports recurring baseline schedules.

Example:

```text
MONDAY
10:00–11:00 CPEN 311 Lecture
12:00–13:00 Lunch
14:00–15:30 ELEC Lecture

TUESDAY
09:00–11:00 CPEN Lab
```

### Required fields

- title
- day(s) of week
- start time
- end time
- active start date
- active end date
- optional folder/category
- optional reminders

### Occurrence editing

Support:
- edit only this occurrence,
- cancel only this occurrence,
- edit this and future occurrences,
- edit entire series.

Multiple weekly templates may exist, for example:
- Fall Term,
- Winter Term,
- Summer,
- Work Schedule.

---

## 12. Reminders and Notifications

### Reminder presets

- at event time
- 5 minutes before
- 10 minutes before
- 30 minutes before
- 1 hour before
- 1 day before
- custom

### Task reminders

Task reminders are independent from due dates.

### Work-session reminders

A work session can have its own reminder even if the task has no reminder.

### Recurring reminders

Recurring items inherit reminder rules.

### Overdue behavior

Do not repeatedly nag the user.

Overdue tasks should:
- appear clearly in Today,
- optionally appear in a once-daily summary.

Optional daily summary may include:
- overdue count,
- tasks due today,
- tasks planned today.

### Snooze

Suggested snooze presets:
- 10 minutes,
- 30 minutes,
- 1 hour,
- tomorrow.

---

## 13. Navigation

Primary destinations:

- Today
- This Week
- Tasks
- Calendar
- Weekly Template
- Account & Settings

Quick Add must be accessible from all primary screens.

### State preservation

Switching pages must preserve local UI state where practical.

Examples:
- Tasks remembers scroll position.
- Tasks remembers expanded/collapsed folders.
- Calendar remembers selected date and view.
- This Week remembers scroll position and filters.

Navigation should feel like an application, not separate page loads.

---

## 14. Responsive Layout

### Desktop

- collapsible left sidebar,
- multi-pane Today layout,
- full Week calendar,
- task inspector in a side panel,
- drag-and-drop optimized.

### iPad Landscape

Near-desktop experience with narrower sidebar.

### iPad Portrait

Two-pane layout where practical.

Navigation sidebar may become a slide-over panel.

### iPhone

Do not shrink the desktop UI.

Use:
- bottom navigation,
- single-column content,
- bottom sheets for task/event editing,
- swipe-friendly day navigation,
- compact timeline,
- touch-friendly drag and scheduling interactions where practical.

Suggested bottom navigation:

- Today
- Week
- Tasks
- Calendar

Secondary destinations may live under a menu.

---

## 15. Quick Add

Quick Add is available everywhere.

Minimum interaction:
- type task title,
- press Enter,
- task is captured immediately.

Future-friendly parsing may support inputs such as:

`Finish assignment Friday 5pm`

Natural-language parsing is optional for initial implementation but the architecture should not prevent it.

---

## 16. Task Editor

Clicking a task should open a side inspector on desktop and a sheet on mobile.

Avoid presenting every field at once.

### Common fields

- title
- completed
- folder
- priority
- due date/time
- planned week
- planned day
- reminders

### Additional fields under More Options

- estimated total duration
- notes
- tags
- checklist
- recurrence
- work sessions
- metadata

---

## 17. Search and Filtering

Search should work across:
- task titles,
- notes,
- folders,
- tags.

When in hierarchical mode, search results should preserve relevant ancestor folders.

Filters may include:
- priority,
- due date,
- overdue,
- planned week,
- planned day,
- folder,
- completed,
- uncompleted,
- tag.

---

## 18. Account Model

Account creation must not be required for basic local use.

Initial choices:

- Continue locally
- Create account
- Sign in

A local user may create an account later and synchronize existing local data.

### Authentication

Preferred:
- passkeys,
- email magic links.

Avoid requiring a traditional password database unless technically necessary.

---

## 19. Local-First Storage

Every supported device should maintain a local working copy.

### Windows desktop

Use private application storage managed by the app.

### Web / PWA

Use browser-managed local storage such as IndexedDB.

### iOS native wrapper in the future

Use the app sandbox/private application storage.

User data is not stored as individual task files in File Explorer.

The app remains usable without internet access.

Changes should:
1. save locally immediately,
2. update the UI immediately,
3. synchronize in the background when connectivity is available.

---

## 20. Synchronization

Planstrand's own account/sync system is the source of truth for Planstrand data.

Apple or Google must not be the primary database.

Sync model:

```text
Device local data
      ↓
Encrypt
      ↓
Planstrand Sync
      ↓
Other devices
      ↓
Decrypt locally
```

### Conflict handling

Where possible:
- merge changes made to different fields,
- use deterministic conflict resolution for same-field changes,
- preserve enough history to recover from destructive conflicts.

Significant unresolved conflicts may appear in a Sync Issues area.

---

## 21. Privacy and Security

Personal synchronized content should use end-to-end encryption by default.

Content that should be encrypted before upload includes:
- task titles,
- notes,
- descriptions,
- events,
- schedules,
- folders,
- tags,
- weekly templates,
- work-session details.

The sync server should retain only the minimum metadata necessary for operation.

### Security requirements

- HTTPS/TLS,
- no secrets committed to the public repository,
- no production credentials in source code,
- environment secrets stored outside Git,
- passkey or magic-link authentication where practical,
- device management,
- sign out one device,
- sign out all other devices,
- recovery mechanism,
- account deletion,
- server-side synchronized-data deletion,
- analytics disabled by default,
- no advertising SDKs,
- no sale of user data.

### Repository safety

The public repository must never include:
- account databases,
- user calendars,
- user tasks,
- production environment files,
- OAuth client secrets,
- encryption keys,
- recovery keys,
- production database passwords.

Commit only templates such as `.env.example` with fake values.

---

## 22. Recovery and Encryption Keys

Strong end-to-end encryption means the service operator may not be able to recover encrypted content.

Planstrand should support a recovery mechanism such as:
- recovery key,
- recovery file,
- trusted-device transfer.

The user should be clearly informed that loss of all recovery methods may make encrypted synchronized data unrecoverable.

---

## 23. Devices

Account settings should show signed-in devices.

Example:

```text
Windows Laptop     This device
iPhone             Active recently
iPad               Yesterday
```

Supported actions:
- sign out device,
- sign out all other devices.

---

## 24. Backups and Export

Synchronization is not a backup.

Planstrand should support automatic local snapshots.

Example:

```text
Today 15:00
Today 09:00
Yesterday
Sep 27
Sep 26
```

### Export

Support:
- encrypted Planstrand backup,
- readable backup/export with a clear warning,
- future-friendly JSON/CSV export where appropriate.

Encrypted export should be the recommended/default backup choice.

### Restore

Users should be able to restore from a compatible Planstrand backup.

---

## 25. Trash and Deletion

Deleting tasks, folders, and events should normally move them to Trash.

Suggested retention:
- 30 days by default.

Users can:
- restore,
- permanently delete,
- empty Trash manually.

Large destructive operations should support Undo where practical.

---

## 26. External Calendar Integrations

External calendars are optional integrations.

Planstrand remains fully functional without Google or Apple integration.

Potential integration behavior:

- show external calendar events inside Planstrand,
- optionally export selected Planstrand events,
- optionally export selected task work sessions,
- keep private planning sessions local unless user explicitly chooses otherwise.

External calendar items must be visually identifiable.

Examples:
- Planstrand calendar
- Google calendar
- Apple / CalDAV calendar

Users may toggle external calendars independently.

---

## 27. Apple Watch Strategy

V1 does not require a native watchOS app.

Initial Apple Watch visibility may be provided through supported external calendar integration.

A dedicated watchOS companion can be considered later.

---

## 28. Platform Strategy

Primary development strategy:

1. Web/PWA
2. Windows desktop package
3. iPhone/iPad PWA
4. Optional native iOS packaging later
5. Optional watchOS companion later

The project should preserve as much shared code as practical across platforms.

---

## 29. Visual Design Direction

Planstrand should feel like a calm, polished personal planner rather than a generic SaaS dashboard.

Reference qualities:
- restrained,
- editorial,
- information-dense without feeling crowded,
- subtle hierarchy,
- responsive,
- native-feeling interactions.

### Avoid

- excessive gradients,
- glassmorphism,
- glowing cards,
- oversized pills,
- decorative blobs,
- giant dashboard cards,
- unnecessary animations,
- emoji-heavy UI,
- overly saturated color coding.

### Prefer

- warm off-white / neutral light theme,
- true dark mode,
- thin dividers,
- restrained card use,
- small-to-medium corner radii,
- one consistent icon family,
- clear typography,
- subtle category colors,
- priority indicators rather than full-row priority colors,
- generous but efficient spacing,
- 150–200 ms transitions where appropriate.

### Density

Support:
- Comfortable
- Compact

---

## 30. Appearance

Settings should include:
- light mode,
- dark mode,
- system mode,
- accent color,
- comfortable / compact density,
- week-start preference,
- default work-session length,
- default reminder behavior.

---

## 31. Account & Settings Screen

Suggested sections:

### Account
- name
- email
- local-only / signed-in status

### Sync
- sync status
- last sync time
- end-to-end encryption state

### Devices
- device list
- revoke device
- sign out all other devices

### Security
- passkeys
- recovery key
- recovery options

### Backup & Data
- export encrypted backup
- export readable backup
- restore backup
- Trash
- delete synchronized data
- delete account

### Calendar Connections
- Google Calendar
- Apple / CalDAV-compatible integration

### Privacy
- analytics
- crash reports
- optional diagnostics

---

## 32. Performance and Interaction Requirements

- task completion should feel instant,
- creating a task should feel instant,
- drag-and-drop should feel responsive,
- switching primary views should preserve state,
- offline usage should remain functional,
- synchronization must not block local interaction,
- mobile UI must not simply be a scaled-down desktop layout.

---

## 33. V1 Scope

V1 should include:

1. recursive folders,
2. Inbox,
3. master hierarchical task page,
4. priority,
5. optional due dates,
6. optional estimated duration,
7. This Week,
8. Today,
9. multiple work sessions per task,
10. standalone calendar events,
11. Year / Month / Week / Day calendar views,
12. recurring events,
13. weekly templates,
14. drag-and-drop scheduling,
15. resizable work sessions,
16. manual task completion,
17. work-session completion separate from task completion,
18. reminders,
19. overdue handling,
20. responsive desktop/tablet/mobile layout,
21. light/dark mode,
22. compact/comfortable density,
23. local-first persistence,
24. account sign-in,
25. encrypted synchronization,
26. device management,
27. backup/export/restore,
28. Trash,
29. optional external calendar integrations,
30. public open-source repository with secrets excluded.

---

## 34. Explicit V1 Non-Goals

The following are not required for the first usable version:

- AI automatic scheduling,
- automatic duration estimation,
- collaboration/team workspaces,
- habit tracking expansion,
- advanced analytics,
- social features,
- mandatory cloud account,
- native watchOS app,
- App Store distribution,
- paid subscriptions,
- advertising,
- complex project-management features such as Gantt charts.

These may be reconsidered later.

---

## 35. Core Product Rules

The following rules must remain true throughout development:

1. A task is not duplicated when moved between Master, This Week, Today, and Calendar.
2. A task does not need a known duration.
3. A work session duration is not assumed to be the task's total duration.
4. One task may have many work sessions.
5. Completing a work session does not automatically complete its task.
6. A due date is not the same thing as a scheduled work session.
7. Folders may recursively contain both tasks and folders.
8. The General Tasks page shows the hierarchy inline on one page.
9. Local interaction must not depend on an active network connection.
10. Google and Apple integrations are optional; Planstrand owns its own data model.
11. Synchronized private content should be encrypted before leaving the device.
12. User data and secrets must never be committed to the public repository.
13. Mobile layouts must be purpose-built rather than desktop layouts scaled down.
14. The interface should remain visually restrained and professional.

---

## 36. Product Identity

**Name:** Planstrand

The name represents separate strands of tasks, events, deadlines, weekly intentions, and scheduled work being brought together into one coherent plan.
