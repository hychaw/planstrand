const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, 'app-identity.ts'), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const run = (argv) => {
  const calls = [];
  const app = {
    setName: (name) => calls.push(['name', name]),
    getPath: (key) => {
      assert.equal(key, 'appData');
      return '/test/appData';
    },
    setPath: (key, value) => calls.push([key, value]),
  };
  vm.runInNewContext(code, {
    exports: {},
    require: (name) => (name === 'electron' ? { app } : require(name)),
    process: { argv },
  });
  return calls;
};
test('default profile is Planstrand and never the upstream live profile', () => {
  assert.deepEqual(run(['Planstrand.exe']), [
    ['name', 'Planstrand'],
    ['userData', path.join('/test/appData', 'Planstrand')],
  ]);
});
test('explicit profile override resolves before importing backup/settings modules', () => {
  assert.deepEqual(run(['Planstrand.exe', '--user-data-dir=/test/isolated///']), [
    ['name', 'Planstrand'],
    ['userData', '/test/isolated'],
  ]);
});
