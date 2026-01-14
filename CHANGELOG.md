# Changelog

All notable changes to Veeam Single-UI will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Go Backend Architecture
- **Go Backend** - Complete backend service providing:
  - AES-256-GCM encrypted credential storage with Argon2id key derivation
  - OAuth token management with automatic refresh
  - Response caching with configurable TTL
  - Rate limiting per Veeam product (VBM 1/sec, others 10/sec)
  - Multi-server support for VBR, VRO, VBM, VB365, K10
  - RESTful API for server management, cache control, and proxy requests
  - Audit logging for security-relevant operations
  - SQLite database with WAL mode (pure Go, no CGO)

#### Setup Wizard
- **First-Run Experience** - Guided wizard at `/setup` for initial configuration:
  - Step-by-step server configuration (VBR required, VRO/VBM optional)
  - Connection testing with response time measurement
  - Skip functionality for optional products
  - Auto-generated encryption keys on first run
  - No manual .env file editing required

#### Cross-Platform Build Scripts
- **build/build-linux.sh** - Linux build script supporting:
  - amd64 and arm64 architectures
  - systemd service file generation
  - Debug/Release configurations
- **build/build-macos.sh** - macOS build script supporting:
  - Intel (amd64), Apple Silicon (arm64), Universal binaries
  - launchd plist generation
  - Auto-architecture detection
- **build/README.md** - Comprehensive build documentation for all platforms

#### Documentation
- **docs/GO_BACKEND_ARCHITECTURE.md** - High-level architecture document:
  - Why Go backend (single binary, security, cross-platform)
  - What this architecture enables
  - Future vision for native desktop apps (Wails)
  - Technical specifications (encryption, database schema)
  - Migration guide from environment variables
- **JSDoc/GoDoc Headers** - Comprehensive documentation added to 50+ files:
  - All Go backend source files (9 files)
  - All API client files (5 files)
  - All major React components (30+ files)
  - All hooks, utilities, and configuration files
  - App pages and layouts

#### Frontend Enhancements
- **Go Backend Client** (`lib/api/go-backend-client.ts`) - HTTP client for Go backend:
  - Server CRUD operations
  - Token management
  - Cache control
  - Proxy requests
- **Setup Check Provider** - Automatic redirect to setup wizard when needed
- **use-go-backend Hook** - React hooks for Go backend state management

### Changed

#### Frontend API Layer
- **veeam-client.ts** - Modified to route through Go backend:
  - Auto-detects backend availability via health check
  - Routes requests through Go backend when available
  - Falls back to legacy Next.js API routes if unavailable
  - Maintains backward compatibility

#### Build Configuration
- **Build-Windows.ps1** - Enhanced Windows build script:
  - Auto-passphrase generation on first run
  - Improved Node.js path detection
  - Better error handling and progress reporting

#### Documentation Updates
- **README.md** - Updated with:
  - Cross-platform build instructions (Windows, Linux, macOS)
  - Go backend documentation references
  - Updated architecture description
- **.github/copilot-instructions.md** - Updated with:
  - Go backend as primary architecture mode
  - New file references and patterns
  - Updated feature development workflow
- **backend/README.md** - Complete API reference and architecture diagrams

### Fixed

#### API Compatibility
- **Proxy Handler** - Fixed duplicate CORS headers by filtering upstream headers
- **VBR API Endpoints** - Added fallbacks for version compatibility:
  - `/jobs/states` → `/jobs` fallback when endpoint returns 500
  - Corrected API paths for various VBR endpoints
- **Server Detection** - Fixed `isActive` field not being set, causing "No VBR server configured" errors

### Technical Details

#### Go Backend Stack
- **Go 1.22+** with chi router
- **SQLite** via modernc.org/sqlite (pure Go, no CGO)
- **AES-256-GCM** encryption with Argon2id key derivation
- **WAL mode** for concurrent database access

#### Frontend Stack
- **Next.js 15.5.9** with App Router
- **Turbopack** for development
- **React** with TypeScript
- **shadcn/ui** + Radix primitives
- **Tailwind CSS 4**
- **TanStack Table** for data tables
- **Recharts** for visualizations

### Security

- Credentials encrypted at rest with AES-256-GCM
- Master passphrase derived using Argon2id (64MB memory, 3 iterations)
- Encryption salt auto-generated (32 bytes)
- .env file permissions set to 600 on Unix systems
- Audit logging for credential operations

### Migration Notes

#### From Environment Variables
Existing environment variable deployments continue to work:
1. Go backend is optional - frontend falls back to legacy routes
2. If using Go backend, existing env vars are auto-migrated on first run
3. After migration, env vars can be removed (credentials stored encrypted)

#### For Container Deployments
Container deployments using environment variables remain fully supported. The Go backend is primarily for:
- Windows standalone deployments
- Linux/macOS service installations
- Environments where env vars are not desired

---

## [0.1.0] - Initial Release

### Added
- Veeam Backup & Replication dashboard
- Veeam Recovery Orchestrator monitoring
- Veeam Backup for Microsoft 365 dashboard
- Theme customization
- Real-time data refresh
- Export functionality

---

[Unreleased]: https://github.com/ajbergh/veeam-single-ui/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ajbergh/veeam-single-ui/releases/tag/v0.1.0
