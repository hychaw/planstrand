const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  updateTimeZoneData,
  updateTimeZoneFile,
  readPackage,
  timeZoneVersion,
} = require('./update-electron-timezone-data.cjs');
const manifest = require('./icu-timezone-data/manifest.json');
const installed = fs.readFileSync(
  path.join(
    path.dirname(require('electron')),
    process.platform === 'darwin'
      ? '../Frameworks/Electron Framework.framework/Resources/icudtl.dat'
      : 'icudtl.dat',
  ),
);

const resources = (data) => {
  const { entries } = readPackage(data);
  return new Map(
    entries.map((entry, index) => [
      entry.name,
      data.subarray(entry.start, entries[index + 1]?.start ?? data.length),
    ]),
  );
};
const withVersion = (version) => {
  const copy = Buffer.from(installed);
  const { entries } = readPackage(copy);
  const zone = entries.find((entry) => entry.name.endsWith('/zoneinfo64.res'));
  const original = timeZoneVersion(resources(copy).get(zone.name));
  assert.equal(original.length, version.length);
  const at = copy.indexOf(Buffer.from(original, 'utf16le'), zone.start);
  copy.write(version, at, 'utf16le');
  return copy;
};

test('updates all four resources and preserves every unrelated ICU resource byte for byte', () => {
  const stale = withVersion('2025c');
  const updated = updateTimeZoneData(stale);
  const before = resources(stale),
    after = resources(updated);
  assert.deepEqual([...after.keys()], [...before.keys()]);
  for (const [name, bytes] of after) {
    const shortName = name.slice(name.indexOf('/') + 1);
    if (Object.hasOwn(manifest.sha256, shortName)) {
      const official = fs.readFileSync(
        path.join(__dirname, 'icu-timezone-data/2026b', shortName),
      );
      assert.deepEqual(bytes.subarray(0, official.length), official);
    } else assert.deepEqual(bytes, before.get(name), name);
  }
  assert.equal(updateTimeZoneData(updated), updated);
});

test('never downgrades a future runtime timezone database', () => {
  const future = withVersion('2027a');
  assert.equal(updateTimeZoneData(future), future);
});

test('refuses an invalid or incompatible ICU package', () => {
  assert.throws(() => updateTimeZoneData(Buffer.alloc(8)), /truncated/);
  const bigEndian = Buffer.from(installed);
  bigEndian[8] = 1;
  assert.throws(() => updateTimeZoneData(bigEndian), /little-endian/);
  const invalidOffset = Buffer.from(installed);
  invalidOffset.writeUInt32LE(0xffffffff, invalidOffset.readUInt16LE(0) + 8);
  assert.throws(() => updateTimeZoneData(invalidOffset), /offset/);
});

test('Windows afterPack hook updates its own ICU file without building an executable', async () => {
  fs.mkdirSync(path.join(__dirname, '../.tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.join(__dirname, '../.tmp/bc-afterpack-'));
  const filename = path.join(directory, 'icudtl.dat');
  fs.writeFileSync(filename, withVersion('2025c'));
  await require('./afterPack.js')({
    electronPlatformName: 'win32',
    appOutDir: directory,
    packager: { projectDir: directory },
  });
  assert.equal(updateTimeZoneFile(filename), false);
  assert.ok(fs.existsSync(path.join(directory, '.tmp/planstrand-install-files.ini')));
});
