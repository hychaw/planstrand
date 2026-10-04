const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/system-time-zone.ts`, 'utf8');
test('unrecognized Windows BC zone is resolved by identity, never an hour offset', () => {
  const exports = {};
  const commands = [];
  const script = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(script, {
    exports,
    process: { platform: 'win32', env: { SystemRoot: 'C:\\Windows' } },
    Intl: {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: undefined }) }),
    },
    require: (name) =>
      name === 'node:child_process'
        ? {
            execFileSync: (...args) => {
              commands.push(args);
              return '    TimeZoneKeyName    REG_SZ    British Columbia Standard Time\r\n';
            },
          }
        : require(name),
  });
  assert.equal(exports.getNativeSystemTimeZone(), 'America/Vancouver');
  assert.equal(exports.windowsTimeZoneToIana('Unknown'), null);
  assert.equal(commands[0][2].windowsHide, true);
  const instant = new Date('2026-10-04T19:21:00Z');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: exports.getNativeSystemTimeZone(),
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
  assert.equal(parts, '12:21');
});
