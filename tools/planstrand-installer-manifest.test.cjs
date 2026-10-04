const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeInstallerManifest } = require('./planstrand-installer-manifest.cjs');

test('uninstall commands name only packaged files and never recursively remove content', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'planstrand-manifest-'));
  try {
    const app = path.join(root, 'app');
    const output = path.join(root, 'output');
    fs.mkdirSync(path.join(app, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Planstrand.exe'), 'app');
    fs.writeFileSync(path.join(app, 'resources', 'app.asar'), 'archive');
    writeInstallerManifest(app, output);
    const commands = fs.readFileSync(
      path.join(output, 'planstrand-remove-files.nsh'),
      'utf8',
    );
    assert.match(commands, /Delete "\$INSTDIR\\resources\\app\.asar"/);
    assert.match(commands, /RMDir "\$INSTDIR\\resources"/);
    assert.doesNotMatch(commands, /\/r|\*|DO-NOT-DELETE/);
    const manifest = fs.readFileSync(
      path.join(output, 'planstrand-install-files.ini'),
      'utf8',
    );
    assert.match(manifest, /resources\\app\.asar=1/);
    fs.writeFileSync(path.join(app, 'bad$name'), 'unsafe');
    assert.throws(() => writeInstallerManifest(app, output), /Unsafe package path/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
