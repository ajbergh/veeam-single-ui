/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const assert = require('node:assert/strict');

async function main() {
  const argument = process.argv[2] === 'portable'
    ? `artifacts/windows/Open-Backup-UI-${require('../package.json').version}-Portable-x64.exe`
    : process.argv[2] === 'unpacked' ? undefined : process.argv[2];
  const executable = path.resolve(argument || 'artifacts/windows/win-unpacked/Open Backup UI.exe');
  fs.mkdirSync(path.resolve('tmp'), { recursive: true });
  const tmpRoot = path.resolve('tmp');
  const directory = process.argv[3] ? path.resolve(process.argv[3]) : fs.mkdtempSync(path.join(tmpRoot, 'desktop-smoke-'));
  const relative = path.relative(tmpRoot, directory);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Smoke profiles must be in a subdirectory of the workspace tmp folder.');
  fs.mkdirSync(directory, { recursive: true });
  for (const filename of ['smoke-test.json', 'smoke-error.txt']) {
    try { fs.unlinkSync(path.join(directory, filename)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const cleanEnvironment = { ...process.env };
  delete cleanEnvironment.ELECTRON_RUN_AS_NODE;
  // Exercise a machine without development runtimes on PATH.
  const pathKey = Object.keys(cleanEnvironment).find(key => key.toLowerCase() === 'path') || 'Path';
  cleanEnvironment[pathKey] = `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`;
  const launched = Date.now();
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
  if (result.startup) console.log(`Startup timings: ${JSON.stringify(result.startup)}; complete smoke test: ${Date.now() - launched}ms`);
  assert.equal(result.ok, true);
  assert.equal(result.apiStatus, 200);
  assert.equal(result.unauthorizedStatus, 403);
  if (result.startup) {
    assert.ok(result.startup.windowVisibleMs < result.startup.backendReadyMs, 'Show the window while the backend starts');
    assert.ok(result.startup.windowVisibleMs < result.startup.pageLoadedMs, 'Do not hide the window until all page resources load');
  }
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
