/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

function run(file, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true, stdio: 'inherit' });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Timed out: ${file}`)); }, 300000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${file} exited with ${code}`));
    });
  });
}

async function main() {
  fs.mkdirSync(path.resolve('tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('tmp', 'installer-smoke-'));
  const version = require('../package.json').version;
  const installer = path.resolve(`artifacts/windows/Open-Backup-UI-${version}-Setup-x64.exe`);
  const uninstaller = path.join(directory, 'Uninstall Open Backup UI.exe');
  try {
    await run(installer, ['/currentuser', '/S', `/D=${directory}`]);
    assert.ok(fs.existsSync(uninstaller), 'Installer must register an uninstaller');
    await run(process.execPath, [path.resolve('scripts/smoke-windows.cjs'), path.join(directory, 'Open Backup UI.exe')]);
  } finally {
    if (fs.existsSync(uninstaller)) await run(uninstaller, ['/S', `/currentuser`, `_?=${directory}`]);
  }
  assert.equal(fs.existsSync(path.join(directory, 'Open Backup UI.exe')), false, 'Uninstall must remove the application');
  console.log('Installer smoke test passed: silent install, installed app, and uninstall.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
