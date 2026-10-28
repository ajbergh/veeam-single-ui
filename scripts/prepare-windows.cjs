/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.join(root, 'build', 'desktop');
const source = path.join(root, '.next', 'standalone');
if (!fs.existsSync(path.join(source, 'server.js'))) throw new Error('Run npm run build before staging the Windows app.');
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'app'), { recursive: true });
// Never ship build-machine credentials or data in a desktop distribution.
fs.cpSync(source, path.join(target, 'server'), { recursive: true, filter: file => {
  const segments = path.relative(source, file).split(path.sep);
  return segments[0] !== 'data' && !segments.some(segment => segment.startsWith('.env') || segment === '.open-backup-ui-key');
} });
fs.cpSync(path.join(root, '.next', 'static'), path.join(target, 'server', '.next', 'static'), { recursive: true });
fs.cpSync(path.join(root, 'public'), path.join(target, 'server', 'public'), { recursive: true });
for (const name of ['main.cjs', 'server.cjs']) fs.copyFileSync(path.join(root, 'desktop', name), path.join(target, 'app', name));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(target, 'app', 'LICENSE'));
const pkg = require('../package.json');
fs.writeFileSync(path.join(target, 'app', 'package.json'), JSON.stringify({
  name: pkg.name + '-desktop', version: pkg.version, description: 'Open Backup UI Windows desktop application',
  author: 'Open Backup UI contributors', license: 'MIT', main: 'main.cjs',
}, null, 2));
console.log('Windows desktop payload staged in build/desktop');
