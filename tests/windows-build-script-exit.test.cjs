/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function runAsActions(script) {
  const command = `$ErrorActionPreference = 'Stop'\n. '${script.replace(/'/g, "''")}'\nif (Test-Path -LiteralPath 'variable:LASTEXITCODE') { exit $LASTEXITCODE }`;
  return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
  });
}

test('PowerShell build checks report success to Actions and preserve genuine assertion failures', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '..');
  const script = path.join(root, 'tests/windows-build-scripts.test.ps1');
  const successful = runAsActions(script);
  assert.ifError(successful.error);
  assert.equal(successful.status, 0, successful.stdout + successful.stderr);
  assert.match(successful.stdout, /prerequisite failure restores the caller directory/);

  const temporaryRoot = path.join(root, 'tmp');
  const fixture = fs.mkdtempSync(path.join(temporaryRoot, 'windows-ci-exit-'));
  try {
    fs.mkdirSync(path.join(fixture, 'tests'));
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.copyFileSync(script, path.join(fixture, 'tests/windows-build-scripts.test.ps1'));
    const brokenWrapper = fs.readFileSync(path.join(root, 'scripts/build-standalone.ps1'), 'utf8')
      .replace('function Invoke-BuildCommand', 'function Missing-BuildCommand');
    fs.writeFileSync(path.join(fixture, 'scripts/build-standalone.ps1'), brokenWrapper);
    const failed = runAsActions(path.join(fixture, 'tests/windows-build-scripts.test.ps1'));
    assert.ifError(failed.error);
    assert.notEqual(failed.status, 0, 'A real assertion failure must still fail CI.');
    assert.match(failed.stderr, /Missing build command wrapper/);
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(temporaryRoot));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
