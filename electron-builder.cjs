/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { statFile, listPackage } = require('@electron/asar');

module.exports = {
  appId: 'org.openbackupui.desktop',
  productName: 'Open Backup UI',
  directories: { app: 'build/desktop/app', output: 'artifacts/windows' },
  asar: true,
  files: ['main.cjs', 'server.cjs', 'runtime.cjs', 'startup.html', 'package.json', 'LICENSE', '!node_modules/**'],
  extraResources: [{ from: 'build/desktop', to: '.', filter: ['server.asar', 'server.asar.unpacked/**/*'] }],
  win: { target: [{ target: 'nsis', arch: ['x64'] }, { target: 'portable', arch: ['x64'] }],
    icon: 'public/icon-512.png', executableName: 'Open Backup UI' },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true, createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false, artifactName: 'Open-Backup-UI-${version}-Setup-${arch}.${ext}' },
  portable: { artifactName: 'Open-Backup-UI-${version}-Portable-${arch}.${ext}' },
  publish: null,
  afterPack: async ({ appOutDir }) => {
    const archive = path.join(appOutDir, 'resources', 'server.asar');
    fs.accessSync(archive);
    for (const required of ['node_modules/next/dist/server/lib/start-server.js', '.next/required-server-files.json', '.next/server/middleware-manifest.json', 'public/icon-512.png']) {
      statFile(archive, path.normalize(required));
    }
    for (const entry of listPackage(archive).filter(file => /\.(node|dll|exe)$/i.test(file))) {
      const relative = entry.replace(/^[\\/]+/, '');
      if (!statFile(archive, relative).unpacked) throw new Error(`Native library must be unpacked: ${relative}`);
      fs.accessSync(path.join(`${archive}.unpacked`, relative));
    }
  },
};
