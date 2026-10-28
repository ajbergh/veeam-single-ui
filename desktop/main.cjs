/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, utilityProcess, session, Menu } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const crypto = require('node:crypto');
const http = require('node:http');

const smokeTest = process.argv.includes('--desktop-smoke-test');
const smokeDirectory = process.argv.find(value => value.startsWith('--desktop-smoke-dir='));
if (smokeTest && smokeDirectory) app.setPath('userData', path.resolve(smokeDirectory.slice('--desktop-smoke-dir='.length)));

let window;
let server;
let quitting = false;
app.setName('Open Backup UI');
app.setAppUserModelId('org.openbackupui.desktop');

function availablePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const port = socket.address().port;
      socket.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function launch() {
  const runtime = app.getPath('userData');
  fs.mkdirSync(runtime, { recursive: true });
  const keyFile = path.join(runtime, 'encryption-key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const token = crypto.randomBytes(32).toString('hex');
  const root = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.resolve(__dirname, '../server');
  const log = fs.createWriteStream(path.join(runtime, 'desktop.log'), { flags: 'w' });
  server = utilityProcess.fork(path.join(__dirname, 'server.cjs'), [], {
    cwd: runtime, stdio: 'pipe', serviceName: 'Open Backup UI backend',
    env: { ...process.env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: String(port),
      OPEN_BACKUP_UI_SERVER_ROOT: root, OPEN_BACKUP_UI_DESKTOP_TOKEN: token,
      ENCRYPTION_KEY: fs.readFileSync(keyFile, 'utf8').trim(), NEXT_TELEMETRY_DISABLED: '1' },
  });
  server.stdout.on('data', chunk => log.write(chunk));
  server.stderr.on('data', chunk => log.write(chunk));
  server.on('exit', code => {
    log.end();
    if (!quitting) {
      if (!smokeTest) {
        dialog.showErrorBox('Open Backup UI stopped', `The local backend exited (${code}). Diagnostics: ${path.join(runtime, 'desktop.log')}`);
        app.quit();
      }
    }
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The local backend did not start within 90 seconds.')), 90000);
    server.once('exit', () => { clearTimeout(timeout); reject(new Error('The local backend could not start.')); });
    server.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timeout); resolve(); }
    });
  });
  log.write('[Desktop] Backend ready; opening application window.\n');

  const desktopSession = session.defaultSession;
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (new URL(details.url).origin === origin) details.requestHeaders['x-desktop-token'] = token;
    callback({ requestHeaders: details.requestHeaders });
  });
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 600,
    title: 'Open Backup UI', show: false, autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  Menu.setApplicationMenu(null);
  window.webContents.on('render-process-gone', (_event, details) => log.write(`[Desktop] Renderer exited: ${details.reason}\n`));
  await window.loadURL(`${origin}/connect`);
  log.write('[Desktop] Application page loaded.\n');
  window.show();
  // CI smoke testing exercises the actual packaged backend and renderer.
  if (smokeTest) {
    const page = await window.webContents.executeJavaScript(`document.fonts.ready.then(() => ({text:document.body.innerText, scripts:document.querySelectorAll('script[src*="/_next/static/"]').length}))`);
    log.write('[Desktop] Renderer responded.\n');
    if (page.text.trim().length < 30 || page.text.includes('Application error') || page.scripts === 0) {
      throw new Error('Packaged application page did not render correctly.');
    }
    const images = await window.webContents.executeJavaScript(`(async () => {
      // The carousel adds its first image after React mounts and checks the viewport.
      for (let attempt = 0; attempt < 150; attempt++) {
        const images = [...document.images].filter(image => image.loading !== 'lazy');
        if (images.length) return Promise.all(images.map(image => image.decode().then(() => true, () => false)));
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return [];
    })()`);
    if (images.length === 0 || images.some(loaded => !loaded)) throw new Error(`Bundled application images did not load: ${JSON.stringify(images)}`);
    const result = await window.webContents.executeJavaScript(`fetch('/api/config/sources').then(async r => ({status:r.status, body:await r.text()}))`);
    if (result.status !== 200) throw new Error(`Packaged API smoke test failed: ${result.status}`);
    const denied = await new Promise((resolve, reject) => {
      http.get(`${origin}/api/config/sources`, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    if (denied !== 403) throw new Error(`Unauthenticated local request returned ${denied}, expected 403.`);
    fs.writeFileSync(path.join(runtime, 'smoke-screenshot.png'), (await window.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(runtime, 'smoke-test.json'), JSON.stringify({ ok: true, port, apiStatus: result.status, unauthorizedStatus: denied }));
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(launch).catch(error => {
    quitting = true;
    if (server) server.kill();
    if (smokeTest) {
      fs.writeFileSync(path.join(app.getPath('userData'), 'smoke-error.txt'), error.stack || error.message);
      app.exit(1);
      return;
    }
    dialog.showErrorBox('Unable to start Open Backup UI', `${error.message}\nDiagnostics: ${path.join(app.getPath('userData'), 'desktop.log')}`);
    app.exit(1);
  });
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { quitting = true; if (server) server.kill(); });
