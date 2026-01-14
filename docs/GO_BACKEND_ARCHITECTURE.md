# Go Backend Architecture: Design Decisions & Future Vision

This document explains the architectural decisions behind adding a Go backend to Veeam Single-UI, what it enables today, and the roadmap for future capabilities.

## Executive Summary

The Go backend transforms Veeam Single-UI from a simple Next.js dashboard into an enterprise-ready platform with:
- **Secure credential storage** without environment variables
- **Response caching** to reduce API load and improve performance
- **Rate limiting** to prevent API throttling
- **Multi-server support** for managing entire Veeam environments
- **Foundation for native applications** via future Wails integration

---

## Why Go? The Decision Matrix

### 1. Single Binary Distribution

| Concern | Node.js | Go |
|---------|---------|-----|
| Dependencies | 100+ MB node_modules | Zero - single binary |
| Startup time | 2-5 seconds (cold start) | ~50ms |
| Memory footprint | 100-200 MB base | 10-30 MB |
| Distribution | Requires Node.js runtime | Drop-in executable |

**The Problem**: Deploying Next.js API routes requires Node.js runtime, package management, and significant disk space. For IT teams managing Veeam environments, installing Node.js is often not practical.

**The Solution**: Go compiles to a single, self-contained executable. The entire backend is one file (~15-20 MB) that runs on any supported OS without dependencies.

### 2. Security-First Credential Management

| Approach | Environment Variables | Go Backend |
|----------|----------------------|------------|
| Encryption | None (plain text) | AES-256-GCM |
| Key derivation | N/A | Argon2id |
| Storage | Process memory, shell history | SQLite with encrypted fields |
| Rotation | Manual file editing | API-driven |
| Audit trail | None | Full audit logging |

**The Problem**: Storing credentials in environment variables means:
- Plain text in `.env` files
- Visible in process listings
- Logged in shell history
- Hard to rotate without restarts

**The Solution**: The Go backend's crypto vault:
- Uses AES-256-GCM with Argon2id key derivation
- Encrypts credentials before database storage
- Generates encryption keys automatically on first run
- Provides API endpoints for credential rotation
- Maintains audit logs of all operations

### 3. Cross-Platform Native Code

| Feature | Node.js | Go |
|---------|---------|-----|
| CGO required | Often (native modules) | No (pure Go SQLite) |
| Cross-compilation | Complex (rebuild node_modules) | Trivial (GOOS/GOARCH) |
| Static linking | Difficult | Default |
| Binary size | N/A (requires runtime) | 15-20 MB |

**The Problem**: Next.js API routes are JavaScript - they require the full Node.js ecosystem and can't be distributed as native executables.

**The Solution**: Go's cross-compilation model means:
```bash
# Build for Windows from Linux/Mac
GOOS=windows GOARCH=amd64 go build -o veeam-backend.exe ./cmd/server

# Build for ARM (Raspberry Pi, AWS Graviton)
GOOS=linux GOARCH=arm64 go build -o veeam-backend-arm ./cmd/server
```

### 4. Pure Go Dependencies (No CGO)

The backend uses `modernc.org/sqlite` - a complete SQLite implementation in pure Go. This means:
- No C compiler required for builds
- True cross-compilation without toolchain complexity
- Smaller binary size than CGO SQLite bindings
- Same SQLite compatibility and performance

---

## What This Branch Enables

### For End Users

1. **Zero-Configuration Deployment**
   - Download, run, done
   - Setup wizard guides through server configuration
   - No editing environment files

2. **Faster Dashboard Loading**
   - Response caching reduces API calls by 80%+
   - Common queries return in <10ms from cache
   - Background refresh keeps data current

3. **Multi-Server Management**
   - Connect multiple VBR servers
   - Connect multiple VRO instances
   - Unified view across the environment

4. **Improved Reliability**
   - Rate limiting prevents API throttling
   - Automatic token refresh (no session timeouts)
   - Graceful degradation on API errors

### For Operations Teams

1. **Service Installation**
   - systemd service for Linux
   - launchd plist for macOS
   - NSSM-ready for Windows services

2. **Secure Credential Rotation**
   - API-driven credential updates
   - No service restarts required
   - Audit trail of all changes

3. **Performance Monitoring**
   - Cache hit/miss statistics
   - Rate limit status endpoints
   - Health check endpoints

### For Developers

1. **Clean Architecture**
   - Frontend: React/Next.js for UI
   - Backend: Go for API/data layer
   - Clear separation of concerns

2. **Simpler Testing**
   - Backend unit tests with `go test`
   - Frontend tests with Jest/Vitest
   - Integration tests against Go backend

3. **Type Safety Throughout**
   - TypeScript for frontend
   - Strong typing in Go
   - Types in sync across layers

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         Browser                                   │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Next.js Frontend (:3000)                      │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    veeam-client.ts                          │ │
│  │  • Auto-detects Go backend availability                     │ │
│  │  • Routes through backend when available                    │ │
│  │  • Falls back to legacy API routes if needed                │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────┐          ┌─────────────────────────────┐   │
│  │ go-backend-     │          │    Next.js API Routes       │   │
│  │ client.ts       │          │    (Legacy Fallback)        │   │
│  └────────┬────────┘          └─────────────────────────────┘   │
└───────────┼─────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Go Backend (:8080)                            │
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ Rate Limiter │ │ Auth Manager │ │     Response Cache       │ │
│  │ (per-product)│ │(auto-refresh)│ │     (TTL-based)          │ │
│  └──────────────┘ └──────────────┘ └──────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │                    Crypto Vault                              │ │
│  │  • AES-256-GCM encryption                                   │ │
│  │  • Argon2id key derivation                                  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              SQLite Database (WAL mode)                      │ │
│  │  servers | tokens | cache | audit_logs                      │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Veeam Products                                 │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐    │
│  │   VBR   │ │   VRO   │ │   VBM   │ │  VB365  │ │   K10   │    │
│  │  :9419  │ │  :9898  │ │  :4443  │ │  :4443  │ │  :8000  │    │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

---

## Future Vision: Native Desktop Application

### Phase 1: Current (Complete)
- Go backend with encrypted storage
- Web-based frontend
- Script-based deployment

### Phase 2: Wails Integration (Planned)
[Wails](https://wails.io/) enables Go backends with native webview frontends:

```
┌──────────────────────────────────────────────────────────────────┐
│                  Single Native Application                        │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │              Native Window (WebView2/WebKit)                 │ │
│  │                                                               │ │
│  │   ┌───────────────────────────────────────────────────────┐  │ │
│  │   │            Next.js/React Frontend                      │  │ │
│  │   │            (compiled to static assets)                 │  │ │
│  │   └───────────────────────────────────────────────────────┘  │ │
│  │              │                                                │ │
│  │              │ Wails Bridge (Go ↔ JavaScript)                │ │
│  │              ▼                                                │ │
│  │   ┌───────────────────────────────────────────────────────┐  │ │
│  │   │              Go Backend (embedded)                     │  │ │
│  │   │   • Crypto vault   • Rate limiting                     │  │ │
│  │   │   • Token manager  • Response cache                    │  │ │
│  │   │   • SQLite DB      • Veeam API client                  │  │ │
│  │   └───────────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  Single .exe / .app / binary - No installation required          │
└──────────────────────────────────────────────────────────────────┘
```

#### Wails Benefits:
- **True Single Executable**: One file for entire application
- **Native OS Integration**: System tray, notifications, file dialogs
- **No Browser Required**: Uses native webview (Edge/WebKit)
- **Shared Codebase**: Same Go backend code
- **Cross-Platform**: Windows, macOS, Linux from one source

#### Wails Migration Path:
1. Current Go backend already structured for embedding
2. Frontend can be compiled as static assets
3. Wails wraps both in native executable
4. Existing features preserved, new native features enabled

### Phase 3: Enhanced Native Features (Future)
- System tray with backup status
- Native notifications for job failures
- Auto-start on login
- Keychain/Credential Manager integration
- Dark mode synced with OS

---

## Migration Guide

### From Environment Variables to Go Backend

1. **Build the application**
   ```bash
   ./build/build-linux.sh  # or Build-Windows.ps1, build-macos.sh
   ```

2. **Start and configure**
   ```bash
   ./start-veeam-ui.sh  # Launches setup wizard
   ```

3. **Your existing env vars are migrated automatically**
   - `VEEAM_API_URL` → VBR server entry
   - `VRO_API_URL` → VRO server entry
   - `VBM_API_URL` → VBM server entry

4. **Credentials are encrypted**
   - Stored in SQLite with AES-256-GCM
   - Original env vars can be removed

### Fallback Mode

If the Go backend is unavailable, the frontend automatically falls back to legacy Next.js API routes. This ensures:
- Backward compatibility with existing deployments
- Development without running the backend
- Container deployments using env vars

---

## Technical Details

### Encryption Specification

| Parameter | Value |
|-----------|-------|
| Algorithm | AES-256-GCM |
| Key Derivation | Argon2id |
| Argon2 Memory | 64 MB |
| Argon2 Iterations | 3 |
| Argon2 Parallelism | 4 |
| Salt Length | 32 bytes |
| Nonce Length | 12 bytes (GCM standard) |

### Database Schema

```sql
-- Server configurations
CREATE TABLE servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    product_type TEXT NOT NULL,  -- vbr, vro, vbm, vb365, k10
    api_url TEXT NOT NULL,
    username_encrypted BLOB,
    password_encrypted BLOB,
    verify_ssl BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- OAuth tokens (encrypted)
CREATE TABLE tokens (
    server_id TEXT PRIMARY KEY,
    access_token_encrypted BLOB,
    refresh_token_encrypted BLOB,
    expires_at TIMESTAMP,
    created_at TIMESTAMP
);

-- Response cache
CREATE TABLE cache (
    key TEXT PRIMARY KEY,
    data BLOB,  -- gzip compressed
    expires_at TIMESTAMP,
    created_at TIMESTAMP
);

-- Audit trail
CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY,
    event_type TEXT,
    server_id TEXT,
    details TEXT,
    created_at TIMESTAMP
);
```

### API Rate Limits

| Product | Requests/Second | Burst |
|---------|-----------------|-------|
| VBR | 10 | 20 |
| VRO | 10 | 20 |
| VBM | 1 | 1 |
| VB365 | 1 | 1 |
| K10 | 10 | 20 |

---

## Contributing

The Go backend is in `backend/` with this structure:

```
backend/
├── cmd/server/         # Application entry point
├── internal/
│   ├── cache/          # Response caching
│   ├── config/         # Configuration management
│   ├── crypto/         # AES-256-GCM vault
│   ├── database/       # SQLite operations
│   ├── handlers/       # HTTP handlers
│   ├── middleware/     # CORS, auth, rate limiting
│   ├── tokens/         # OAuth token management
│   └── veeam/          # Veeam API clients
├── go.mod
└── Makefile
```

### Running Tests

```bash
cd backend
go test -v ./...
```

### Building

```bash
cd backend
go build -o bin/veeam-backend ./cmd/server
```

---

## References

- [Go Backend README](./backend/README.md) - API reference and detailed documentation
- [Implementation Status](./docs/GO_BACKEND_IMPLEMENTATION.md) - Phase completion tracking
- [Build Scripts](./build/README.md) - Cross-platform build instructions
- [Wails Framework](https://wails.io/) - Future native application framework
