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

Use Windows x64 with Node.js 22.12 or newer and npm installed. To build either
executable separately, run the corresponding PowerShell script:

```powershell
# Single-file standalone EXE (no installation required)
.\scripts\build-standalone.ps1

# Full offline Windows installer
.\scripts\build-windows-installer.ps1
```

Each script installs the locked dependencies with `npm ci --include=dev` (including
the build tools even if `NODE_ENV=production`), builds the optimized
desktop app, stages its archived backend, and packages only the selected Windows
target. Each also writes a SHA-256 file alongside its executable in
`artifacts/windows/`. Use `-SkipInstall` when dependencies are already installed
and match `package-lock.json`. The scripts work regardless of the current working
directory and stop if a build command fails.

Quick regression checks for PowerShell warning handling, command failures, paths
with spaces, and working-directory restoration can be run without rebuilding:

```powershell
powershell.exe -NoProfile -File .\tests\windows-build-scripts.test.ps1
```

To build both formats together and run the smoke checks:

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
`npm run desktop:pack` builds only the unpacked application. After
`npm run desktop:build`, `npm run desktop:start` stages and launches it through local Electron.
The Windows desktop GitHub Actions workflow also builds, smoke-tests, and
uploads both executables and SHA-256 files.

## Startup performance

The window opens immediately with a local startup indicator while Chromium and
the backend initialize in parallel. Backend JavaScript and manifests ship in
`server.asar` to reduce thousands of individual file reads on Windows. Native
libraries remain unpacked. Workspaces load on demand rather than all at startup,
and bundled WebP previews are served directly without a runtime image resizer.

Each profile remembers its loopback port so later launches can reuse Chromium's
cached assets. If that port is in use, the app picks a different available port.
The access secret is still regenerated each launch. The installed edition avoids
the portable edition's extra extraction step, so prefer it for everyday use.

The embedded browser connects directly by default, avoiding Windows proxy
auto-discovery before its first loopback request. This setting is scoped to this
app's browser session; it does not change Windows proxy settings or the backend's
API connections. If browser-originated external requests (such as optional
telemetry) require a system proxy, launch with `OPEN_BACKUP_UI_USE_SYSTEM_PROXY=1`.
Certificate verification remains enabled.

`desktop.log` records startup phases in milliseconds. `startup-timings.json`
records window visibility, backend readiness, and page loading separately; a
visible startup indicator does not mean the console has finished loading.
To measure first and repeat launches using the same isolated profile:

```powershell
node scripts/smoke-windows.cjs unpacked tmp/startup-profile
node scripts/smoke-windows.cjs unpacked tmp/startup-profile
```

Timings start when the desktop JavaScript begins, excluding any operating-system
delay before Electron starts. Results vary with hardware and system file caches.

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

Veeam servers with self-signed certificates connect automatically, with no certificate installation or prompts. The exception applies only to configured Veeam server origins and Veeam authentication requests; other HTTPS connections retain certificate verification. HTTPS remains encrypted, but Veeam certificate identity is not verified. Administrators can opt into strict verification with `VEEAM_TLS_VERIFY=1` and provide a private CA using `NODE_EXTRA_CA_CERTS`.

The build stages a separate payload and excludes `.env*`, runtime `data/`, and
local encryption-key files. Do not embed credentials in public build-time
variables. Desktop smoke tests use isolated temporary profiles and check the
packaged renderer, API access, unauthorized-request rejection, writable data,
and backend shutdown without connecting to a Veeam server.

Build icons are generated from `desktop/assets/icon.svg` during staging. The green shield is used for the application, taskbar, portable EXE, installer, and uninstaller.

To verify Veeam certificate compatibility against a local self-signed HTTPS fixture, run `node scripts/smoke-windows.cjs unpacked tmp/self-signed-veeam --self-signed-veeam`. This requires OpenSSL on the build machine (or `OPENSSL_BIN` pointing to it), tests both first-time and saved-source authentication plus an API read, and uses only an isolated smoke-test profile.

Smoke output includes timings observed from EXE launch as well as internal application timings. The launch observations include portable extraction and Windows process startup; use them when investigating a delay before the window appears. The installed application avoids portable extraction on each launch.
