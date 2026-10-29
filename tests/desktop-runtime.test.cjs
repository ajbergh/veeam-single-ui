/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { availablePort, backendPaths } = require('../desktop/runtime.cjs');

test('backend manifests resolve when the archive and writable profile are on different Windows drives', () => {
  for (const [root, profile] of [
    ['C:\\Temp\\portable\\resources\\server.asar', 'D:\\profiles\\desktop'],
    ['D:\\Programs\\Open Backup UI\\resources\\server.asar', 'C:\\Users\\test\\AppData\\Roaming\\Open Backup UI'],
  ]) {
    const backend = backendPaths(root, profile, path.win32);
    const project = path.win32.join(backend.cwd, path.win32.relative(backend.cwd, root));
    assert.equal(project, root, 'Next must be able to reconstruct its project path with join(cwd, relativePath)');
    assert.equal(backend.dataDirectory, path.win32.join(profile, 'data'));
    assert.notEqual(path.win32.parse(backend.cwd).root, path.win32.parse(backend.dataDirectory).root);
  }
});

test('desktop reuses its previous local origin when the port is available', async () => {
  const port = await availablePort();
  assert.equal(await availablePort(port), port);
});

test('an occupied preferred port falls back to another available loopback port', async t => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => { occupied.once('error', reject); occupied.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const port = await availablePort(occupied.address().port);
  assert.notEqual(port, occupied.address().port);
  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
});

test('invalid saved ports are replaced rather than preventing startup', async () => {
  for (const invalid of [-1, 65536, 1.5, '3000', null]) {
    const port = await availablePort(invalid);
    assert.ok(port >= 1024 && port <= 65535);
  }
});
