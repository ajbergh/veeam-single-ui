/* eslint-disable @typescript-eslint/no-require-imports */
const net = require('node:net');
const path = require('node:path');

function backendPaths(serverRoot, userData, paths = path) {
  // Next joins cwd with a relative project path, which cannot cross drives.
  // Keep cwd beside the archive and persist data explicitly in the user profile.
  return { cwd: paths.dirname(paths.resolve(serverRoot)), dataDirectory: paths.join(paths.resolve(userData), 'data') };
}

function availablePort(preferred = 0) {
  const requested = Number.isInteger(preferred) && preferred >= 1024 && preferred <= 65535 ? preferred : 0;
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', error => {
      if (requested && ['EADDRINUSE', 'EACCES'].includes(error.code)) resolve(availablePort());
      else reject(error);
    });
    socket.listen(requested, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

module.exports = { availablePort, backendPaths };
