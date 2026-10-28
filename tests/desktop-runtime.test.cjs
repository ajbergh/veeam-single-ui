/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { availablePort } = require('../desktop/runtime.cjs');

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
