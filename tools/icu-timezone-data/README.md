# ICU timezone data for Windows Electron

Electron 43.5.0 bundles ICU 78.2 with tzdb 2025c. It predates British Columbia's
permanent UTC-07:00 rules. Mapping the new Windows ID alone fixes October, but
still incorrectly returns to UTC-08:00 on November 1, 2026.

These four unmodified little-endian resources are the first official release
containing the BC change, tzdb 2026b (ICU 4.4+ resource format). Source is pinned
to Unicode's commit `d7d6dd5bb68930c5e6b3dd4491574153d3a1ba5a`:

https://github.com/unicode-org/icu-data/tree/d7d6dd5bb68930c5e6b3dd4491574153d3a1ba5a/tzdata/icunew/2026b/44/le

SHA-256 values are in `manifest.json`; redistribution terms are in
`LICENSES/unicode-icu-timezone.txt` at the repository root (included in desktop
packages). Total resource size is 235,936 bytes. No executable code is vendored.

`update-electron-timezone-data.cjs` replaces only these resources in `icudtl.dat`,
preserving all other resources and their names. It validates the package format,
alignment and checksums, and refuses unknown formats. Equal or newer timezone
data is left alone. Windows `electron:build` updates the development runtime;
the Windows `afterPack` hook updates the packaged runtime before distribution.
No downloads occur during builds or at runtime.

ICU documents this data-only update procedure:
https://unicode-org.github.io/icu/userguide/datetime/timezone/#icu4c-tz-update-of-a-dat-package-file

`ICU_TIMEZONE_FILES_DIR` was tested and rejected: supplying it before Electron
launch updates main-process Intl but the sandboxed renderer still uses the
bundled data. Setting it from main.ts is also too late for ICU initialization.
Patching Date/Intl in JavaScript or using a permanent offset/another city's zone
would require broader changes and risk breaking historical rules.

When Electron eventually includes both current tzdb and the BC Windows mapping,
this bridge can be removed after running the native timezone regressions. A
runtime with newer tzdb is never downgraded by this updater.
