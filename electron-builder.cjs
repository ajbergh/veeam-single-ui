/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

module.exports = {
  appId: 'org.openbackupui.desktop',
  productName: 'Open Backup UI',
  directories: { app: 'build/desktop/app', output: 'artifacts/windows' },
  asar: true,
  files: ['main.cjs', 'server.cjs', 'package.json', 'LICENSE', '!node_modules/**'],
  // Copy from the parent: electron-builder excludes a source-root node_modules
  // directory even for extraResources. Nested server/node_modules is preserved.
  extraResources: [{ from: 'build/desktop', to: '.', filter: ['server/**/*'] }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
    icon: 'public/icon-512.png', executableName: 'Open Backup UI' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false, artifactName: 'Open-Backup-UI-${version}-Setup-${arch}.${ext}' },
  portable: { artifactName: 'Open-Backup-UI-${version}-Portable-${arch}.${ext}' },
  publish: null,
  afterPack: async ({ appOutDir }) => {
    for (const required of ['node_modules/next/dist/server/lib/start-server.js', '.next/required-server-files.json', '.next/server/middleware-manifest.json', 'public/icon-512.png']) {
      fs.accessSync(path.join(appOutDir, 'resources', 'server', required));
    }
  },
};
