/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');

async function main() {
  const argument = process.argv[2] === 'portable'
    ? `artifacts/windows/Open-Backup-UI-${require('../package.json').version}-Portable-x64.exe`
    : process.argv[2];
  const executable = path.resolve(argument || 'artifacts/windows/win-unpacked/Open Backup UI.exe');
  fs.mkdirSync(path.resolve('tmp'), { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('tmp', 'desktop-smoke-'));
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.ELECTRON_RUN_AS_NODE;
  // Exercise a machine without development runtimes on PATH.
  const pathKey = Object.keys(cleanEnvironment).find(key => key.toLowerCase() === 'path') || 'Path';
  cleanEnvironment[pathKey] = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  const child = spawn(executable, ['--desktop-smoke-test', `--desktop-smoke-dir=${directory}`], {
    windowsHide: true, stdio: 'inherit', env: cleanEnvironment,
  });
  const code = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      // Kill the test's own process tree, including a bundled backend, on timeout.
      if (process.platform === 'win32') spawn(path.join(process.env.SystemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill();
      reject(new Error(`Desktop smoke test timed out. See ${directory}`));
    }, 240000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', value => { clearTimeout(timeout); resolve(value); });
  });
  assert.equal(code, 0, `Desktop failed. See ${directory}`);
  const result = JSON.parse(fs.readFileSync(path.join(directory, 'smoke-test.json'), 'utf8'));
  assert.equal(result.ok, true);
  assert.equal(result.apiStatus, 200);
  assert.equal(result.unauthorizedStatus, 403);
  assert.ok(fs.existsSync(path.join(directory, 'encryption-key')));
  // The API initializes its credential store under the user's writable directory.
  assert.ok(fs.existsSync(path.join(directory, 'data')));
  await new Promise(resolve => setTimeout(resolve, 500));
  const reachable = await new Promise(resolve => {
    const socket = net.connect(result.port, '127.0.0.1');
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
  assert.equal(reachable, false, 'The backend must stop when the desktop app exits');
  console.log(`Desktop smoke test passed: renderer, API, access isolation, user storage and shutdown (${directory}).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
