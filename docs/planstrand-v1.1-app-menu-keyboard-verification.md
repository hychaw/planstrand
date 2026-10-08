# V1.1 app-menu keyboard focus correction

Baseline: `feature/v1.1-blue-thread` at
`c5a2bfbc71317f606a08b468fbabaf630a2ac776`.

## Confirmed cause

Search scheduled unconditional input focus 100 ms after initialization. The user
could open Utilities, dismiss it, focus App menu, and press Enter during that
interval. The delayed callback either moved focus to Search before Enter (so
Enter targeted the input), or stole initial Settings focus after the menu opened.
The failing browser focus-event stacks point directly to Search's timeout
callback. Overlay teardown, menu keyboard handling, and Settings routing were not
the source of the race.

An instrumented reproduction against the baseline failed 4/5 times. Against the
corrected build, the same reproduction passed 5/5. These diagnostic runs are
separate from the acceptance runs below.

## Correction

Search now sets initial focus with Angular's `afterNextRender`, when the input
exists, rather than a delayed timer. It respects a focus change made while the
view was rendering. Angular cancels the registered callback when the component
is destroyed. There is no later callback to reclaim focus from the shell or a
menu item.

Three unit regressions cover initial focus, respecting later/before-render focus
changes, and destruction before rendering. The shell E2E check now exercises
Enter/Space opening, Settings initial focus, arrow navigation, reversible header
Tab order, Tab/Shift+Tab menu exit, Escape restoration, and Enter activation of
Settings with route/menu-close assertions. It uses observable focus/visibility
conditions; no arbitrary sleep, increased timeout, retry, or skipped assertion
was added.

## Separate development-harness issues

1. **Dependency notices:** plain `ng serve` with the development configuration
   does not extract/publish `3rdpartylicenses.txt`. The earlier full run's HTTP
   404 was a missing build artifact. Prepared builds must extract licenses and
   run the existing `tools/publish-licenses.js`. The shell check still requires
   both upstream and dependency notices to return successfully and contain
   copyright notices. Production already performs extraction/publication.
2. **Optional version tooltip:** without generated git metadata, Settings
   intentionally omits its `title` attribute. Playwright returns `null`; a
   string matcher rejects that value before checking its contents. The test now
   normalizes an absent tooltip to an empty string while retaining every
   prohibited-version/placeholder assertion. Product version behavior is unchanged.

For a reproducible static development server, run from the repository root:

```text
npx ng build --configuration development --extract-licenses=true --output-path .tmp/planstrand-e2e
node tools/publish-licenses.js .tmp/planstrand-e2e
npx http-server .tmp/planstrand-e2e/browser -p 4242 -c-1 --proxy http://localhost:4242?
```

In a second PowerShell terminal:

```powershell
$env:E2E_BASE_URL = 'http://localhost:4242'
npx playwright test --config e2e/playwright.config.ts e2e/tests/planstrand --project chromium --workers 1 --retries 0
npx playwright test --config e2e/playwright.config.ts e2e/tests/planstrand/final-cleanup.spec.ts --grep 'focused shell' --project chromium --workers 1 --retries 0 --repeat-each 20
```

This also exercises the valid missing-revision presentation without modifying the
tracked generated-version file. Install the project's Playwright Chromium first
if it is not already available. The recorded runs used installed Chrome through
an ignored config override, with browser/worker timezone Europe/Berlin and
explicit test timezone overrides retained (including Vancouver).

## Validation

- Expanded keyboard/shell acceptance test: **20/20 consecutive passes**, one
  Chromium worker, zero retries and zero skips; 2.4 minutes.
- Complete prepared-build Planstrand browser suite: **28/28 passed**, one worker,
  zero retries/skips; 198.6 seconds. This includes Task drag, nested Folders,
  repeated WorkSessions, Vancouver DST position/tooltip/persistence, independent
  completion, rollover, move/resize, and reload checks.
- Version/About regression against the production build with no generated git
  revision: **1/1 passed**, confirming the valid absent-tooltip case.
- Search, Settings, and product-info unit tests: **47/47 passed**.
- Full lint, application TypeScript, formatting, and production build passed.
  The existing initial-bundle budget warning remains (5.57 MB versus 5.50 MB).
- A broader unit run hit **19 existing MainHeader fixture failures** before test
  behavior: its hand-written Store mock lacks `selectSignal`, required by the
  unchanged PlanstrandService. The header/spec/service are unchanged from the
  baseline; these fixtures were not rewritten as part of this focused correction.

Local evidence is retained in ignored `.tmp/app-menu-focus-before*`,
`.tmp/app-menu-focus-after*`, `.tmp/app-menu-keyboard-20*`,
`.tmp/app-menu-keyboard-full*`, `.tmp/app-menu-keyboard-focused-unit.log`,
`.tmp/app-menu-keyboard-missing-revision*`,
`.tmp/app-menu-keyboard-unit.log`, `.tmp/app-menu-keyboard-lint.log`, and
`.tmp/app-menu-keyboard-production-build.log`.

The user reported all manual Electron acceptance checks passed before this
correction. This verification changes Search focus lifecycle and test coverage
only; Task/Planning/WorkSession, schema, persistence, and sync are untouched.
No merge, publication, or V1 release-tag change is included.
