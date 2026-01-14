# Veeam Backend

Go backend service for Veeam Single-UI providing encrypted credential storage, token management, and API caching.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Browser                                        │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Next.js Frontend                                    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                       veeam-client.ts                                │    │
│  │  • shouldUseGoBackend() - checks if backend is available            │    │
│  │  • requestViaGoBackend() - routes through Go backend                │    │
│  │  • requestLegacy() - fallback to Next.js API routes                 │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                            │
│                    ┌────────────┴────────────┐                              │
│                    ▼                         ▼                              │
│   ┌────────────────────────┐   ┌────────────────────────────────────┐      │
│   │   Go Backend Client    │   │     Next.js API Routes             │      │
│   │   (go-backend-client)  │   │   (Legacy - /api/veeam/*)          │      │
│   └───────────┬────────────┘   └────────────────────────────────────┘      │
└───────────────┼─────────────────────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Go Backend (:8080)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         API Layer                                    │    │
│  │  /api/v1/servers - Server management                                 │    │
│  │  /api/v1/proxy/{id}/* - Cached proxy requests                        │    │
│  │  /api/v1/cache/* - Cache management                                  │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                            │
│  ┌──────────────┐  ┌────────────┴────┐  ┌────────────────┐                  │
│  │ Rate Limiter │  │  Response Cache │  │ Token Manager  │                  │
│  │ (per-product)│  │  (TTL-based)    │  │ (auto-refresh) │                  │
│  └──────────────┘  └─────────────────┘  └────────────────┘                  │
│                                 │                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                      Crypto Vault                                    │    │
│  │  • AES-256-GCM encryption                                            │    │
│  │  • Argon2id key derivation                                           │    │
│  └──────────────────────────────┬──────────────────────────────────────┘    │
│                                 │                                            │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                    SQLite Database                                   │    │
│  │  servers, tokens, cache, audit_logs                                  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Veeam Products                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │   VBR    │  │   VRO    │  │   VBM    │  │  VB365   │  │   K10    │      │
│  │  :9419   │  │  :9898   │  │  :4443   │  │  :4443   │  │  :8000   │      │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Request Initiation**: Browser makes API call (e.g., fetch jobs)
2. **Client Routing**: `veeam-client.ts` checks if Go backend is enabled
3. **Go Backend Path** (preferred):
   - Request goes to Go backend via `go-backend-client.ts`
   - Rate limiter ensures API limits aren't exceeded
   - Cache is checked for existing response
   - On cache miss: authenticate, call Veeam API, cache response
   - Response returned with cache headers
4. **Legacy Path** (fallback):
   - Request goes to Next.js API routes (`/api/veeam/*`)
   - Direct call to Veeam API with basic auth
   - No caching or rate limiting

### Component Details

| Component | Purpose | Key Files |
|-----------|---------|-----------|
| **Crypto Vault** | Encrypt/decrypt credentials and tokens | `internal/crypto/vault.go` |
| **Token Manager** | Store and refresh access tokens | `internal/database/tokens.go` |
| **Cache Layer** | TTL-based response caching | `internal/database/cache.go` |
| **Rate Limiter** | Per-product request throttling | `internal/middleware/ratelimit.go` |
| **Proxy Handler** | Forward requests to Veeam APIs | `internal/handlers/proxy.go` |
| **Audit Logger** | Track security-relevant operations | `internal/database/audit.go` |

## Features

- **Encrypted Credential Storage**: AES-256-GCM encryption with Argon2id key derivation
- **Token Management**: Persistent, encrypted token storage with automatic refresh
- **Multi-Server Support**: Manage multiple Veeam servers (VBR, VRO, VBM, VB365, K10)
- **SQLite Database**: Lightweight, embedded database with WAL mode
- **API Caching**: TTL-based response caching (Phase 3)
- **Audit Logging**: Track all credential and API operations
- **Rate Limiting**: Per-product rate limiting (especially for VBM's 1 req/sec)

## Quick Start

### Prerequisites

- Go 1.22+
- Make (optional, for convenience) - Or run Go commands directly

> **Note:** This project uses a pure-Go SQLite driver (modernc.org/sqlite) - no C compiler or CGO required!

### Windows Setup

1. **Install Go**: Download from https://go.dev/dl/

2. **Run the backend**:
   ```powershell
   cd backend
   
   # Set required environment variable
   $env:MASTER_PASSPHRASE = "your-secure-passphrase-at-least-16-chars"
   
   # Optional: Set other environment variables
   $env:BACKEND_PORT = "8080"
   $env:DATABASE_PATH = "./data/veeam-backend.db"
   
   # Run
   go run ./cmd/server
   ```

### Development Setup

```bash
# Clone and navigate to backend
cd backend

# Download dependencies
go mod download

# Run tests
go test -v ./...

# Build
go build -o bin/veeam-backend.exe ./cmd/server

# Run (requires MASTER_PASSPHRASE)
# PowerShell:
$env:MASTER_PASSPHRASE="your-secure-passphrase"; go run ./cmd/server

# Bash/Git Bash:
MASTER_PASSPHRASE="your-secure-passphrase" go run ./cmd/server
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MASTER_PASSPHRASE` | Yes* | Auto-generated | Master passphrase for encryption (min 16 chars) |
| `ENCRYPTION_SALT` | Recommended | Auto-generated | Base64-encoded salt for key derivation |
| `BACKEND_PORT` | No | 8080 | Server port |
| `DATABASE_PATH` | No | `./data/veeam-backend.db` | SQLite database path |
| `BACKEND_API_KEY` | No | - | API key for authentication (if set, all API calls require it) |
| `ENVIRONMENT` | No | development | `development` or `production` |
| `LOG_JSON` | No | false | Output logs in JSON format |
| `TLS_CERT_FILE` | No | - | Path to TLS certificate |
| `TLS_KEY_FILE` | No | - | Path to TLS private key |

**\* Auto-generated**: When using the Windows Standalone Build, `MASTER_PASSPHRASE` and `ENCRYPTION_SALT` are automatically generated on first run. See [Auto-Passphrase Generation](#auto-passphrase-generation).

#### Auto-Passphrase Generation

The Windows Standalone Build startup script (`start-veeam-unified-manager.ps1`) automatically generates secure encryption configuration on first run:

1. **MASTER_PASSPHRASE**: A cryptographically secure 32-character passphrase using `RandomNumberGenerator`
2. **ENCRYPTION_SALT**: A 32-byte base64-encoded salt

These values are stored in a `.env` file in the application directory. To regenerate:

```powershell
# Regenerate encryption configuration (WARNING: Existing encrypted data will be lost!)
.\start-veeam-unified-manager.ps1 -Reset
```

#### Legacy Environment Variables (Migration)

For backward compatibility, the backend will migrate these env vars to the database on first run:

| Variable | Product |
|----------|---------|
| `VEEAM_API_URL`, `VEEAM_USERNAME`, `VEEAM_PASSWORD` | VBR |
| `VRO_API_URL`, `VRO_USERNAME`, `VRO_PASSWORD` | VRO |
| `VBM_API_URL`, `VBM_USERNAME`, `VBM_PASSWORD` | VBM |

## API Reference

### Health Endpoints

```bash
# Liveness probe
GET /health

# Readiness probe (checks database)
GET /ready
```

### Server Management

```bash
# List all servers
GET /api/v1/servers
GET /api/v1/servers?productType=vbr

# Create server
POST /api/v1/servers
{
  "name": "Production VBR",
  "productType": "vbr",
  "apiUrl": "https://vbr.example.com:9419",
  "username": "administrator",
  "password": "secret",
  "verifySSL": true,
  "isDefault": true
}

# Get server
GET /api/v1/servers/{id}

# Update server
PUT /api/v1/servers/{id}
{
  "name": "Updated Name",
  "password": "new-password"  # Optional - only update if provided
}

# Delete server
DELETE /api/v1/servers/{id}
```

### Token Management

```bash
# Authenticate a single server (connects to Veeam API)
POST /api/v1/servers/{id}/authenticate

# Authenticate multiple servers at once
POST /api/v1/servers/authenticate
{
  "serverIds": ["uuid1", "uuid2"]
}

# Get current access token (auto-refreshes if expiring soon)
GET /api/v1/servers/{id}/token
# Response: { "accessToken": "..." }

# Get token status
GET /api/v1/servers/{id}/token/status
# Response: { "serverId": "...", "hasToken": true, "isExpired": false, "expiresIn": 840 }

# Logout (invalidate token)
POST /api/v1/servers/{id}/logout
```

### Setup Wizard

The setup wizard provides a guided first-start experience when no servers are configured:

```bash
# Check if setup is needed
GET /api/v1/setup/status
# Response: 
# {
#   "needsSetup": true,
#   "hasVbr": false,
#   "hasVro": false,
#   "hasVbm": false,
#   "configuredProducts": [],
#   "message": "No servers configured. Please complete the setup wizard."
# }

# Test connection without saving (validation only)
POST /api/v1/setup/test
{
  "productType": "vbr",
  "apiUrl": "https://vbr.example.com:9419",
  "username": "administrator",
  "password": "secret",
  "verifySSL": true
}
# Response:
# {
#   "success": true,
#   "message": "Successfully connected to VBR",
#   "version": "12.3.0.123",
#   "serverInfo": { ... }
# }

# Process a wizard step (saves server configuration)
POST /api/v1/setup/wizard
{
  "step": "vbr",           # Step: "vbr", "vro", "vbm", or "complete"
  "action": "configure",   # Action: "configure" or "skip"
  "server": {              # Required if action is "configure"
    "productType": "vbr",
    "apiUrl": "https://vbr.example.com:9419",
    "username": "administrator",
    "password": "secret",
    "verifySSL": true
  }
}
# Response:
# {
#   "success": true,
#   "message": "VBR server configured successfully",
#   "nextStep": "vro",
#   "isComplete": false,
#   "serverInfo": { ... }
# }

# Mark setup as complete
POST /api/v1/setup/complete
# Response:
# {
#   "success": true,
#   "message": "Setup completed successfully",
#   "configuredProducts": ["vbr", "vro"]
# }
```

**Wizard Flow:**
1. Frontend checks `GET /api/v1/setup/status`
2. If `needsSetup` is true, redirect to `/setup`
3. User configures VBR (required)
4. User optionally configures VRO (can skip)
5. User optionally configures VBM (can skip)
6. Frontend calls `POST /api/v1/setup/complete`

### Cache Management

```bash
# Get cache statistics
GET /api/v1/cache/stats
# Response: { "totalEntries": 42, "totalSizeBytes": 1048576, "hitCount": 500, "missCount": 100, "hitRate": 0.83 }

# Get cache configuration
GET /api/v1/cache/config

# Invalidate all cache entries
DELETE /api/v1/cache

# Invalidate cache for a specific server
DELETE /api/v1/servers/{id}/cache

# Invalidate cache entries matching a pattern
DELETE /api/v1/servers/{id}/cache/jobs

# Get rate limiter statistics
GET /api/v1/cache/ratelimit

# Reset rate limiter for a server
POST /api/v1/servers/{id}/ratelimit/reset
```

### API Proxy (with Caching)

The proxy endpoints forward requests to Veeam APIs with automatic caching and rate limiting:

```bash
# Proxy GET requests (cached)
GET /api/v1/proxy/{serverID}/api/v1/jobs
# Response includes: X-Cache: HIT/MISS, X-Cache-Age, X-Cache-TTL headers

# Proxy mutation requests (not cached, invalidates related cache)
POST /api/v1/proxy/{serverID}/api/v1/jobs/{id}/start
PUT /api/v1/proxy/{serverID}/api/v1/jobs/{id}
DELETE /api/v1/proxy/{serverID}/api/v1/jobs/{id}
```

**Rate Limiting by Product:**
| Product | Requests/Second | Burst Size |
|---------|-----------------|------------|
| VBR     | 10              | 20         |
| VRO     | 10              | 20         |
| VBM     | 1               | 1          |
| VB365   | 1               | 1          |
| K10     | 10              | 20         |

### Authentication

If `BACKEND_API_KEY` is set, all `/api/v1/*` endpoints require authentication:

```bash
# Using header
curl -H "X-API-Key: your-api-key" http://localhost:8080/api/v1/servers

# Using Bearer token
curl -H "Authorization: Bearer your-api-key" http://localhost:8080/api/v1/servers
```

## Security Considerations

1. **Master Passphrase**: Use a strong, unique passphrase. This is the master key for all encryption.
2. **Encryption Salt**: Use a persistent, random salt. Generate with PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))`
3. **API Key**: Always use an API key in production.
4. **TLS**: Enable TLS in production using `TLS_CERT_FILE` and `TLS_KEY_FILE`.
5. **Database Backup**: Regularly backup the SQLite database file. It contains encrypted credentials.

## Development

```powershell
# Run tests
go test -v ./...

# Run tests with coverage
go test -v -coverprofile=coverage.out ./...
go tool cover -html=coverage.out -o coverage.html

# Run benchmarks
go test -bench=. -benchmem ./...

# Format code
go fmt ./...
```

## Project Structure

```
backend/
├── cmd/
│   └── server/
│       └── main.go           # Application entry point
├── internal/
│   ├── config/
│   │   └── config.go         # Configuration loading
│   ├── crypto/
│   │   ├── vault.go          # AES-256-GCM encryption
│   │   └── vault_test.go     # Crypto tests
│   ├── database/
│   │   ├── sqlite.go         # Database connection & migrations
│   │   ├── servers.go        # Server CRUD operations
│   │   ├── tokens.go         # Token operations
│   │   ├── cache.go          # Cache operations
│   │   ├── audit.go          # Audit log operations
│   │   └── models/           # Data models
│   ├── handlers/
│   │   ├── health.go         # Health check handlers
│   │   ├── credentials.go    # Server management handlers
│   │   ├── proxy.go          # API proxy handlers
│   │   └── setup.go          # Setup wizard handlers
│   ├── tokens/
│   │   └── manager.go        # Token lifecycle management
│   └── middleware/
│       ├── auth.go           # API key authentication
│       ├── cors.go           # CORS middleware
│       ├── ratelimit.go      # Rate limiting middleware
│       └── logging.go        # Request logging
├── Makefile
├── go.mod
└── go.sum
```

## Next.js Integration

The Go backend integrates seamlessly with the Next.js frontend through automatic routing in `veeam-client.ts`.

### Frontend Configuration

Add these environment variables to your Next.js `.env.local`:

```env
# Enable Go backend integration
GO_BACKEND_URL=http://localhost:8080
GO_BACKEND_ENABLED=true
```

### How Routing Works

When Go backend is enabled, the `VeeamApiClient` in `lib/api/veeam-client.ts`:

1. Checks if Go backend is available via `/health` endpoint
2. Looks up the primary server for the product type (VBR/VRO/VBM)
3. Routes requests through `goBackendClient.proxyGet/Post/Put/Delete`
4. Falls back to legacy Next.js API routes on error

```typescript
// Example: Original code continues to work
const jobs = await veeamApi.getBackupJobs();

// Under the hood with Go backend enabled:
// 1. shouldUseGoBackend() → true
// 2. getServerForProduct('vbr') → primary VBR server
// 3. goBackendClient.proxyGet(serverId, '/api/v1/jobs')
// 4. Go backend: cache check → rate limit → forward to VBR
```

### Administration UI

The frontend includes administration pages for managing the Go backend:

- **Servers → Connections** (`/administration/servers/connections`):
  - Add/remove Veeam servers
  - View authentication status
  - Authenticate all servers
  
- **Servers → Cache** (`/administration/servers/cache`):
  - View cache statistics (hit rate, size)
  - Invalidate cache per-server or globally
  - View and reset rate limiters

### Key Frontend Files

| File | Purpose |
|------|---------|
| `lib/api/go-backend-client.ts` | HTTP client for Go backend API |
| `lib/api/veeam-client.ts` | Main API client with Go backend routing |
| `lib/config/backend.ts` | Configuration helper for Go backend |
| `hooks/use-go-backend.ts` | React hooks for backend state |
| `app/setup/page.tsx` | Setup wizard UI |
| `components/setup-wizard/*` | Setup wizard components |
| `components/setup-check-provider.tsx` | Setup status checker (redirects to wizard) |
| `app/administration/servers/*` | Administration UI pages |

## Cache Strategy

### TTL by Endpoint Type

| Endpoint Pattern | TTL | Rationale |
|-----------------|-----|-----------|
| `/jobs` | 30s | Job status changes frequently |
| `/sessions` | 15s | Active sessions update rapidly |
| `/backups` | 60s | Backup data is relatively stable |
| `/repositories` | 60s | Infrastructure rarely changes |
| `/license` | 300s | License info is static |
| Default | 60s | Reasonable default for most endpoints |

### Cache Invalidation

- **Automatic**: POST/PUT/DELETE requests invalidate related cache entries
- **Manual**: Use `/api/v1/cache` endpoints or Administration UI
- **Pattern-based**: Invalidate entries matching a URL pattern

### Cache Headers

Responses include cache-related headers:

```
X-Cache: HIT          # Cache hit
X-Cache: MISS         # Cache miss
X-Cache-Age: 15       # Seconds since cached
X-Cache-TTL: 45       # Seconds until expiry
```

## Troubleshooting

### Common Issues

#### "No server configured for product type"

The Go backend has no server registered for the requested product. Add one via:
- Administration UI: `/administration/servers/connections`
- API: `POST /api/v1/servers`

#### "Token expired or invalid"

The cached token has expired. The backend should auto-refresh, but if not:
- Check server credentials are correct
- Verify network connectivity to Veeam server
- Try: `POST /api/v1/servers/{id}/authenticate`

#### "Rate limit exceeded"

You've hit the API rate limit. Wait or reset:
- Wait for the limit window to pass
- Reset via: `POST /api/v1/servers/{id}/ratelimit/reset`

#### "Backend not available" (fallback to legacy)

The Go backend is unreachable. Check:
- Is the Go backend running? `curl http://localhost:8080/health`
- Is `GO_BACKEND_URL` correct in Next.js env?
- Are there firewall/network issues?

### Debug Logging

Enable verbose logging:

```bash
# Go backend
$env:LOG_JSON = "true"
$env:ENVIRONMENT = "development"

# Check backend logs for request tracing
```

## License

See the main project [LICENSE](../LICENSE) file.
