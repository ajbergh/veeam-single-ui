/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, dialog, utilityProcess, session, Menu } = require('electron');
const launchStarted = performance.now();
const path = require('node:path');
const fs = require('node:fs');
const { availablePort } = require('./runtime.cjs');
const crypto = require('node:crypto');
const http = require('node:http');

const smokeTest = process.argv.includes('--desktop-smoke-test');
const smokeDirectory = process.argv.find(value => value.startsWith('--desktop-smoke-dir='));
if (smokeTest && smokeDirectory) app.setPath('userData', path.resolve(smokeDirectory.slice('--desktop-smoke-dir='.length)));

let window;
let server;
let quitting = false;
const startup = {};
let log;
function markStartup(phase) {
  startup[phase] = Math.round(performance.now() - launchStarted);
  log?.write(`[Startup] ${phase}: ${startup[phase]}ms\n`);
}
app.setName('Open Backup UI');
app.setAppUserModelId('org.openbackupui.desktop');
Menu.setApplicationMenu(null);

async function launch() {
  markStartup('electronReadyMs');
  const runtime = app.getPath('userData');
  fs.mkdirSync(runtime, { recursive: true });
  log = fs.createWriteStream(path.join(runtime, 'desktop.log'), { flags: 'w' });
  let origin;
  const desktopSession = session.defaultSession;
  desktopSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  desktopSession.setPermissionCheckHandler(() => false);
  // The console is served over loopback. Windows proxy auto-discovery can stall
  // even its first local request. This changes this app session, not OS settings
  // or the Node backend's API connections. Retain an opt-in for system proxies.
  const networkReady = desktopSession.setProxy({ mode: process.env.OPEN_BACKUP_UI_USE_SYSTEM_PROXY === '1' ? 'system' : 'direct' })
    .then(() => markStartup('proxyConfiguredMs'));
  networkReady.catch(() => {});
  window = new BrowserWindow({ width: 1440, height: 960, minWidth: 900, minHeight: 600,
    title: 'Open Backup UI', show: true, backgroundColor: '#090b0e', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webviewTag: false },
  });
  markStartup('windowCreatedMs');
  markStartup('windowVisibleMs');
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!origin || new URL(url).origin !== origin) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('render-process-gone', (_event, details) => log.write(`[Desktop] Renderer exited: ${details.reason}\n`));
  // Warming Chromium and starting the backend happen concurrently.
  const startupPage = window.loadFile(path.join(__dirname, 'startup.html')).then(() => markStartup('startupPageLoadedMs'));
  // Attach a handler immediately if the window is closed during startup.
  startupPage.catch(() => {});
  const keyFile = path.join(runtime, 'encryption-key');
  if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  let preferredPort;
  const portFile = path.join(runtime, 'desktop-port.json');
  try { preferredPort = JSON.parse(fs.readFileSync(portFile, 'utf8')).port; } catch { /* First run or invalid state: choose a free port. */ }
  const port = await availablePort(preferredPort);
  if (quitting || window.isDestroyed()) return;
  origin = `http://127.0.0.1:${port}`;
  // A stable local origin lets Chromium reuse cached assets on later launches.
  fs.writeFileSync(portFile, JSON.stringify({ port }));
  const token = crypto.randomBytes(32).toString('hex');
  const root = app.isPackaged ? path.join(process.resourcesPath, 'server.asar') : path.resolve(__dirname, '../server.asar');
  markStartup('backendForkedMs');
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
      if (message.type === 'ready') { startup.backend = message.timings; clearTimeout(timeout); resolve(); }
    });
  });
  markStartup('backendReadyMs');
  if (quitting || window.isDestroyed()) return;
  log.write('[Desktop] Backend ready; loading application.\n');
  await Promise.all([startupPage, networkReady]);
  if (quitting || window.isDestroyed()) return;

  desktopSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (new URL(details.url).origin === origin) details.requestHeaders['x-desktop-token'] = token;
    callback({ requestHeaders: details.requestHeaders });
  });
  desktopSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType === 'mainFrame' && new URL(details.url).origin === origin) markStartup('responseHeadersMs');
    callback({});
  });
  window.webContents.once('dom-ready', () => markStartup('domReadyMs'));
  markStartup('navigationStartedMs');
  await window.loadURL(`${origin}/connect`);
  markStartup('pageLoadedMs');
  log.write('[Desktop] Application page loaded.\n');
  fs.writeFileSync(path.join(runtime, 'startup-timings.json'), JSON.stringify(startup, null, 2));
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
    fs.writeFileSync(path.join(runtime, 'smoke-test.json'), JSON.stringify({ ok: true, port, apiStatus: result.status, unauthorizedStatus: denied, startup }));
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(launch).catch(error => {
    if (quitting) return;
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
