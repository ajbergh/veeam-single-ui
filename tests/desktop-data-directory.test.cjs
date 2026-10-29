/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadStore(name, cwd, env) {
  const exports = {};
  const encryption = { ENCRYPTION_KEY: 'fixture', LEGACY_DEFAULT_KEY: 'fixture', encrypt: value => `encrypted:${value}`, decrypt: value => value.slice('encrypted:'.length) };
  const file = path.resolve(__dirname, `../lib/server/${name}.ts`);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name === './encryption' ? encryption : require(name), process: { cwd: () => cwd, env }, console });
  return exports;
}

for (const desktop of [true, false]) {
  test(desktop ? 'desktop credentials and settings persist in the profile data directory rather than application resources' : 'web deployments retain cwd/data storage by default', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-backup-storage-'));
    try {
      const resources = path.join(root, 'resources');
      fs.mkdirSync(resources);
      const expected = desktop ? path.join(root, 'profile with spaces', 'data') : path.join(resources, 'data');
      const env = desktop ? { OPEN_BACKUP_UI_DATA_DIR: expected } : {};
      const { configStore } = loadStore('config-store', resources, env);
      const { settingsStore } = loadStore('settings-store', resources, env);
      configStore.save({ id: 'fixture', host: 'backup.test', port: 9419, username: 'fixture', password: 'fixture-password', protocol: 'https', platform: 'vbr' });
      settingsStore.save({ ai: { provider: 'openai', apiKey: 'fixture-api-key' } });
      assert.equal(configStore.getById('fixture').password, 'fixture-password');
      assert.ok(fs.existsSync(path.join(expected, 'sources.json')));
      assert.ok(fs.existsSync(path.join(expected, 'settings.json')));
      if (desktop) assert.equal(fs.existsSync(path.join(resources, 'data')), false, 'Application resources must remain read-only.');
    } finally {
      assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
