/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const { createPackageWithOptions } = require('@electron/asar');

async function prepare() {
  const root = path.resolve(__dirname, '..');
  const target = path.join(root, 'build', 'desktop');
  const source = path.join(root, '.next', 'standalone');
  if (!fs.existsSync(path.join(source, 'server.js'))) throw new Error('Run npm run desktop:build before staging the Windows app.');
  const required = JSON.parse(fs.readFileSync(path.join(source, '.next', 'required-server-files.json'), 'utf8'));
  if (!required.config.images.unoptimized) throw new Error('Run npm run desktop:build to create the desktop-specific production output.');
  if (path.relative(root, target) !== path.join('build', 'desktop')) throw new Error('Invalid desktop staging directory.');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'app'), { recursive: true });
  // Never ship build-machine credentials or data in a desktop distribution.
  fs.cpSync(source, path.join(target, 'server'), { recursive: true, filter: file => {
    const segments = path.relative(source, file).split(path.sep);
    return segments[0] !== 'data' && !segments.some(segment => segment.startsWith('.env') || segment === '.open-backup-ui-key');
  } });
  fs.cpSync(path.join(root, '.next', 'static'), path.join(target, 'server', '.next', 'static'), { recursive: true });
  fs.cpSync(path.join(root, 'public'), path.join(target, 'server', 'public'), { recursive: true });
  for (const name of ['main.cjs', 'server.cjs', 'runtime.cjs', 'startup.html']) fs.copyFileSync(path.join(root, 'desktop', name), path.join(target, 'app', name));
  fs.cpSync(path.join(root, 'desktop', 'assets'), path.join(target, 'app', 'assets'), { recursive: true });
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'app', 'LICENSE'));
  const pkg = require('../package.json');
  fs.writeFileSync(path.join(target, 'app', 'package.json'), JSON.stringify({
    name: pkg.name + '-desktop', version: pkg.version, description: 'Open Backup UI Windows desktop application',
    author: 'Open Backup UI contributors', license: 'MIT', main: 'main.cjs',
  }, null, 2));
  // Archive JavaScript and manifests to avoid thousands of Windows file opens.
  // DLLs and native addons need real paths and remain alongside the archive.
  await createPackageWithOptions(path.join(target, 'server'), path.join(target, 'server.asar'), {
    unpack: '**/*.{node,dll,exe}', unpackDir: '**/@img/**',
  });
  console.log('Windows desktop payload staged with archived backend in build/desktop');
}

prepare().catch(error => { console.error(error); process.exitCode = 1; });
