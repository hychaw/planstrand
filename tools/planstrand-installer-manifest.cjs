const fs = require('node:fs');
const path = require('node:path');

// Exact package allowlist; uninstall never recursively removes a directory.
function writeInstallerManifest(appDir, output) {
  const files = [
    'Uninstall Planstrand.exe',
    'uninstallerIcon.ico',
    'planstrand-install.ini',
  ];
  const dirs = [];
  function walk(relative = '') {
    for (const entry of fs.readdirSync(path.join(appDir, relative), {
      withFileTypes: true,
    })) {
      const nativeName = path.join(relative, entry.name);
      const name = nativeName.split(path.sep).join('\\');
      if (/[$"\r\n=\[\]]/.test(name) || entry.isSymbolicLink())
        throw new Error(`Unsafe package path: ${name}`);
      if (entry.isDirectory()) {
        dirs.push(name);
        walk(nativeName);
      } else files.push(name);
    }
  }
  walk();
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(
    path.join(output, 'planstrand-install-files.ini'),
    `[Owned]\n${[...dirs, ...files].map((name) => `${name}=1`).join('\n')}\n`,
  );
  fs.writeFileSync(
    path.join(output, 'planstrand-remove-files.nsh'),
    '!macro customRemoveFiles\n  SetOutPath $TEMP\n' +
      files.map((name) => `  Delete "$INSTDIR\\${name}"`).join('\n') +
      '\n' +
      dirs
        .reverse()
        .map((name) => `  RMDir "$INSTDIR\\${name}"`)
        .join('\n') +
      '\n  RMDir "$INSTDIR"\n!macroend\n',
  );
}
module.exports = { writeInstallerManifest };
