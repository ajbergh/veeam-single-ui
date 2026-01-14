<#
.SYNOPSIS
    Build script for Veeam Single-UI Windows standalone executable

.DESCRIPTION
    This script builds the complete Veeam Single-UI application as a standalone
    Windows package including:
    - Next.js frontend (static export)
    - Go backend compiled to .exe
    
.PARAMETER Configuration
    Build configuration: Debug or Release (default: Release)

.PARAMETER OutputPath
    Output directory for the build artifacts (default: ./dist)

.PARAMETER SkipFrontend
    Skip building the Next.js frontend

.PARAMETER SkipBackend
    Skip building the Go backend

.EXAMPLE
    .\Build-Windows.ps1
    
.EXAMPLE
    .\Build-Windows.ps1 -Configuration Debug -OutputPath C:\builds\veeam-ui

.NOTES
    Requirements:
    - Node.js 20.x or later
    - Go 1.22 or later
    - npm (comes with Node.js)
#>

param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release",
    
    [string]$OutputPath = "$PSScriptRoot\..\dist",
    
    [switch]$SkipFrontend,
    
    [switch]$SkipBackend
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Colors for output
function Write-Header { param($Message) Write-Host "`n========================================" -ForegroundColor Cyan; Write-Host $Message -ForegroundColor Cyan; Write-Host "========================================" -ForegroundColor Cyan }
function Write-Step { param($Message) Write-Host "[*] $Message" -ForegroundColor Yellow }
function Write-Success { param($Message) Write-Host "[+] $Message" -ForegroundColor Green }
function Write-Error { param($Message) Write-Host "[-] $Message" -ForegroundColor Red }

# Get project root (parent of build folder)
$ProjectRoot = Resolve-Path "$PSScriptRoot\.."
$BackendPath = Join-Path $ProjectRoot "backend"
$OutputPath = Resolve-Path $OutputPath -ErrorAction SilentlyContinue
if (-not $OutputPath) {
    $OutputPath = "$PSScriptRoot\..\dist"
    New-Item -ItemType Directory -Path $OutputPath -Force | Out-Null
    $OutputPath = Resolve-Path $OutputPath
}

Write-Header "Veeam Single-UI Windows Build"
Write-Host "Configuration: $Configuration"
Write-Host "Project Root: $ProjectRoot"
Write-Host "Output Path: $OutputPath"
Write-Host ""

# =============================================================================
# Prerequisites Check
# =============================================================================

Write-Header "Checking Prerequisites"

# Check Node.js
Write-Step "Checking Node.js..."
try {
    $nodeVersion = node --version
    Write-Success "Node.js $nodeVersion found"
} catch {
    Write-Error "Node.js not found. Please install Node.js 20.x or later from https://nodejs.org"
    exit 1
}

# Check npm
Write-Step "Checking npm..."
try {
    $npmVersion = npm --version
    Write-Success "npm $npmVersion found"
} catch {
    Write-Error "npm not found. Please install Node.js which includes npm"
    exit 1
}

# Check Go (only if building backend)
if (-not $SkipBackend) {
    Write-Step "Checking Go..."
    try {
        $goVersion = go version
        Write-Success "$goVersion"
    } catch {
        Write-Error "Go not found. Please install Go 1.22 or later from https://go.dev/dl/"
        exit 1
    }
}

# =============================================================================
# Clean Output Directory
# =============================================================================

Write-Header "Preparing Output Directory"

Write-Step "Cleaning output directory..."
if (Test-Path $OutputPath) {
    Remove-Item -Path "$OutputPath\*" -Recurse -Force -ErrorAction SilentlyContinue
}

# Create output subdirectories
$FrontendOutput = Join-Path $OutputPath "frontend"
$BackendOutput = Join-Path $OutputPath "backend"
$ConfigOutput = Join-Path $OutputPath "config"

New-Item -ItemType Directory -Path $FrontendOutput -Force | Out-Null
New-Item -ItemType Directory -Path $BackendOutput -Force | Out-Null
New-Item -ItemType Directory -Path $ConfigOutput -Force | Out-Null

Write-Success "Output directories created"

# =============================================================================
# Build Frontend
# =============================================================================

if (-not $SkipFrontend) {
    Write-Header "Building Frontend (Next.js)"
    
    Push-Location $ProjectRoot
    
    try {
        # Install dependencies (including devDependencies needed for build)
        Write-Step "Installing npm dependencies..."
        npm ci --include=dev
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm install failed"
            exit 1
        }
        Write-Success "Dependencies installed"
        
        # Build Next.js
        Write-Step "Building Next.js application..."
        
        # Note: We don't set NODE_ENV=production here because devDependencies
        # like @tailwindcss/postcss are needed during the build process
        
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Next.js build failed"
            exit 1
        }
        Write-Success "Next.js build completed"
        
        # Copy build output
        Write-Step "Copying frontend build..."
        
        # For standalone mode (server-side rendering)
        if (Test-Path ".next\standalone") {
            Copy-Item -Path ".next\standalone\*" -Destination $FrontendOutput -Recurse -Force
            
            # Copy static files
            if (Test-Path ".next\static") {
                $staticDest = Join-Path $FrontendOutput ".next\static"
                New-Item -ItemType Directory -Path (Split-Path $staticDest) -Force | Out-Null
                Copy-Item -Path ".next\static" -Destination $staticDest -Recurse -Force
            }
            
            # Copy public folder
            if (Test-Path "public") {
                Copy-Item -Path "public" -Destination (Join-Path $FrontendOutput "public") -Recurse -Force
            }
        }
        # Fallback: Copy .next folder for regular Next.js server
        else {
            Copy-Item -Path ".next" -Destination (Join-Path $FrontendOutput ".next") -Recurse -Force
            Copy-Item -Path "node_modules" -Destination (Join-Path $FrontendOutput "node_modules") -Recurse -Force
            Copy-Item -Path "package.json" -Destination $FrontendOutput -Force
            Copy-Item -Path "next.config.js" -Destination $FrontendOutput -Force
            if (Test-Path "public") {
                Copy-Item -Path "public" -Destination (Join-Path $FrontendOutput "public") -Recurse -Force
            }
        }
        
        Write-Success "Frontend copied to output"
        
    } finally {
        Pop-Location
    }
}

# =============================================================================
# Build Backend
# =============================================================================

if (-not $SkipBackend) {
    Write-Header "Building Backend (Go)"
    
    Push-Location $BackendPath
    
    try {
        # Download dependencies
        Write-Step "Downloading Go dependencies..."
        go mod download
        if ($LASTEXITCODE -ne 0) {
            Write-Error "go mod download failed"
            exit 1
        }
        Write-Success "Go dependencies downloaded"
        
        # Build settings based on configuration
        $ldflags = "-s -w"  # Strip debug info for smaller binary
        if ($Configuration -eq "Debug") {
            $ldflags = ""
        }
        
        # Build the executable
        Write-Step "Compiling Go backend..."
        $exeName = "veeam-backend.exe"
        $exePath = Join-Path $BackendOutput $exeName
        
        $env:CGO_ENABLED = "0"  # Pure Go build (no C dependencies)
        $env:GOOS = "windows"
        $env:GOARCH = "amd64"
        
        if ($ldflags) {
            go build -ldflags="$ldflags" -o $exePath ./cmd/server
        } else {
            go build -o $exePath ./cmd/server
        }
        
        if ($LASTEXITCODE -ne 0) {
            Write-Error "Go build failed"
            exit 1
        }
        
        # Get file size
        $exeSize = (Get-Item $exePath).Length / 1MB
        Write-Success "Backend compiled: $exeName ({0:N2} MB)" -f $exeSize
        
        # Create data directory
        New-Item -ItemType Directory -Path (Join-Path $BackendOutput "data") -Force | Out-Null
        
    } finally {
        Pop-Location
    }
}

# =============================================================================
# Create Configuration Files
# =============================================================================

Write-Header "Creating Configuration Files"

# Create sample environment file (for manual configuration)
$envSampleContent = @"
# =============================================================================
# Veeam Single-UI Configuration
# =============================================================================
# This file is auto-generated on first run. You typically don't need to
# create it manually - just run Start-VeeamUI.ps1 and follow the wizard.
#
# If you need to manually configure, copy this to .env and update values.

# -----------------------------------------------------------------------------
# Security & Encryption (AUTO-GENERATED ON FIRST RUN)
# -----------------------------------------------------------------------------
# The startup script will generate these automatically.
# DO NOT SHARE these values - they protect stored credentials.

# Master passphrase for encrypting stored credentials (minimum 16 characters)
# MASTER_PASSPHRASE=auto-generated-on-first-run

# Encryption salt (base64-encoded, 32 bytes)
# ENCRYPTION_SALT=auto-generated-on-first-run

# -----------------------------------------------------------------------------
# Backend Configuration
# -----------------------------------------------------------------------------
BACKEND_PORT=8080
DATABASE_PATH=./data/veeam-backend.db
ENVIRONMENT=production

# API key for backend access (optional, recommended for production)
# BACKEND_API_KEY=your-api-key

# -----------------------------------------------------------------------------
# Frontend Configuration
# -----------------------------------------------------------------------------
PORT=3000

# Go backend URL (must be accessible from browser for client-side calls)
NEXT_PUBLIC_GO_BACKEND_URL=http://localhost:8080

# -----------------------------------------------------------------------------
# TLS Configuration (Optional, recommended for production)
# -----------------------------------------------------------------------------
# TLS_CERT_FILE=./certs/server.crt
# TLS_KEY_FILE=./certs/server.key

# Allow self-signed certificates (for lab/dev environments)
NODE_TLS_REJECT_UNAUTHORIZED=0

# -----------------------------------------------------------------------------
# Legacy Configuration (Optional - for migration from older versions)
# -----------------------------------------------------------------------------
# If you have existing environment variables from a previous setup,
# they will be automatically migrated to the database on first run.

# Veeam Backup & Replication
# VEEAM_API_URL=https://your-vbr-server:9419
# VEEAM_USERNAME=your-username
# VEEAM_PASSWORD=your-password

# Veeam Recovery Orchestrator
# VRO_API_URL=https://your-vro-server:9898
# VRO_USERNAME=your-vro-username
# VRO_PASSWORD=your-vro-password

# Veeam Backup for Microsoft 365
# VBM_API_URL=https://your-vbm-server:4443
# VBM_USERNAME=your-vbm-username
# VBM_PASSWORD=your-vbm-password
"@

$envSamplePath = Join-Path $ConfigOutput ".env.sample"
Set-Content -Path $envSamplePath -Value $envSampleContent
Write-Success "Created .env.sample"

# Create startup script with auto-passphrase generation
$startupScriptContent = @'
<#
.SYNOPSIS
    Start Veeam Single-UI application

.DESCRIPTION
    Starts both the Go backend and Next.js frontend.
    On first run, automatically generates and saves a secure passphrase.

.PARAMETER BackendOnly
    Start only the Go backend

.PARAMETER FrontendOnly
    Start only the Next.js frontend

.PARAMETER Reset
    Reset the configuration (regenerate passphrase)
#>

param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$Reset
)

$ScriptRoot = $PSScriptRoot
$envFile = Join-Path $ScriptRoot ".env"

# Function to generate a secure random passphrase
function New-SecurePassphrase {
    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
    $passphrase = -join ((1..32) | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    return $passphrase
}

# Check if this is first run (no .env file)
$firstRun = (-not (Test-Path $envFile)) -or $Reset

if ($firstRun) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Veeam Single-UI - First Time Setup" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    if ($Reset) {
        Write-Host "Resetting configuration..." -ForegroundColor Yellow
        if (Test-Path $envFile) {
            Remove-Item $envFile -Force
        }
    }

    # Generate secure passphrase
    $passphrase = New-SecurePassphrase
    Write-Host "[+] Generated secure encryption passphrase" -ForegroundColor Green

    # Generate encryption salt
    $saltBytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($saltBytes)
    $salt = [Convert]::ToBase64String($saltBytes)
    Write-Host "[+] Generated encryption salt" -ForegroundColor Green

    # Create minimal .env file
    $envContent = @"
# Veeam Single-UI Configuration
# Auto-generated on first run - $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

# Encryption settings (auto-generated - DO NOT SHARE)
MASTER_PASSPHRASE=$passphrase
ENCRYPTION_SALT=$salt

# Backend settings
BACKEND_PORT=8080
DATABASE_PATH=./data/veeam-backend.db
ENVIRONMENT=production

# Frontend settings
PORT=3000

# Go backend URL for frontend
NEXT_PUBLIC_GO_BACKEND_URL=http://localhost:8080

# Allow self-signed certificates (for lab environments)
NODE_TLS_REJECT_UNAUTHORIZED=0
"@

    Set-Content -Path $envFile -Value $envContent
    Write-Host "[+] Created .env configuration file" -ForegroundColor Green
    Write-Host ""
    Write-Host "IMPORTANT: The .env file contains your encryption passphrase." -ForegroundColor Yellow
    Write-Host "Keep it secure and back it up! Losing it means losing access" -ForegroundColor Yellow
    Write-Host "to encrypted credentials in the database." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The Setup Wizard will guide you through configuring your" -ForegroundColor Cyan
    Write-Host "Veeam server connections on first login." -ForegroundColor Cyan
    Write-Host ""
}

# Load environment variables from .env
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^\s*([^#][^=]+)=(.*)$") {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    if (-not $firstRun) {
        Write-Host "[+] Loaded environment from .env" -ForegroundColor Green
    }
}

# Verify required environment variables
if (-not $env:MASTER_PASSPHRASE) {
    Write-Host "[!] Error: MASTER_PASSPHRASE not set. Run with -Reset to regenerate." -ForegroundColor Red
    exit 1
}

# Start Backend
if (-not $FrontendOnly) {
    Write-Host "[*] Starting Go Backend..." -ForegroundColor Cyan
    $backendPath = Join-Path $ScriptRoot "backend\veeam-backend.exe"
    
    if (-not (Test-Path $backendPath)) {
        Write-Host "[!] Backend executable not found: $backendPath" -ForegroundColor Red
        exit 1
    }
    
    Start-Process -FilePath $backendPath -WorkingDirectory (Split-Path $backendPath) -NoNewWindow
    $port = if ($env:BACKEND_PORT) { $env:BACKEND_PORT } else { "8080" }
    Write-Host "[+] Backend started on port $port" -ForegroundColor Green
    
    # Wait for backend to be ready
    Write-Host "[*] Waiting for backend to initialize..." -ForegroundColor Gray
    Start-Sleep -Seconds 3
    
    # Quick health check
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$port/health" -TimeoutSec 5 -UseBasicParsing -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            Write-Host "[+] Backend is healthy" -ForegroundColor Green
        }
    } catch {
        Write-Host "[!] Warning: Could not verify backend health" -ForegroundColor Yellow
    }
}

# Start Frontend
if (-not $BackendOnly) {
    Write-Host "[*] Starting Next.js Frontend..." -ForegroundColor Cyan
    $frontendPath = Join-Path $ScriptRoot "frontend"
    
    Push-Location $frontendPath
    
    $frontendPort = if ($env:PORT) { $env:PORT } else { "3000" }
    
    # Find Node.js executable
    $nodePath = Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source
    if (-not $nodePath) {
        $nodePath = "C:\Program Files\nodejs\node.exe"
    }
    if (-not (Test-Path $nodePath)) {
        Write-Host "[!] Node.js not found. Please install Node.js or add it to PATH." -ForegroundColor Red
        Pop-Location
        exit 1
    }
    
    # Check for standalone server
    if (Test-Path "server.js") {
        Write-Host "[+] Starting frontend on port $frontendPort" -ForegroundColor Green
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  Veeam Single-UI is ready!" -ForegroundColor Green
        Write-Host "  Open: http://localhost:$frontendPort" -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host ""
        & $nodePath server.js
    } else {
        # Use next start if available
        Write-Host "[+] Starting frontend with Next.js" -ForegroundColor Green
        npx next start -p $frontendPort
    }
    
    Pop-Location
}
'@

$startupScriptPath = Join-Path $OutputPath "Start-VeeamUI.ps1"
Set-Content -Path $startupScriptPath -Value $startupScriptContent
Write-Success "Created Start-VeeamUI.ps1"

# Copy config to output root
Copy-Item -Path $envSamplePath -Destination (Join-Path $OutputPath ".env.sample") -Force

# =============================================================================
# Create README
# =============================================================================

$readmeContent = @"
# Veeam Single-UI - Windows Build

## Quick Start (Zero Configuration)

Just run the startup script - it handles everything automatically:

``````powershell
.\Start-VeeamUI.ps1
``````

On first run:
1. The script generates a secure encryption passphrase automatically
2. Creates the .env configuration file
3. Starts the Go backend and Next.js frontend
4. Opens a Setup Wizard in your browser to configure Veeam servers

## What Happens on First Run

1. **Encryption Setup**: A secure 32-character passphrase is auto-generated
2. **Configuration Created**: .env file is created with secure defaults
3. **Backend Starts**: Go backend initializes SQLite database
4. **Frontend Starts**: Next.js frontend serves the web UI
5. **Setup Wizard**: Browser shows wizard to configure VBR/VRO/VBM servers

## Directory Structure

- ``backend/`` - Go backend executable and encrypted database
- ``frontend/`` - Next.js application
- ``config/`` - Sample configuration files
- ``.env`` - Your configuration (auto-generated, keep secure!)
- ``.env.sample`` - Configuration template for reference
- ``Start-VeeamUI.ps1`` - Startup script

## Command Line Options

``````powershell
# Normal startup
.\Start-VeeamUI.ps1

# Start only the backend
.\Start-VeeamUI.ps1 -BackendOnly

# Start only the frontend
.\Start-VeeamUI.ps1 -FrontendOnly

# Reset configuration (regenerate passphrase)
.\Start-VeeamUI.ps1 -Reset
``````

## Manual Start

### Backend Only
``````powershell
cd backend
.\veeam-backend.exe
``````

### Frontend Only
``````powershell
cd frontend
node server.js  # or: npx next start
``````

## Requirements

- Windows 10/11 or Windows Server 2019+
- Node.js 20.x or later (for frontend)
- Network access to Veeam API servers

## Default Ports

- Frontend: http://localhost:3000
- Backend: http://localhost:8080

## Security Notes

1. **Passphrase**: The .env file contains your encryption passphrase
   - Back it up securely
   - Don't share it
   - Losing it means losing access to stored credentials

2. **Database**: ``backend/data/veeam-backend.db`` contains encrypted credentials
   - Back up regularly
   - Requires matching passphrase to decrypt

3. **Production**: For production deployments:
   - Use TLS certificates (TLS_CERT_FILE, TLS_KEY_FILE)
   - Set BACKEND_API_KEY for additional security
   - Set ENVIRONMENT=production

## Troubleshooting

### Backend won't start
- Check that port 8080 is available
- Look for error messages in the console
- Run with -Reset to regenerate configuration

### Frontend can't connect to backend
- Verify backend is running: http://localhost:8080/health
- Check NEXT_PUBLIC_GO_BACKEND_URL in .env

### Can't connect to Veeam servers
- Verify the API URL is accessible from this machine
- Check credentials in the Setup Wizard
- For self-signed certs, NODE_TLS_REJECT_UNAUTHORIZED=0 is set by default

### Need to reconfigure servers
- Go to Administration > Servers > Connections in the UI
- Or run Start-VeeamUI.ps1 -Reset to start fresh
"@

$readmePath = Join-Path $OutputPath "README.md"
Set-Content -Path $readmePath -Value $readmeContent
Write-Success "Created README.md"

# =============================================================================
# Summary
# =============================================================================

Write-Header "Build Complete!"

$frontendSize = if (-not $SkipFrontend) { 
    $size = (Get-ChildItem -Path $FrontendOutput -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    "{0:N2} MB" -f $size
} else { "Skipped" }

$backendSize = if (-not $SkipBackend) { 
    $size = (Get-ChildItem -Path $BackendOutput -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
    "{0:N2} MB" -f $size
} else { "Skipped" }

Write-Host ""
Write-Host "Build Summary:" -ForegroundColor Cyan
Write-Host "  Output Location: $OutputPath"
Write-Host "  Configuration:   $Configuration"
Write-Host "  Frontend Size:   $frontendSize"
Write-Host "  Backend Size:    $backendSize"
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "  1. Copy the 'dist' folder to your target machine"
Write-Host "  2. Run .\Start-VeeamUI.ps1"
Write-Host "  3. Follow the Setup Wizard to configure your Veeam servers"
Write-Host ""
Write-Host "Note: No manual .env configuration required!" -ForegroundColor Green
Write-Host "      The startup script auto-generates encryption keys on first run." -ForegroundColor Green
Write-Host ""

Write-Success "Build completed successfully!"
