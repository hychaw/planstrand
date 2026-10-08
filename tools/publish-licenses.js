'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Angular emits extracted notices beside browser/, outside the served app root.
// Publish the same notices inside the app so About works offline in every build.
const base = path.resolve(process.argv[2] || '.tmp/angular-dist');
const browser = path.join(base, 'browser');
fs.copyFileSync(
  path.join(base, '3rdpartylicenses.txt'),
  path.join(browser, '3rdpartylicenses.txt'),
);

// Include the published notices in the PWA's integrity manifest and offline cache.
const manifestPath = path.join(browser, 'ngsw.json');
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  execFileSync(process.execPath, [
    path.resolve('node_modules/@angular/service-worker/ngsw-config.js'),
    path.relative(process.cwd(), browser),
    'ngsw-config.json',
    manifest.index.slice(0, -'index.html'.length),
  ]);
}
