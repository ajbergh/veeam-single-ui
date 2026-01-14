#!/bin/bash
#
# Build script for Veeam Single-UI Linux standalone package
#
# SYNOPSIS
#     ./build-linux.sh [OPTIONS]
#
# DESCRIPTION
#     This script builds the complete Veeam Single-UI application as a standalone
#     Linux package including:
#     - Next.js frontend (static export)
#     - Go backend compiled for Linux amd64
#
# OPTIONS
#     -c, --config        Build configuration: debug or release (default: release)
#     -o, --output        Output directory for build artifacts (default: ./dist)
#     --skip-frontend     Skip building the Next.js frontend
#     --skip-backend      Skip building the Go backend
#     --arch              Target architecture: amd64, arm64 (default: amd64)
#     -h, --help          Show this help message
#
# EXAMPLES
#     ./build-linux.sh
#     ./build-linux.sh --config debug --output /opt/veeam-ui/build
#     ./build-linux.sh --arch arm64
#
# REQUIREMENTS
#     - Node.js 20.x or later
#     - Go 1.22 or later
#     - npm (comes with Node.js)
#

set -e

# Default values
CONFIGURATION="release"
OUTPUT_PATH=""
SKIP_FRONTEND=false
SKIP_BACKEND=false
TARGET_ARCH="amd64"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "\n${CYAN}========================================${NC}"
    echo -e "${CYAN}$1${NC}"
    echo -e "${CYAN}========================================${NC}"
}

print_step() {
    echo -e "${YELLOW}[*] $1${NC}"
}

print_success() {
    echo -e "${GREEN}[+] $1${NC}"
}

print_error() {
    echo -e "${RED}[-] $1${NC}"
}

show_help() {
    head -n 30 "$0" | tail -n 26 | sed 's/^#//'
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -c|--config)
            CONFIGURATION="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_PATH="$2"
            shift 2
            ;;
        --skip-frontend)
            SKIP_FRONTEND=true
            shift
            ;;
        --skip-backend)
            SKIP_BACKEND=true
            shift
            ;;
        --arch)
            TARGET_ARCH="$2"
            shift 2
            ;;
        -h|--help)
            show_help
            ;;
        *)
            print_error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Set default output path if not specified
if [[ -z "$OUTPUT_PATH" ]]; then
    OUTPUT_PATH="$PROJECT_ROOT/dist"
fi

# Validate configuration
CONFIGURATION=$(echo "$CONFIGURATION" | tr '[:upper:]' '[:lower:]')
if [[ "$CONFIGURATION" != "debug" && "$CONFIGURATION" != "release" ]]; then
    print_error "Invalid configuration: $CONFIGURATION. Use 'debug' or 'release'"
    exit 1
fi

# Validate architecture
if [[ "$TARGET_ARCH" != "amd64" && "$TARGET_ARCH" != "arm64" ]]; then
    print_error "Invalid architecture: $TARGET_ARCH. Use 'amd64' or 'arm64'"
    exit 1
fi

print_header "Veeam Single-UI Linux Build"
echo "Configuration: $CONFIGURATION"
echo "Architecture:  $TARGET_ARCH"
echo "Project Root:  $PROJECT_ROOT"
echo "Output Path:   $OUTPUT_PATH"
echo ""

# =============================================================================
# Prerequisites Check
# =============================================================================

print_header "Checking Prerequisites"

# Check Node.js
print_step "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_success "Node.js $NODE_VERSION found"
else
    print_error "Node.js not found. Please install Node.js 20.x or later"
    echo "  Ubuntu/Debian: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    echo "  Fedora/RHEL:   sudo dnf install nodejs"
    exit 1
fi

# Check npm
print_step "Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    print_success "npm $NPM_VERSION found"
else
    print_error "npm not found. Please install Node.js which includes npm"
    exit 1
fi

# Check Go (only if building backend)
if [[ "$SKIP_BACKEND" == false ]]; then
    print_step "Checking Go..."
    if command -v go &> /dev/null; then
        GO_VERSION=$(go version)
        print_success "$GO_VERSION"
    else
        print_error "Go not found. Please install Go 1.22 or later"
        echo "  Download from: https://go.dev/dl/"
        exit 1
    fi
fi

# =============================================================================
# Clean Output Directory
# =============================================================================

print_header "Preparing Output Directory"

print_step "Cleaning output directory..."
mkdir -p "$OUTPUT_PATH"
rm -rf "${OUTPUT_PATH:?}"/*

# Create output subdirectories
FRONTEND_OUTPUT="$OUTPUT_PATH/frontend"
BACKEND_OUTPUT="$OUTPUT_PATH/backend"
CONFIG_OUTPUT="$OUTPUT_PATH/config"

mkdir -p "$FRONTEND_OUTPUT"
mkdir -p "$BACKEND_OUTPUT"
mkdir -p "$CONFIG_OUTPUT"
mkdir -p "$BACKEND_OUTPUT/data"

print_success "Output directories created"

# =============================================================================
# Build Frontend
# =============================================================================

if [[ "$SKIP_FRONTEND" == false ]]; then
    print_header "Building Frontend (Next.js)"
    
    pushd "$PROJECT_ROOT" > /dev/null
    
    # Install dependencies
    print_step "Installing npm dependencies..."
    npm ci --include=dev
    print_success "Dependencies installed"
    
    # Build Next.js
    print_step "Building Next.js application..."
    npm run build
    print_success "Next.js build completed"
    
    # Copy build output
    print_step "Copying frontend build..."
    
    # For standalone mode
    if [[ -d ".next/standalone" ]]; then
        cp -r .next/standalone/* "$FRONTEND_OUTPUT/"
        
        # Copy static files
        if [[ -d ".next/static" ]]; then
            mkdir -p "$FRONTEND_OUTPUT/.next"
            cp -r .next/static "$FRONTEND_OUTPUT/.next/"
        fi
        
        # Copy public folder
        if [[ -d "public" ]]; then
            cp -r public "$FRONTEND_OUTPUT/"
        fi
    else
        # Fallback: Copy .next folder
        cp -r .next "$FRONTEND_OUTPUT/"
        cp -r node_modules "$FRONTEND_OUTPUT/"
        cp package.json "$FRONTEND_OUTPUT/"
        cp next.config.js "$FRONTEND_OUTPUT/"
        if [[ -d "public" ]]; then
            cp -r public "$FRONTEND_OUTPUT/"
        fi
    fi
    
    print_success "Frontend copied to output"
    
    popd > /dev/null
fi

# =============================================================================
# Build Backend
# =============================================================================

if [[ "$SKIP_BACKEND" == false ]]; then
    print_header "Building Backend (Go)"
    
    pushd "$PROJECT_ROOT/backend" > /dev/null
    
    # Download dependencies
    print_step "Downloading Go dependencies..."
    go mod download
    print_success "Go dependencies downloaded"
    
    # Build settings based on configuration
    LDFLAGS=""
    if [[ "$CONFIGURATION" == "release" ]]; then
        LDFLAGS="-s -w"  # Strip debug info for smaller binary
    fi
    
    # Build the executable
    print_step "Compiling Go backend for linux/$TARGET_ARCH..."
    EXE_NAME="veeam-backend"
    EXE_PATH="$BACKEND_OUTPUT/$EXE_NAME"
    
    export CGO_ENABLED=0
    export GOOS=linux
    export GOARCH=$TARGET_ARCH
    
    if [[ -n "$LDFLAGS" ]]; then
        go build -ldflags="$LDFLAGS" -o "$EXE_PATH" ./cmd/server
    else
        go build -o "$EXE_PATH" ./cmd/server
    fi
    
    # Make executable
    chmod +x "$EXE_PATH"
    
    # Get file size
    EXE_SIZE=$(du -h "$EXE_PATH" | cut -f1)
    print_success "Backend compiled: $EXE_NAME ($EXE_SIZE)"
    
    popd > /dev/null
fi

# =============================================================================
# Create Configuration Files
# =============================================================================

print_header "Creating Configuration Files"

# Create sample environment file
cat > "$CONFIG_OUTPUT/.env.sample" << 'EOF'
# =============================================================================
# Veeam Single-UI Configuration
# =============================================================================
# This file is auto-generated on first run. You typically don't need to
# create it manually - just run start-veeam-ui.sh and follow the wizard.

# -----------------------------------------------------------------------------
# Security & Encryption (AUTO-GENERATED ON FIRST RUN)
# -----------------------------------------------------------------------------
# MASTER_PASSPHRASE=auto-generated-on-first-run
# ENCRYPTION_SALT=auto-generated-on-first-run

# -----------------------------------------------------------------------------
# Backend Configuration
# -----------------------------------------------------------------------------
BACKEND_PORT=8080
DATABASE_PATH=./data/veeam-backend.db
ENVIRONMENT=production

# -----------------------------------------------------------------------------
# Frontend Configuration
# -----------------------------------------------------------------------------
PORT=3000
NEXT_PUBLIC_GO_BACKEND_URL=http://localhost:8080

# -----------------------------------------------------------------------------
# TLS Configuration (Optional)
# -----------------------------------------------------------------------------
# TLS_CERT_FILE=./certs/server.crt
# TLS_KEY_FILE=./certs/server.key

# Allow self-signed certificates (for lab/dev environments)
NODE_TLS_REJECT_UNAUTHORIZED=0
EOF

cp "$CONFIG_OUTPUT/.env.sample" "$OUTPUT_PATH/.env.sample"
print_success "Created .env.sample"

# Create startup script
cat > "$OUTPUT_PATH/start-veeam-ui.sh" << 'STARTUP_SCRIPT'
#!/bin/bash
#
# Start Veeam Single-UI application
#
# On first run, automatically generates and saves a secure passphrase.
#
# OPTIONS
#     --backend-only      Start only the Go backend
#     --frontend-only     Start only the Next.js frontend
#     --reset             Reset the configuration (regenerate passphrase)
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

BACKEND_ONLY=false
FRONTEND_ONLY=false
RESET=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --backend-only) BACKEND_ONLY=true; shift ;;
        --frontend-only) FRONTEND_ONLY=true; shift ;;
        --reset) RESET=true; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

# Function to generate a secure random passphrase
generate_passphrase() {
    head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 32
}

# Function to generate encryption salt
generate_salt() {
    head -c 32 /dev/urandom | base64
}

# Check if this is first run
if [[ ! -f "$ENV_FILE" ]] || [[ "$RESET" == true ]]; then
    echo ""
    echo "========================================"
    echo "  Veeam Single-UI - First Time Setup"
    echo "========================================"
    echo ""

    if [[ "$RESET" == true ]] && [[ -f "$ENV_FILE" ]]; then
        echo "Resetting configuration..."
        rm -f "$ENV_FILE"
    fi

    # Generate secure passphrase
    PASSPHRASE=$(generate_passphrase)
    echo "[+] Generated secure encryption passphrase"

    # Generate encryption salt
    SALT=$(generate_salt)
    echo "[+] Generated encryption salt"

    # Create .env file
    cat > "$ENV_FILE" << EOF
# Veeam Single-UI Configuration
# Auto-generated on first run - $(date)

# Encryption settings (auto-generated - DO NOT SHARE)
MASTER_PASSPHRASE=$PASSPHRASE
ENCRYPTION_SALT=$SALT

# Backend settings
BACKEND_PORT=8080
DATABASE_PATH=./data/veeam-backend.db
ENVIRONMENT=production

# Frontend settings
PORT=3000
NEXT_PUBLIC_GO_BACKEND_URL=http://localhost:8080

# Allow self-signed certificates
NODE_TLS_REJECT_UNAUTHORIZED=0
EOF

    chmod 600 "$ENV_FILE"
    echo "[+] Created .env configuration file"
    echo ""
    echo "IMPORTANT: The .env file contains your encryption passphrase."
    echo "Keep it secure and back it up!"
    echo ""
    echo "The Setup Wizard will guide you through configuring your"
    echo "Veeam server connections on first login."
    echo ""
fi

# Load environment variables
if [[ -f "$ENV_FILE" ]]; then
    set -a
    source "$ENV_FILE"
    set +a
    echo "[+] Loaded environment from .env"
fi

# Verify required environment variables
if [[ -z "$MASTER_PASSPHRASE" ]]; then
    echo "[!] Error: MASTER_PASSPHRASE not set. Run with --reset to regenerate."
    exit 1
fi

# Start Backend
if [[ "$FRONTEND_ONLY" == false ]]; then
    echo "[*] Starting Go Backend..."
    BACKEND_PATH="$SCRIPT_DIR/backend/veeam-backend"
    
    if [[ ! -f "$BACKEND_PATH" ]]; then
        echo "[!] Backend executable not found: $BACKEND_PATH"
        exit 1
    fi
    
    cd "$(dirname "$BACKEND_PATH")"
    ./"$(basename "$BACKEND_PATH")" &
    BACKEND_PID=$!
    
    PORT=${BACKEND_PORT:-8080}
    echo "[+] Backend started on port $PORT (PID: $BACKEND_PID)"
    
    # Wait for backend to be ready
    echo "[*] Waiting for backend to initialize..."
    sleep 3
    
    # Quick health check
    if curl -s "http://localhost:$PORT/health" > /dev/null 2>&1; then
        echo "[+] Backend is healthy"
    else
        echo "[!] Warning: Could not verify backend health"
    fi
    
    cd "$SCRIPT_DIR"
fi

# Start Frontend
if [[ "$BACKEND_ONLY" == false ]]; then
    echo "[*] Starting Next.js Frontend..."
    cd "$SCRIPT_DIR/frontend"
    
    FRONTEND_PORT=${PORT:-3000}
    
    # Check for standalone server
    if [[ -f "server.js" ]]; then
        echo "[+] Starting frontend on port $FRONTEND_PORT"
        echo ""
        echo "========================================"
        echo "  Veeam Single-UI is ready!"
        echo "  Open: http://localhost:$FRONTEND_PORT"
        echo "========================================"
        echo ""
        node server.js
    else
        echo "[+] Starting frontend with Next.js"
        npx next start -p "$FRONTEND_PORT"
    fi
fi
STARTUP_SCRIPT

chmod +x "$OUTPUT_PATH/start-veeam-ui.sh"
print_success "Created start-veeam-ui.sh"

# Create systemd service file
cat > "$CONFIG_OUTPUT/veeam-ui.service" << 'EOF'
[Unit]
Description=Veeam Single-UI
After=network.target

[Service]
Type=simple
User=veeam-ui
WorkingDirectory=/opt/veeam-ui
ExecStart=/opt/veeam-ui/start-veeam-ui.sh
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

# Security hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/veeam-ui/backend/data

[Install]
WantedBy=multi-user.target
EOF

print_success "Created veeam-ui.service (systemd)"

# Create README
cat > "$OUTPUT_PATH/README.md" << 'EOF'
# Veeam Single-UI - Linux Build

## Quick Start

```bash
# Make the startup script executable (if not already)
chmod +x start-veeam-ui.sh

# Run the application
./start-veeam-ui.sh
```

On first run:
1. A secure encryption passphrase is auto-generated
2. The .env configuration file is created
3. Backend starts on port 8080
4. Frontend starts on port 3000
5. Setup Wizard guides you through server configuration

## Directory Structure

- `backend/` - Go backend executable and encrypted database
- `frontend/` - Next.js application
- `config/` - Sample configuration and systemd service
- `.env` - Your configuration (auto-generated, keep secure!)
- `start-veeam-ui.sh` - Main startup script

## Command Line Options

```bash
# Normal startup
./start-veeam-ui.sh

# Start only the backend
./start-veeam-ui.sh --backend-only

# Start only the frontend
./start-veeam-ui.sh --frontend-only

# Reset configuration (regenerate passphrase)
./start-veeam-ui.sh --reset
```

## Installation as a Service

```bash
# Copy files to /opt
sudo mkdir -p /opt/veeam-ui
sudo cp -r * /opt/veeam-ui/

# Create service user
sudo useradd -r -s /bin/false veeam-ui

# Set permissions
sudo chown -R veeam-ui:veeam-ui /opt/veeam-ui
sudo chmod 600 /opt/veeam-ui/.env

# Install and start service
sudo cp config/veeam-ui.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable veeam-ui
sudo systemctl start veeam-ui

# Check status
sudo systemctl status veeam-ui
```

## Requirements

- Linux (tested on Ubuntu 22.04, RHEL 8+, Debian 12)
- Node.js 20.x or later
- Network access to Veeam API servers

## Default Ports

- Frontend: http://localhost:3000
- Backend: http://localhost:8080

## Security Notes

1. **Passphrase**: The `.env` file contains your encryption passphrase
   - Permissions are set to 600 (owner read/write only)
   - Back it up securely
   - Losing it means losing access to stored credentials

2. **Database**: `backend/data/veeam-backend.db` contains encrypted credentials
   - Back up regularly with the .env file

3. **Firewall**: Consider limiting access to ports 3000 and 8080

## Troubleshooting

### Backend won't start
- Check that port 8080 is available: `lsof -i :8080`
- Look for errors: `journalctl -u veeam-ui -f`
- Run with --reset to regenerate configuration

### Frontend can't connect to backend
- Verify backend is running: `curl http://localhost:8080/health`
- Check NEXT_PUBLIC_GO_BACKEND_URL in .env

### Permission denied
- Make startup script executable: `chmod +x start-veeam-ui.sh`
- Make backend executable: `chmod +x backend/veeam-backend`
EOF

print_success "Created README.md"

# =============================================================================
# Summary
# =============================================================================

print_header "Build Complete!"

if [[ "$SKIP_FRONTEND" == false ]]; then
    FRONTEND_SIZE=$(du -sh "$FRONTEND_OUTPUT" 2>/dev/null | cut -f1 || echo "N/A")
else
    FRONTEND_SIZE="Skipped"
fi

if [[ "$SKIP_BACKEND" == false ]]; then
    BACKEND_SIZE=$(du -sh "$BACKEND_OUTPUT" 2>/dev/null | cut -f1 || echo "N/A")
else
    BACKEND_SIZE="Skipped"
fi

echo ""
echo "Build Summary:"
echo "  Output Location: $OUTPUT_PATH"
echo "  Configuration:   $CONFIGURATION"
echo "  Architecture:    $TARGET_ARCH"
echo "  Frontend Size:   $FRONTEND_SIZE"
echo "  Backend Size:    $BACKEND_SIZE"
echo ""
echo "Next Steps:"
echo "  1. Copy the 'dist' folder to your target machine"
echo "  2. Run ./start-veeam-ui.sh"
echo "  3. Follow the Setup Wizard to configure your Veeam servers"
echo ""
echo "Note: No manual .env configuration required!"
echo "      The startup script auto-generates encryption keys on first run."
echo ""

print_success "Build completed successfully!"
