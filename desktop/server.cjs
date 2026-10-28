/* eslint-disable @typescript-eslint/no-require-imports */
// Runs in Electron's bundled Node utility process; no system Node is needed.
const path = require('node:path');
const { createRequire } = require('node:module');

async function main() {
  const root = process.env.OPEN_BACKUP_UI_SERVER_ROOT;
  const bundledRequire = createRequire(path.join(root, 'package.json'));
  const { config } = bundledRequire('./.next/required-server-files.json');
  process.env.__NEXT_PRIVATE_STANDALONE_CONFIG = JSON.stringify(config);
  const { startServer } = bundledRequire('next/dist/server/lib/start-server');
  await startServer({ dir: root, isDev: false, config,
    hostname: '127.0.0.1', port: Number(process.env.PORT), allowRetry: false });
  process.parentPort.postMessage({ type: 'ready' });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
