# Planstrand Design System

## V1.1 — Blue Thread

Blue Thread is the default Planstrand identity on every platform. V1.1 supersedes
the initial neutral palette, system-first typography and temporary calendar icon
described in the original V1 guidance below.

- Deep Navy `#0B1220`, Cobalt `#2563EB`, Azure `#60A5FA`, Light Azure `#BFDBFE`.
- Light: cool pale-blue canvas, near-white working surfaces, blue selection.
- Dark: blue-black canvas, layered navy working and floating surfaces.
- Inter Variable, bundled locally with its SIL Open Font License; use weight and
  spacing for hierarchy and tabular numerals for calendar/time/duration.
- Canvas → Working Surface → Floating Surface. Reuse the existing `--surface-*`,
  ink and Material token contract. `src/styles/blue-thread.scss` supplies defaults;
  user-installed themes can still override public body-scoped primitives.
- Comfortable uses 48px task rows; Compact uses 36px rows with unchanged type.
  Coarse-pointer devices keep 48px rows. Appearance stores density on this device,
  outside synced config, domain entities and the operation log.
- State transitions: 140–160ms; panel entry: 200ms; exit: 180ms. Honor the existing
  disable-animation preference and `prefers-reduced-motion`.
- The Strand P master is `src/assets/icons/strand-p.svg`: a single flowing blue
  strand on a navy rounded square. Run `node tools/generate-planstrand-icons.cjs`
  from the repository root to regenerate web/PWA and desktop artwork. macOS uses
  a larger transparent inset; Safari uses a monochrome strand mask.

Retain upstream attribution and application/profile/protocol identifiers. The
technical release version and V1.0.0-rc.1 tag are independent of this visual work.

## 1. Design Intent

Planstrand should feel like a thoughtfully designed personal planning tool, not a generic dashboard.

The interface should be:

- calm,
- precise,
- visually restrained,
- information-rich,
- easy to scan,
- comfortable for long daily use.

The visual system should support serious planning without making ordinary tasks feel heavy.

---

## 2. Design References

Use the interaction quality and restraint found in polished modern planning applications as inspiration, especially:

- calendar/task side-by-side planning,
- editorial spacing,
- subtle hierarchy,
- quiet surfaces,
- smooth direct manipulation.

Do not copy another product’s interface or assets.

Planstrand should develop its own recognizable visual identity.

---

## 3. Anti-Patterns

Avoid:

- prominent gradients as default decoration,
- glassmorphism,
- glowing surfaces,
- excessive shadows,
- giant rounded cards,
- every control being a pill,
- decorative blobs,
- emoji as primary navigation icons,
- excessive saturation,
- dashboard-style metric cards where no metric is needed,
- gratuitous animation,
- large hero typography inside productivity views,
- dense nested borders.

---

## 4. Core Visual Metaphor

Planstrand brings separate strands of planning into one coherent timeline.

This should influence the interface subtly:

- fine accent lines,
- connected hierarchy,
- continuity between task → week → day → session,
- category accents that follow an item across views.

Do not turn the strand metaphor into literal rope illustrations throughout the UI.

---

## 5. Color Philosophy

Color communicates meaning, not decoration.

Use:

- neutral backgrounds,
- subtle elevated surfaces,
- restrained accent colors,
- category colors,
- small priority indicators,
- semantic warning/error/success colors.

Do not fill an entire task row bright red because it is P1.

### Semantic token categories

Define theme tokens rather than hard-coding colors into components:

```text
--surface-canvas
--surface-primary
--surface-secondary
--surface-hover
--surface-selected

--text-primary
--text-secondary
--text-muted
--text-disabled

--border-subtle
--border-strong

--accent-primary
--accent-soft

--priority-p1
--priority-p2
--priority-p3
--priority-p4

--status-success
--status-warning
--status-danger
--status-info
```

Both light and dark themes must map to the same semantic tokens.

---

## 6. Light Theme

Light mode should use a warm neutral canvas rather than an aggressively bright white page.

Primary content surfaces may be slightly lighter than the canvas.

Use contrast through:

- typography,
- spacing,
- subtle dividers,
- selected-state fills.

Avoid outlining every container.

---

## 7. Dark Theme

Dark mode should be genuinely dark and comfortable.

Avoid:

- pure black for every surface,
- neon category colors,
- low-contrast grey-on-grey text.

Hierarchy should remain clear without relying on heavy borders.

---

## 8. Typography

Use a clean system-oriented sans-serif stack unless the existing application has a strong compatible type system.

Priorities:

- excellent legibility,
- clear numerical alignment,
- compact task scanning,
- strong calendar readability.

Suggested hierarchy:

### Page title

Prominent but not oversized.

### Section heading

Medium weight, compact spacing.

### Task title

Normal/medium weight.

### Metadata

Smaller and muted.

### Calendar time

Compact, stable-width where possible.

Use weight and spacing before introducing additional colors.

---

## 9. Spacing

Use a consistent spacing scale.

Suggested conceptual scale:

```text
2
4
8
12
16
20
24
32
40
48
```

Prefer 8px-based spacing for primary layout, with smaller values for fine alignment.

---

## 10. Radius

Use small-to-medium radii.

Suggested roles:

- small controls: subtle radius,
- task/session cards: modest radius,
- dialogs/sheets: slightly larger radius.

Avoid making every element look like a capsule.

---

## 11. Shadows

Use shadows sparingly.

Appropriate uses:

- floating inspector,
- modal,
- mobile bottom sheet,
- drag preview,
- elevated menu.

Most normal layout separation should use spacing or dividers instead.

---

## 12. Icons

Use one consistent professional icon set.

Icons should:

- use a consistent stroke/fill style,
- be visually balanced at small sizes,
- have labels/tooltips where meaning may be ambiguous.

Do not mix unrelated icon families.

---

## 13. Motion

Default transitions should generally feel immediate.

Typical duration:

```text
150–200 ms
```

Use motion for:

- panel entry,
- expand/collapse,
- drag feedback,
- selected-state transitions,
- sheet/modal transitions.

Respect reduced-motion settings.

Do not animate every list update.

---

## 14. Density

Support two density modes.

### Comfortable

For touch devices and relaxed desktop use.

### Compact

For users who want more tasks and calendar detail visible simultaneously.

Density should affect:

- row height,
- vertical gaps,
- sidebar spacing,
- metadata spacing.

It should not make text uncomfortably small.

---

## 15. Desktop Shell

Preferred desktop structure:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Top bar: context / search / quick add / account                     │
├──────────────┬───────────────────────────────────────────────────────┤
│ Sidebar      │ Main workspace                                        │
│              │                                                       │
│ Today        │                                                       │
│ This Week    │                                                       │
│ Tasks        │                                                       │
│ Calendar     │                                                       │
│ Templates    │                                                       │
│              │                                                       │
│ Folder tree  │                                                       │
└──────────────┴───────────────────────────────────────────────────────┘
```

The sidebar should be collapsible.

---

## 16. Today Layout

Desktop Today should support three conceptual regions:

1. navigation,
2. task plan,
3. time schedule.

Example:

```text
┌──────────────┬──────────────────────┬──────────────────────────┐
│ Navigation   │ Today's Tasks        │ Day Timeline             │
│              │                      │                          │
│              │ Overdue              │ 09:00 Lecture            │
│              │ Today                │                          │
│              │ Scheduled            │ 15:00 Work Session       │
│              │ Completed            │                          │
└──────────────┴──────────────────────┴──────────────────────────┘
```

Task-to-calendar drag should feel direct.

---

## 17. Tasks Page

The task hierarchy is one continuous page.

Folders should read as structured section headings, not operating-system directories.

Use hierarchy through:

- indentation,
- font weight,
- whitespace,
- subtle disclosure icons,
- occasional divider lines.

Do not use heavy tree connectors unless usability testing proves they help.

### Example

```text
School

  CPEN 311
  ─────────────────────────────

    Labs
      ☐ Finish Lab 2 report      P1   Fri
      ☐ Prepare Lab 3            P2

    Lectures
      ☐ Review Lecture 6         P3
```

---

## 18. Folder Interaction

Each folder row may expose context actions on hover/focus/selection:

- Add Task
- Add Folder
- More

On touch devices these actions must be available through an explicit button/menu.

Expanded/collapsed state should be visually obvious but quiet.

---

## 19. Task Row

A task row should prioritize:

1. completion control,
2. task title,
3. compact metadata.

Potential metadata:

- priority,
- due date,
- planned state,
- tags,
- work-session indicator.

Do not show every optional field all the time.

Completed task:

- strikethrough title,
- muted text,
- reduced emphasis,
- still readable.

---

## 20. Priority Display

Priority should use a small consistent indicator.

Examples:

- tiny colored marker,
- compact `P1` label,
- flag icon.

Do not color the entire task background according to priority.

---

## 21. Task Inspector

Desktop:

- right-side inspector.

Mobile:

- bottom sheet or full-screen editor.

The initial view should show only common fields.

Less common fields live under “More options”.

Avoid a giant form.

---

## 22. This Week View

This Week should feel like planning, not like a second calendar.

Use day columns or grouped planning sections while keeping unscheduled weekly tasks easy to see.

The design must visually communicate:

- planned for week,
- planned for specific day,
- scheduled on calendar

as distinct states.

---

## 23. Calendar Views

Support:

- Year
- Month
- Week
- Day.

### Week

Primary detailed planning view on desktop.

### Month

Prioritize deadlines, events, and high-level load.

### Year

High-level navigation and long-range awareness, not dense task rendering.

### Day

Detailed execution timeline.

---

## 24. Calendar Item Styling

Visually distinguish:

### Normal event

Solid or softly filled calendar block.

### Work session

Task indicator plus category accent.

### Deadline

Compact marker/banner, not a fake duration block.

### Weekly-template item

Normal calendar presence with subtle recurring/template indicator.

### External event

Source-aware styling or icon.

Color must not be the only distinguishing mechanism.

---

## 25. Work Session Scheduling

Dragging an unscheduled task onto the timeline should:

1. show a clear drop preview,
2. create a session at the drop time,
3. open a compact duration choice if needed,
4. preserve the underlying task.

Resize handles should be easy to discover without permanently cluttering the block.

---

## 26. Quick Add

Quick Add should be reachable globally.

Desktop:

- top-bar button,
- keyboard shortcut.

Mobile:

- prominent but restrained action.

Opening Quick Add should focus the title field immediately.

Creating a basic task should require only:

- type,
- Enter.

---

## 27. Search

Search should feel lightweight and immediate.

Results in hierarchical mode retain ancestor context.

Matched text may be subtly highlighted.

Do not replace the entire page with visually unrelated search cards.

---

## 28. Empty States

Empty states should be concise and useful.

Example:

```text
Nothing planned for today.

Add a task, or pull one in from This Week.
```

Avoid oversized illustrations unless they add real value.

---

## 29. Feedback States

Use compact feedback for:

- saving,
- sync state,
- offline state,
- errors,
- undo.

Normal local edits should not display intrusive “Saved!” notifications.

---

## 30. Sync Indicator

Sync status should be available but quiet.

Possible states:

- Up to date
- Syncing
- Offline
- Needs attention

A healthy sync state should not dominate the interface.

---

## 31. Mobile Navigation

Suggested primary bottom navigation:

- Today
- Week
- Tasks
- Calendar

Additional destinations:

- Weekly Templates
- Settings
- Account

may live under a menu/profile entry.

---

## 32. iPhone Layout

Use single-column layouts.

Prefer:

- native-feeling sheets,
- swipe navigation between days,
- large enough touch targets,
- compact metadata,
- vertical schedule timeline.

Do not expose desktop hover-only actions.

---

## 33. iPad Layout

### Landscape

Near-desktop experience.

### Portrait

Two-pane layout where useful.

Sidebars may become overlays to preserve workspace width.

---

## 34. Accessibility

Minimum requirements:

- strong keyboard navigation,
- visible focus ring,
- semantic HTML,
- appropriate ARIA labels,
- contrast-conscious palette,
- non-color status cues,
- reduced-motion support,
- minimum practical touch target sizes.

---

## 35. Responsive Breakpoints

Use content-driven breakpoints, not device branding assumptions.

The layout should adapt based on available width.

Conceptually:

- wide: sidebar + multi-pane,
- medium: sidebar + two-pane,
- narrow: single-column + bottom navigation/sheets.

---

## 36. Loading Behavior

Prefer skeletons or retained previous content where loading is genuinely needed.

For local-first data, most normal screen transitions should not show loading spinners.

---

## 37. Error Design

Errors should explain:

- what failed,
- what remains safe,
- what the user can do next.

Example:

```text
Sync is temporarily unavailable.
Your changes are saved on this device and will retry automatically.
```

Avoid alarming users when local data remains safe.

---

## 38. Destructive Actions

Use confirmation for genuinely destructive actions such as:

- empty Trash,
- permanently delete folder with contents,
- delete account,
- delete synchronized data.

Normal soft deletion should offer Undo instead of unnecessary modal confirmation.

---

## 39. Brand Identity

Product name:

**Planstrand**

The name may appear as a simple wordmark initially.

Do not create a complex logo system before the core UI is stable.

A future icon may explore:

- a subtle woven line,
- intersecting timeline strands,
- linked planning paths.

It should remain legible at small app-icon sizes.

---

## 40. Design Review Checklist

Before accepting a new interface:

- Does it look consistent with the rest of Planstrand?
- Is the information hierarchy obvious?
- Are there unnecessary boxes?
- Is color serving meaning?
- Does it work in dark mode?
- Does it work in compact mode?
- Does it remain usable with keyboard only?
- Is the mobile behavior intentional?
- Is an animation helping orientation rather than decoration?
- Does it preserve the distinction between task, plan, deadline, event, and work session?
- Could a user understand the screen without reading documentation?

---

## 41. Source Documents

Visual implementation should remain consistent with:

- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`

When implementing a new screen, prioritize coherence with these documents over adding one-off styling patterns.
