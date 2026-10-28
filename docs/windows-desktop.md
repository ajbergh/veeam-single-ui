# Windows desktop application

The Electron desktop edition bundles Chromium, a Node runtime, the production
Next.js server, and the application assets. Users do not need Node.js, npm,
Docker, WebView2, a separately hosted server, or an external browser.
The interface remains the existing React UI inside a native Windows window;
this is not a rewrite using WinUI controls.

## Windows x64 downloads

- `Open-Backup-UI-1.0.0-Setup-x64.exe`: full offline NSIS installer with an
  installation-directory chooser, shortcuts, and Windows uninstall support.
- `Open-Backup-UI-1.0.0-Portable-x64.exe`: single-file launcher that extracts its
  bundled runtime to temporary storage when launched. No installation needed.

Both editions need network access to your configured Veeam APIs. Installation
and startup need no download. Optional integrations retain their existing
network requirements. These builds are unsigned unless you configure signing;
Windows may display an unknown-publisher/SmartScreen prompt.

## Build from source

Use Windows x64 with Node.js 22 and npm installed:

```powershell
npm ci
npm run desktop:dist
node scripts/smoke-windows.cjs
node scripts/smoke-windows.cjs artifacts/windows/Open-Backup-UI-1.0.0-Portable-x64.exe
node scripts/smoke-windows-installer.cjs
```

Outputs are in `artifacts/windows/`. `win-unpacked/Open Backup UI.exe` is the
installed application executable and needs the other files in that directory.
Distribute the Setup or Portable executable for a single-file download.
`npm run desktop:pack` builds only the unpacked application. After a production
build, `npm run desktop:start` stages and launches it through local Electron.
The Windows desktop GitHub Actions workflow also builds, smoke-tests, and
uploads both executables and SHA-256 files.

## Data, security, and upgrades

The application stores connections, settings, caches, its encryption key, and
`desktop.log` under `%APPDATA%/Open Backup UI/`. Chromium also stores browser
preferences there. Back up this directory, including `encryption-key`, before
moving or upgrading. Installer upgrades and uninstall preserve it. Portable
means no installation; its user data still lives in AppData and is not carried
alongside the EXE. Existing web-server data is not migrated automatically.

The bundled backend listens only on `127.0.0.1` on an available port. Each
launch generates an access secret supplied by the desktop session. Requests
without it are rejected for application pages and APIs; bundled public images
and static assets remain readable. The renderer has no Node access, runs sandboxed, and
cannot open additional windows or navigate outside the local application.
Closing the window terminates the backend. Only one desktop instance runs at
a time. Web and container deployments keep their existing startup behavior.

The desktop backend verifies upstream HTTPS certificates by default. For Veeam
servers using a private CA, set `NODE_EXTRA_CA_CERTS` to the path of a PEM CA
certificate file before launching the app. This differs from the existing
web `npm start` command, which disables backend certificate verification.

The build stages a separate payload and excludes `.env*`, runtime `data/`, and
local encryption-key files. Do not embed credentials in public build-time
variables. Desktop smoke tests use isolated temporary profiles and check the
packaged renderer, API access, unauthorized-request rejection, writable data,
and backend shutdown without connecting to a Veeam server.
