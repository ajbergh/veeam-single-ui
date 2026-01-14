# Build Scripts

This folder contains build scripts for creating standalone Veeam Single-UI packages for different platforms.

## Available Build Scripts

| Script | Platform | Architecture | Description |
|--------|----------|--------------|-------------|
| `Build-Windows.ps1` | Windows | x64 | PowerShell script for Windows builds |
| `build-linux.sh` | Linux | amd64, arm64 | Bash script for Linux distributions |
| `build-macos.sh` | macOS | amd64, arm64, Universal | Bash script for macOS builds |

## Prerequisites

All platforms require:
- **Node.js 20.x** or later
- **Go 1.22** or later
- **npm** (comes with Node.js)

### Windows
```powershell
# Install Node.js from https://nodejs.org
# Install Go from https://go.dev/dl/
```

### Linux (Ubuntu/Debian)
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Go
sudo snap install go --classic
# or download from https://go.dev/dl/
```

### macOS
```bash
# Via Homebrew (recommended)
brew install node@20 go

# Or download from official websites
```

## Usage

### Windows

```powershell
# Basic build (Release configuration)
.\Build-Windows.ps1

# Debug build
.\Build-Windows.ps1 -Configuration Debug

# Custom output path
.\Build-Windows.ps1 -OutputPath C:\builds\veeam-ui

# Skip frontend or backend
.\Build-Windows.ps1 -SkipFrontend
.\Build-Windows.ps1 -SkipBackend
```

### Linux

```bash
# Make executable
chmod +x build-linux.sh

# Basic build (Release configuration, amd64)
./build-linux.sh

# ARM64 build (for Raspberry Pi, AWS Graviton, etc.)
./build-linux.sh --arch arm64

# Debug build
./build-linux.sh --config debug

# Custom output path
./build-linux.sh --output /opt/veeam-ui/build

# Skip frontend or backend
./build-linux.sh --skip-frontend
./build-linux.sh --skip-backend
```

### macOS

```bash
# Make executable
chmod +x build-macos.sh

# Basic build (auto-detects architecture)
./build-macos.sh

# Universal binary (Intel + Apple Silicon)
./build-macos.sh --universal

# Intel-only build
./build-macos.sh --arch amd64

# Apple Silicon only
./build-macos.sh --arch arm64

# Debug build
./build-macos.sh --config debug
```

## Output Structure

All build scripts produce the same directory structure in `dist/`:

```
dist/
├── backend/
│   ├── veeam-backend(.exe)    # Go backend binary
│   └── data/                  # SQLite database directory
├── frontend/
│   ├── server.js              # Next.js standalone server
│   ├── .next/                 # Next.js build output
│   └── public/                # Static assets
├── config/
│   ├── .env.sample            # Configuration template
│   ├── veeam-ui.service       # Linux systemd service (Linux only)
│   └── com.veeam.single-ui.plist  # macOS launchd plist (macOS only)
├── .env.sample                # Configuration template (copy)
├── start-veeam-ui.sh          # Startup script (Linux/macOS)
├── Start-VeeamUI.ps1          # Startup script (Windows)
└── README.md                  # Platform-specific instructions
```

## Configuration

### Zero Configuration (Recommended)

Simply run the startup script - it handles everything:

```bash
# Linux/macOS
./start-veeam-ui.sh

# Windows
.\Start-VeeamUI.ps1
```

On first run:
1. **Encryption keys generated** - Secure passphrase created automatically
2. **Configuration created** - `.env` file written with secure defaults
3. **Services started** - Backend and frontend initialize
4. **Setup Wizard** - Browser opens to configure Veeam servers

### Manual Configuration

If you need to pre-configure, copy `.env.sample` to `.env` and edit:

```bash
cp .env.sample .env
# Edit .env with your settings
```

Key variables:
- `MASTER_PASSPHRASE` - Encryption passphrase (min 16 chars)
- `ENCRYPTION_SALT` - Base64-encoded salt (32 bytes)
- `BACKEND_PORT` - Backend port (default: 8080)
- `PORT` - Frontend port (default: 3000)

## Running as a Service

### Linux (systemd)

```bash
# Copy files
sudo mkdir -p /opt/veeam-ui
sudo cp -r dist/* /opt/veeam-ui/

# Create service user
sudo useradd -r -s /bin/false veeam-ui
sudo chown -R veeam-ui:veeam-ui /opt/veeam-ui

# Install service
sudo cp /opt/veeam-ui/config/veeam-ui.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable veeam-ui
sudo systemctl start veeam-ui
```

### macOS (launchd)

```bash
# Copy files
sudo mkdir -p /usr/local/veeam-ui
sudo cp -r dist/* /usr/local/veeam-ui/
sudo mkdir -p /usr/local/veeam-ui/logs

# Install service
sudo cp /usr/local/veeam-ui/config/com.veeam.single-ui.plist /Library/LaunchDaemons/
sudo launchctl load /Library/LaunchDaemons/com.veeam.single-ui.plist
```

### Windows (Service)

For Windows services, consider using NSSM (Non-Sucking Service Manager):

```powershell
# Download NSSM from https://nssm.cc/
nssm install VeeamUI "C:\veeam-ui\Start-VeeamUI.ps1"
nssm start VeeamUI
```

## Cross-Platform Builds

### Building Linux packages on macOS

```bash
# Works out of the box - Go cross-compiles
./build-linux.sh  # Creates Linux binary on macOS
```

### Building Windows packages on Linux/macOS

```bash
# Modify build-linux.sh or use Go directly
GOOS=windows GOARCH=amd64 go build -o veeam-backend.exe ./cmd/server
```

### Docker/Container Builds

For container deployments, see [CONTAINER.md](../CONTAINER.md) in the project root.

## Troubleshooting

### Build Fails: "npm ci failed"

```bash
# Clear npm cache
npm cache clean --force

# Delete node_modules and try again
rm -rf node_modules package-lock.json
npm install
```

### Build Fails: "Go build failed"

```bash
# Ensure Go modules are downloaded
cd backend
go mod download

# Try building manually
go build -o test-binary ./cmd/server
```

### Permission Denied (Linux/macOS)

```bash
# Make scripts executable
chmod +x build-linux.sh build-macos.sh
chmod +x dist/start-veeam-ui.sh
```

### Node.js Not Found (Windows)

The Windows build script tries to find Node.js automatically. If it fails:

1. Ensure Node.js is installed
2. Add Node.js to your PATH
3. Restart PowerShell after installation

## Build Options Summary

| Option | Windows | Linux | macOS | Description |
|--------|---------|-------|-------|-------------|
| Configuration | `-Configuration Debug/Release` | `--config debug/release` | `--config debug/release` | Build mode |
| Output Path | `-OutputPath <path>` | `--output <path>` | `--output <path>` | Output directory |
| Skip Frontend | `-SkipFrontend` | `--skip-frontend` | `--skip-frontend` | Don't build frontend |
| Skip Backend | `-SkipBackend` | `--skip-backend` | `--skip-backend` | Don't build backend |
| Architecture | N/A (x64 only) | `--arch amd64/arm64` | `--arch amd64/arm64` | Target architecture |
| Universal | N/A | N/A | `--universal` | Build fat binary |
| Help | `-?` | `--help` | `--help` | Show usage |

## Security Notes

- **Passphrase**: Auto-generated on first run, stored in `.env`
- **Database**: SQLite with AES-256-GCM encrypted credentials
- **Permissions**: `.env` file should be readable only by owner (chmod 600)
- **Backup**: Back up both `.env` and `backend/data/veeam-backend.db` together
