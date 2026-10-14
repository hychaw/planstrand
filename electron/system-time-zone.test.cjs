const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = fs.readFileSync(`${__dirname}/system-time-zone.ts`, 'utf8');
const load = ({
  zone,
  platform = 'win32',
  env = {},
  id = 'British Columbia Standard Time',
  readFails = false,
} = {}) => {
  const exports = {};
  const commands = [];
  const script = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(script, {
    exports,
    process: { platform, env },
    Intl: {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: zone }) }),
    },
    require: (name) =>
      name === 'node:child_process'
        ? {
            execFileSync: (...args) => {
              commands.push(args);
              if (readFails) throw new Error('Registry unavailable');
              return `    TimeZoneKeyName    REG_SZ    ${id}\r\n`;
            },
          }
        : require(name),
  });
  return { exports, commands, env };
};

test('unrecognized Windows BC zone is resolved by identity using a bounded read-only query', () => {
  const { exports, commands } = load();
  assert.equal(exports.getNativeSystemTimeZone(), 'America/Vancouver');
  assert.equal(exports.windowsTimeZoneToIana('Unknown'), null);
  assert.equal(commands[0][2].windowsHide, true);
  assert.equal(commands[0][1][0], 'query');
  assert.equal(commands[0][2].timeout, 3000);
});

test('startup gives Date, Intl and child processes the mapped IANA zone', () => {
  const { exports, env } = load();
  exports.initializeSystemTimeZone();
  assert.equal(env.TZ, 'America/Vancouver');
});

for (const zone of ['Europe/Berlin', 'America/Vancouver', 'Etc/UTC']) {
  test(`preserves recognized native zone ${zone}`, () => {
    const { exports, env, commands } = load({ zone });
    exports.initializeSystemTimeZone();
    assert.equal(env.TZ, undefined);
    assert.equal(exports.getNativeSystemTimeZone(), zone);
    assert.equal(commands.length, 0);
  });
}

for (const TZ of ['Asia/Tokyo', 'America/Vancouver', 'Invalid/Explicit']) {
  test(`preserves an explicit TZ=${TZ}`, () => {
    const { exports, env, commands } = load({ env: { TZ } });
    exports.initializeSystemTimeZone();
    assert.equal(env.TZ, TZ);
    assert.equal(commands.length, 0);
  });
}

for (const options of [
  { id: 'Unknown' },
  { readFails: true },
  { platform: 'linux' },
  { platform: 'darwin' },
]) {
  test(`leaves unsupported or unavailable native resolution alone: ${JSON.stringify(options)}`, () => {
    const { exports, env } = load(options);
    exports.initializeSystemTimeZone();
    assert.equal(env.TZ, undefined);
    assert.equal(exports.getNativeSystemTimeZone(), null);
  });
}
