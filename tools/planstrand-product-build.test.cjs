const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const product = require('../planstrand-product.json');
const config = require('./planstrand-product-build.cjs');

test('desktop metadata uses the product version without changing compatibility semver', async (t) => {
  const { log } = require('builder-util');
  const originalStream = log.stream;
  t.after(() => {
    log.stream = originalStream;
  });
  // Keep electron-builder's Unicode logs off Node 22's test-runner stdout channel.
  // Preserve all log levels, including errors, and restore the stream after the test.
  log.stream = process.stderr;
  const { getConfig } = require('app-builder-lib/out/util/config/config');
  const merged = await getConfig(path.join(__dirname, '..'), undefined, undefined);
  assert.equal(product.version, '1.3.0-rc.1');
  assert.equal(merged.extraMetadata.version, product.version);
  assert.equal(merged.buildVersion, config.buildVersion);
  assert.match(merged.buildVersion, /^\d+\.\d+\.\d+$/);
  assert.equal(merged.productName, 'Planstrand');
  assert.equal(merged.publish, null);
  assert.notEqual(require('../package.json').version, product.version);
});
