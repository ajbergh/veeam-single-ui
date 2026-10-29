/* eslint-disable @typescript-eslint/no-require-imports */
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const https = require('node:https')
const { execFileSync } = require('node:child_process')
const Module = require('node:module')
const ts = require('typescript')
const core = require('../lib/server/tls-runtime.cjs')
const filename = path.resolve(__dirname, '../lib/server/veeam-transport.ts')
const compiled = new Module(filename, module)
compiled.filename = filename
compiled.paths = module.paths
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
const { configuredVeeamOrigins, installVeeamTransport, veeamFetch } = compiled.exports

test('certificate policy includes Veeam platforms and environment URLs, excludes Kasten and HTTP', () => {
  const sources = ['vbr', 'vb365', 'vro', 'one', 'kasten'].map((platform, index) => ({ platform, protocol: 'https', host: 'localhost', port: 9400 + index }))
  assert.deepEqual(configuredVeeamOrigins(sources, { VEEAM_API_URL: 'http://localhost:1', VEEAM_ONE_API_URL: 'https://one.test:123' }), [
    'https://localhost:9400', 'https://localhost:9401', 'https://localhost:9402', 'https://localhost:9403', 'https://one.test:123',
  ])
})

test('real self-signed Veeam authentication and API requests work without weakening unrelated HTTPS', async t => {
  const openssl = [process.env.OPENSSL_BIN, 'openssl', 'C:/Program Files/Git/usr/bin/openssl.exe'].filter(Boolean).find(command => {
    try { execFileSync(command, ['version'], { stdio: 'pipe', timeout: 5000, windowsHide: true }); return true } catch { return false }
  })
  if (!openssl) return t.skip('OpenSSL is required for the real TLS test')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veeam-outbound-tls-'))
  let dispose
  const servers = []
  const globalTLS = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  try {
    const bundle = core.generateSelfSigned(root, { openssl })
    const credentials = core.loadBundle(root)
    // Use the generated PEM files, with no trust-store or environment changes.
    const options = credentials.options
    assert.ok(bundle)
    for (let index = 0; index < 2; index++) {
      const server = https.createServer(options, (request, response) => {
        if (request.url === '/redirect') { response.writeHead(302, { location: `${origins[1]}/api` }); response.end(); return }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(request.method === 'POST' ? { access_token: 'test-token' } : { data: ['backup'] }))
      })
      servers.push(server)
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    }
    const origins = servers.map(server => `https://127.0.0.1:${server.address().port}`)
    await assert.rejects(fetch(`${origins[0]}/api`))
    let approved = [origins[0]]
    let strict = false
    dispose = installVeeamTransport(() => approved, () => strict)
    assert.deepEqual(await (await fetch(`${origins[0]}/api`)).json(), { data: ['backup'] })
    assert.deepEqual(await (await fetch(`${origins[0]}/token`, { method: 'POST' })).json(), { access_token: 'test-token' })
    await assert.rejects(fetch(`${origins[1]}/api`))
    await assert.rejects(fetch(`${origins[0]}/redirect`))
    approved = []
    await assert.rejects(fetch(`${origins[0]}/api`))
    const [authentication, unrelated] = await Promise.allSettled([
      veeamFetch(`${origins[1]}/token`, { method: 'POST' }).then(response => response.json()),
      fetch(`${origins[1]}/api`),
    ])
    assert.equal(authentication.status, 'fulfilled')
    assert.equal(authentication.value.access_token, 'test-token')
    assert.equal(unrelated.status, 'rejected')
    await assert.rejects(veeamFetch(`${origins[0]}/redirect`))
    strict = true
    approved = [origins[0]]
    await assert.rejects(fetch(`${origins[0]}/api`))
    await assert.rejects(veeamFetch(`${origins[1]}/token`))
    assert.equal(process.env.NODE_TLS_REJECT_UNAUTHORIZED, globalTLS)
  } finally {
    if (dispose) await dispose()
    await Promise.all(servers.map(server => new Promise(resolve => { server.close(resolve); server.closeAllConnections() })))
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    fs.rmSync(root, { recursive: true, force: true })
  }
})
