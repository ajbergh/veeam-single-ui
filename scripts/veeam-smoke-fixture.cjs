/* eslint-disable @typescript-eslint/no-require-imports */
const https = require('node:https');
const path = require('node:path');
const { generateSelfSigned } = require('../lib/server/tls-runtime.cjs');

module.exports = async function startVeeamFixture(directory) {
  const bundle = generateSelfSigned(path.join(directory, 'mock-veeam-certificate'), { openssl: process.env.OPENSSL_BIN || 'openssl' });
  const requests = [];
  const server = https.createServer(bundle.options, (request, response) => {
    requests.push({ method: request.method, path: request.url });
    request.resume();
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/api/oauth2/token' || request.url === '/api/token') {
      response.end(JSON.stringify({ access_token: 'local-smoke-test-token', token_type: 'bearer', expires_in: 3600 }));
    } else if (request.url === '/api/v1/license') {
      response.end(JSON.stringify({ smokeVeeam: true }));
    } else { response.statusCode = 404; response.end('{}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `https://127.0.0.1:${server.address().port}`, requests,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }),
  };
};
