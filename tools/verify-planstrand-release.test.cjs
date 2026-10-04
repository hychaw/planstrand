const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('js-yaml');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const pkg = JSON.parse(read('package.json'));
const builder = load(read('electron-builder.yaml'));
const workflow = load(read('.github/workflows/release-planstrand.yml'));

test('Planstrand packaging is distinct and cannot publish to upstream', () => {
  assert.equal(pkg.name, 'planstrand');
  assert.equal(pkg.productName, 'Planstrand');
  assert.equal(pkg.version, '19.1.0');
  assert.equal(JSON.parse(read('package-lock.json')).packages[''].name, pkg.name);
  assert.equal(pkg.repository.url, 'https://github.com/hychaw/planstrand.git');
  assert.equal(pkg.publish, undefined);
  assert.equal(builder.appId, 'io.github.hychaw.planstrand');
  assert.equal(builder.mac.appId, builder.appId);
  assert.equal(builder.publish, null);
  assert.equal(builder.appx, undefined);
  assert.equal(builder.mac.notarize, false);
  assert.equal(builder.mac.identity, null);
  assert.equal(builder.dmg.sign, false);
});

test('manual release workflow has read-only builds and optional draft only', () => {
  assert.deepEqual(Object.keys(workflow.on), ['workflow_dispatch']);
  assert.equal(workflow.on.workflow_dispatch.inputs.ref.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.create_draft.default, false);
  assert.equal(workflow.permissions.contents, 'read');
  assert.equal(workflow.jobs.draft.environment, 'planstrand-release');
  assert.equal(workflow.jobs.draft.needs, 'windows');
  for (const job of Object.values(workflow.jobs))
    assert.match(job.if, /github.repository == 'hychaw\/planstrand'/);
  const source = read('.github/workflows/release-planstrand.yml');
  assert.match(source, /--publish never/);
  assert.match(source, /--repo hychaw\/planstrand/);
  assert.match(source, /--draft --prerelease/);
  assert.match(source, /SHA256SUMS/);
  assert.doesNotMatch(
    source,
    /secrets\.(?!GITHUB_TOKEN)|SignPath|appx|snapcraft|johannesjo/,
  );
});

test('default desktop profile and protocol do not claim upstream data or handlers', () => {
  const startup = read('electron/app-identity.ts');
  assert.match(startup, /join\(app\.getPath\('appData'\), 'Planstrand'\)/);
  const main = read('electron/main.ts');
  assert.ok(
    main.indexOf("import './app-identity'") < main.indexOf('import { PROTOCOL_PREFIX }'),
  );
  assert.match(read('electron/protocol-handler.ts'), /PROTOCOL_NAME = 'planstrand'/);
  assert.deepEqual(builder.linux.mimeTypes, ['x-scheme-handler/planstrand']);
  assert.equal(builder.nsis.shortcutName, 'Planstrand');
  assert.equal(builder.nsis.uninstallDisplayName, 'Planstrand');
});

test('credentials and compatibility schemas retain deliberate boundaries', () => {
  assert.doesNotMatch(
    read('src/app/imex/sync/dropbox/dropbox.const.ts'),
    /m7w85uty7m745ph/,
  );
  assert.match(
    read('src/app/imex/sync/dropbox/dropbox.const.ts'),
    /getEnvOptional\('DROPBOX_API_KEY'\)/,
  );
  assert.match(
    read('src/app/op-log/sync-providers/sync-providers.factory.ts'),
    /DROPBOX_APP_KEY\s*\?/,
  );
  assert.match(read('LICENSE'), /Copyright \(c\) 2018 Johannes Millan/);
  assert.match(
    read('src/app/op-log/persistence/db-keys.const.ts'),
    /DB_NAME = 'SUP_OPS'/,
  );
});
