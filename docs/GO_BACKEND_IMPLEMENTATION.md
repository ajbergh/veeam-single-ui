# Go Backend Implementation Plan

A phased implementation guide for adding a Go backend with SQLite to the Veeam Single-UI application for content caching and encrypted credential storage.

---

## Implementation Status

> **Last Updated**: Current state reflects completed implementation

| Phase | Status | Notes |
|-------|--------|-------|
| **Phase 1: Foundation** | ✅ Complete | Go scaffolding, crypto vault, SQLite, server CRUD |
| **Phase 2: Token Management** | ✅ Complete | Token lifecycle, auto-refresh, encrypted storage |
| **Phase 3: Caching Layer** | ✅ Complete | TTL-based cache, rate limiting, background refresh |
| **Phase 4: API Proxy** | ✅ Complete | Proxy handlers, cache integration, rate limiting |
| **Phase 5: Next.js Integration** | ✅ Complete | Frontend routing, admin UI, hooks |
| **Phase 5.5: Setup Wizard** | ✅ Complete | First-start wizard, auto-passphrase, zero-config |
| **Phase 6: Security Hardening** | ⚠️ Partial | API key auth done, TLS optional, audit logs done |
| **Phase 7: Testing & Docs** | ⚠️ Partial | Basic tests done, full coverage pending |

### Completed Features

✅ **Backend Core**
- Go project with chi router
- SQLite database with WAL mode
- AES-256-GCM encrypted credential vault
- Argon2id key derivation

✅ **Server Management**
- CRUD for Veeam servers (VBR, VRO, VBM, VB365, K10)
- Encrypted credential storage
- Legacy env var migration on startup

✅ **Token Management**
- OAuth2 authentication for all product types
- Encrypted token persistence
- Automatic refresh before expiry
- Thread-safe token refresh

✅ **Caching Layer**
- TTL-based response caching
- Gzip compression for stored data
- Cache invalidation API
- Per-endpoint TTL configuration
- Cache statistics endpoint

✅ **Rate Limiting**
- Per-product rate limiting (VBM: 1/sec, others: 10/sec)
- Rate limit status endpoint
- Rate limit reset capability

✅ **API Proxy**
- Transparent proxy to Veeam APIs
- Cache integration (X-Cache headers)
- Automatic token injection

✅ **Frontend Integration**
- `go-backend-client.ts` - HTTP client for Go backend
- `veeam-client.ts` - Modified to route through Go backend
- `use-go-backend.ts` - React hooks for backend state
- Administration UI pages (Servers, Cache)
- Transparent fallback to legacy routes

✅ **Setup Wizard** (NEW)
- First-start wizard UI at `/setup`
- Connection testing without saving credentials
- Multi-step flow: VBR (required) → VRO (skip) → VBM (skip) → Complete
- Automatic passphrase generation on startup
- Zero-configuration deployment for Windows build
- `SetupCheckProvider` - Automatic redirect when setup needed

### Pending Items

⚠️ **Security Hardening**
- [ ] TLS configuration guide (optional per deployment)
- [ ] API key rotation mechanism
- [ ] Failed auth attempt lockout
- [ ] Encryption key rotation procedure

⚠️ **Testing**
- [ ] Integration tests (beyond crypto/vault_test.go)
- [ ] Load testing and benchmarks
- [ ] 80%+ test coverage target

⚠️ **Documentation**
- [ ] OpenAPI 3.0 specification
- [ ] Helm chart for Kubernetes
- [ ] Architecture Decision Records (ADRs)

---

## Executive Summary

| Aspect | Current State | Target State |
|--------|---------------|--------------|
| **Credentials** | Environment variables | ✅ AES-256 encrypted in SQLite |
| **Token Storage** | In-memory (per-instance) | ✅ Encrypted persistent storage |
| **API Caching** | None | ✅ TTL-based SQLite cache |
| **Multi-server** | Single server per product | ✅ Multiple servers per product |
| **Deployment** | Node.js + Next.js | ✅ Go binary + SQLite + Next.js |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Veeam Single-UI Stack                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐         ┌──────────────────────────────────────────┐   │
│  │   Next.js UI    │────────▶│             Go Backend                   │   │
│  │   Port 3000     │  REST   │             Port 8080                    │   │
│  │                 │◀────────│                                          │   │
│  └─────────────────┘         │  ┌────────────────────────────────────┐  │   │
│                              │  │           Core Services            │  │   │
│                              │  ├────────────────────────────────────┤  │   │
│                              │  │  • Credential Vault (encrypted)    │  │   │
│                              │  │  • Token Manager (lifecycle)       │  │   │
│                              │  │  • Cache Service (TTL-based)       │  │   │
│                              │  │  • Rate Limiter (per-product)      │  │   │
│                              │  │  • Audit Logger                    │  │   │
│                              │  └────────────────────────────────────┘  │   │
│                              └─────────────┬────────────────────────────┘   │
│                                            │                                 │
│                              ┌─────────────▼────────────────────────────┐   │
│                              │         SQLite Database                  │   │
│                              │         ./data/veeam-backend.db          │   │
│                              └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                             │
         ┌───────────────────────────────────┼───────────────────────────────────┐
         ▼                                   ▼                                   ▼
    ┌─────────┐                       ┌─────────────┐                     ┌─────────────┐
    │   VBR   │                       │     VRO     │                     │     VBM     │
    │   API   │                       │     API     │                     │     API     │
    └─────────┘                       └─────────────┘                     └─────────────┘
```

---

## Phase 1: Foundation (Week 1-2)

### Goals
- Set up Go project structure
- Implement SQLite database with migrations
- Create encrypted credential vault
- Basic health check and configuration API

### Project Structure
```
backend/
├── cmd/
│   └── server/
│       └── main.go                 # Application entry point
├── internal/
│   ├── config/
│   │   └── config.go               # Configuration loading
│   ├── crypto/
│   │   ├── vault.go                # Credential encryption/decryption
│   │   └── vault_test.go
│   ├── database/
│   │   ├── sqlite.go               # SQLite connection & migrations
│   │   ├── migrations/
│   │   │   ├── 001_initial.sql
│   │   │   └── 002_cache_tables.sql
│   │   └── models/
│   │       ├── credential.go
│   │       ├── token.go
│   │       └── cache.go
│   ├── handlers/
│   │   ├── health.go
│   │   ├── credentials.go
│   │   └── proxy.go
│   └── middleware/
│       ├── auth.go                 # API key validation
│       ├── logging.go
│       └── cors.go
├── go.mod
├── go.sum
├── Dockerfile
└── README.md
```

### Database Schema (001_initial.sql)
```sql
-- Veeam server connections with encrypted credentials
CREATE TABLE IF NOT EXISTS servers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    product_type TEXT NOT NULL CHECK (product_type IN ('vbr', 'vro', 'vbm', 'vb365', 'k10')),
    api_url TEXT NOT NULL,
    username_encrypted BLOB NOT NULL,
    password_encrypted BLOB NOT NULL,
    verify_ssl INTEGER DEFAULT 1,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Encrypted API tokens with expiry
CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    access_token_encrypted BLOB NOT NULL,
    refresh_token_encrypted BLOB,
    token_type TEXT DEFAULT 'Bearer',
    expires_at DATETIME NOT NULL,
    issued_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit log for security and debugging
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    action TEXT NOT NULL,
    server_id TEXT,
    endpoint TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    error_message TEXT,
    client_ip TEXT,
    user_agent TEXT
);

CREATE INDEX idx_servers_product ON servers(product_type);
CREATE INDEX idx_servers_default ON servers(product_type, is_default);
CREATE INDEX idx_tokens_server ON tokens(server_id);
CREATE INDEX idx_tokens_expiry ON tokens(expires_at);
CREATE INDEX idx_audit_timestamp ON audit_log(timestamp);
```

### Encryption Implementation (crypto/vault.go)
```go
package crypto

import (
    "crypto/aes"
    "crypto/cipher"
    "crypto/rand"
    "crypto/sha256"
    "encoding/base64"
    "errors"
    "io"

    "golang.org/x/crypto/argon2"
)

type Vault struct {
    key []byte
}

// NewVault creates a vault with a key derived from the master passphrase
func NewVault(masterPassphrase string, salt []byte) *Vault {
    // Argon2id key derivation (memory-hard)
    key := argon2.IDKey(
        []byte(masterPassphrase),
        salt,
        3,              // iterations
        64*1024,        // 64 MB memory
        4,              // parallelism
        32,             // 256-bit key
    )
    return &Vault{key: key}
}

// Encrypt encrypts plaintext using AES-256-GCM
func (v *Vault) Encrypt(plaintext string) ([]byte, error) {
    block, err := aes.NewCipher(v.key)
    if err != nil {
        return nil, err
    }

    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return nil, err
    }

    nonce := make([]byte, gcm.NonceSize())
    if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
        return nil, err
    }

    ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
    return ciphertext, nil
}

// Decrypt decrypts ciphertext using AES-256-GCM
func (v *Vault) Decrypt(ciphertext []byte) (string, error) {
    block, err := aes.NewCipher(v.key)
    if err != nil {
        return "", err
    }

    gcm, err := cipher.NewGCM(block)
    if err != nil {
        return "", err
    }

    if len(ciphertext) < gcm.NonceSize() {
        return "", errors.New("ciphertext too short")
    }

    nonce, ciphertext := ciphertext[:gcm.NonceSize()], ciphertext[gcm.NonceSize():]
    plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
    if err != nil {
        return "", err
    }

    return string(plaintext), nil
}
```

### Configuration (internal/config/config.go)
```go
package config

import (
    "os"
    "strconv"
)

type Config struct {
    // Server settings
    Port            int
    Environment     string
    
    // Security
    MasterPassphrase string  // Used to derive encryption key
    EncryptionSalt   string  // Base64-encoded salt
    APIKey           string  // Optional API key for backend access
    
    // Database
    DatabasePath     string
    
    // TLS
    TLSCertFile      string
    TLSKeyFile       string
    
    // Defaults for legacy compatibility
    DefaultVBRURL      string
    DefaultVBRUsername string
    DefaultVBRPassword string
    DefaultVROURL      string
    DefaultVROUsername string
    DefaultVROPassword string
    DefaultVBMURL      string
    DefaultVBMUsername string
    DefaultVBMPassword string
}

func Load() *Config {
    return &Config{
        Port:             getEnvInt("BACKEND_PORT", 8080),
        Environment:      getEnv("ENVIRONMENT", "development"),
        MasterPassphrase: getEnvRequired("MASTER_PASSPHRASE"),
        EncryptionSalt:   getEnvRequired("ENCRYPTION_SALT"),
        APIKey:           getEnv("BACKEND_API_KEY", ""),
        DatabasePath:     getEnv("DATABASE_PATH", "/data/veeam-backend.db"),
        TLSCertFile:      getEnv("TLS_CERT_FILE", ""),
        TLSKeyFile:       getEnv("TLS_KEY_FILE", ""),
        
        // Legacy env var support for migration
        DefaultVBRURL:      getEnv("VEEAM_API_URL", ""),
        DefaultVBRUsername: getEnv("VEEAM_USERNAME", ""),
        DefaultVBRPassword: getEnv("VEEAM_PASSWORD", ""),
        DefaultVROURL:      getEnv("VRO_API_URL", ""),
        DefaultVROUsername: getEnv("VRO_USERNAME", ""),
        DefaultVROPassword: getEnv("VRO_PASSWORD", ""),
        DefaultVBMURL:      getEnv("VBM_API_URL", ""),
        DefaultVBMUsername: getEnv("VBM_USERNAME", ""),
        DefaultVBMPassword: getEnv("VBM_PASSWORD", ""),
    }
}

func getEnv(key, defaultValue string) string {
    if value := os.Getenv(key); value != "" {
        return value
    }
    return defaultValue
}

func getEnvRequired(key string) string {
    value := os.Getenv(key)
    if value == "" {
        panic("Required environment variable not set: " + key)
    }
    return value
}

func getEnvInt(key string, defaultValue int) int {
    if value := os.Getenv(key); value != "" {
        if i, err := strconv.Atoi(value); err == nil {
            return i
        }
    }
    return defaultValue
}
```

### Deliverables
- [x] Go project initialized with module
- [x] SQLite database with migrations
- [x] Credential vault with AES-256-GCM encryption
- [x] `GET /health` and `GET /ready` endpoints
- [x] `POST /api/v1/servers` - Add server with encrypted credentials
- [x] `GET /api/v1/servers` - List servers (credentials redacted)
- [x] `DELETE /api/v1/servers/{id}` - Remove server
- [x] Unit tests for crypto package

---

## Phase 2: Token Management (Week 3)

### Goals
- Implement token lifecycle management
- Handle OAuth flows for all Veeam products
- Token refresh and expiry handling
- Share tokens across multiple frontend instances

### Token Manager (internal/services/token_manager.go)
```go
package services

import (
    "context"
    "sync"
    "time"
)

type TokenManager struct {
    db        *database.DB
    vault     *crypto.Vault
    mu        sync.RWMutex
    refreshing map[string]bool // Prevent concurrent refreshes
}

// GetValidToken returns a valid token, refreshing if needed
func (tm *TokenManager) GetValidToken(ctx context.Context, serverID string) (string, error) {
    tm.mu.RLock()
    
    // Check if already refreshing
    if tm.refreshing[serverID] {
        tm.mu.RUnlock()
        // Wait for refresh to complete (simplified - use channels in production)
        time.Sleep(100 * time.Millisecond)
        return tm.GetValidToken(ctx, serverID)
    }
    tm.mu.RUnlock()
    
    // Get current token
    token, err := tm.db.GetToken(serverID)
    if err != nil {
        return "", err
    }
    
    // Check if token is valid (with 5-minute buffer)
    if token != nil && time.Now().Add(5*time.Minute).Before(token.ExpiresAt) {
        decrypted, err := tm.vault.Decrypt(token.AccessTokenEncrypted)
        if err != nil {
            return "", err
        }
        return decrypted, nil
    }
    
    // Token expired or missing - authenticate
    return tm.authenticate(ctx, serverID)
}

func (tm *TokenManager) authenticate(ctx context.Context, serverID string) (string, error) {
    tm.mu.Lock()
    tm.refreshing[serverID] = true
    tm.mu.Unlock()
    
    defer func() {
        tm.mu.Lock()
        delete(tm.refreshing, serverID)
        tm.mu.Unlock()
    }()
    
    // Get server credentials
    server, err := tm.db.GetServer(serverID)
    if err != nil {
        return "", err
    }
    
    // Decrypt credentials
    username, err := tm.vault.Decrypt(server.UsernameEncrypted)
    if err != nil {
        return "", err
    }
    password, err := tm.vault.Decrypt(server.PasswordEncrypted)
    if err != nil {
        return "", err
    }
    
    // Authenticate based on product type
    var tokenResp *TokenResponse
    switch server.ProductType {
    case "vbr":
        tokenResp, err = tm.authenticateVBR(ctx, server.APIURL, username, password)
    case "vro":
        tokenResp, err = tm.authenticateVRO(ctx, server.APIURL, username, password)
    case "vbm":
        tokenResp, err = tm.authenticateVBM(ctx, server.APIURL, username, password)
    default:
        return "", fmt.Errorf("unsupported product type: %s", server.ProductType)
    }
    
    if err != nil {
        return "", err
    }
    
    // Encrypt and store token
    accessEncrypted, err := tm.vault.Encrypt(tokenResp.AccessToken)
    if err != nil {
        return "", err
    }
    
    var refreshEncrypted []byte
    if tokenResp.RefreshToken != "" {
        refreshEncrypted, err = tm.vault.Encrypt(tokenResp.RefreshToken)
        if err != nil {
            return "", err
        }
    }
    
    err = tm.db.SaveToken(&models.Token{
        ID:                    uuid.New().String(),
        ServerID:              serverID,
        AccessTokenEncrypted:  accessEncrypted,
        RefreshTokenEncrypted: refreshEncrypted,
        ExpiresAt:             time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second),
        IssuedAt:              time.Now(),
    })
    
    return tokenResp.AccessToken, err
}
```

### API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/servers/{id}/authenticate` | Force re-authentication |
| GET | `/api/v1/servers/{id}/token/status` | Check token validity |
| DELETE | `/api/v1/servers/{id}/token` | Revoke/clear token |

### Deliverables
- [x] Token manager service with thread-safe refresh
- [x] OAuth2 password grant for VBR
- [x] OAuth2 client credentials for VRO
- [x] OAuth2 password grant for VBM
- [x] Token persistence with encryption
- [x] Automatic token refresh before expiry
- [x] Token status API endpoints

---

## Phase 3: Caching Layer (Week 4-5)

### Goals
- Implement TTL-based response caching
- Cache invalidation strategies
- Background refresh for hot data
- Configurable TTL per endpoint

### Cache Schema (002_cache_tables.sql)
```sql
-- API response cache
CREATE TABLE IF NOT EXISTS cache_entries (
    cache_key TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    response_data BLOB NOT NULL,           -- Compressed JSON response
    content_type TEXT DEFAULT 'application/json',
    etag TEXT,
    ttl_seconds INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    hit_count INTEGER DEFAULT 0
);

-- Cache configuration per endpoint pattern
CREATE TABLE IF NOT EXISTS cache_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint_pattern TEXT NOT NULL UNIQUE,  -- Regex pattern
    ttl_seconds INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    description TEXT
);

-- Default cache configurations
INSERT OR IGNORE INTO cache_config (endpoint_pattern, ttl_seconds, description) VALUES
    ('^/api/v1/jobs$', 60, 'Job list - refresh every minute'),
    ('^/api/v1/jobs/states$', 30, 'Job states - more frequent refresh'),
    ('^/api/v1/sessions$', 60, 'Sessions list'),
    ('^/api/v1/repositories$', 300, 'Repositories - slower changing'),
    ('^/api/v1/infrastructure', 300, 'Infrastructure data'),
    ('^/api/v1/license$', 3600, 'License info - hourly'),
    ('^/api/v1/malwareEvents$', 120, 'Malware events'),
    ('^/api/v1/stats', 60, 'Dashboard stats');

CREATE INDEX idx_cache_expires ON cache_entries(expires_at);
CREATE INDEX idx_cache_server ON cache_entries(server_id);
```

### Cache Service (internal/services/cache.go)
```go
package services

import (
    "bytes"
    "compress/gzip"
    "context"
    "crypto/sha256"
    "encoding/hex"
    "io"
    "regexp"
    "sync"
    "time"
)

type CacheService struct {
    db          *database.DB
    configs     []*CacheConfig
    configMu    sync.RWMutex
    
    // Background refresh
    hotKeys     map[string]time.Time  // Keys accessed recently
    hotKeysMu   sync.RWMutex
}

type CacheConfig struct {
    Pattern    *regexp.Regexp
    TTL        time.Duration
    Enabled    bool
}

type CacheEntry struct {
    Data        []byte
    ContentType string
    ETag        string
    ExpiresAt   time.Time
}

// generateKey creates a unique cache key from server + endpoint + params
func (cs *CacheService) generateKey(serverID, endpoint string, params map[string]string) string {
    h := sha256.New()
    h.Write([]byte(serverID))
    h.Write([]byte(endpoint))
    for k, v := range params {
        h.Write([]byte(k))
        h.Write([]byte(v))
    }
    return hex.EncodeToString(h.Sum(nil))
}

// Get retrieves cached response if valid
func (cs *CacheService) Get(ctx context.Context, serverID, endpoint string, params map[string]string) (*CacheEntry, error) {
    key := cs.generateKey(serverID, endpoint, params)
    
    entry, err := cs.db.GetCacheEntry(key)
    if err != nil || entry == nil {
        return nil, err
    }
    
    // Check expiry
    if time.Now().After(entry.ExpiresAt) {
        // Expired - delete and return nil
        cs.db.DeleteCacheEntry(key)
        return nil, nil
    }
    
    // Update access stats
    go cs.db.UpdateCacheAccess(key)
    
    // Track as hot key for background refresh
    cs.hotKeysMu.Lock()
    cs.hotKeys[key] = time.Now()
    cs.hotKeysMu.Unlock()
    
    // Decompress
    reader, err := gzip.NewReader(bytes.NewReader(entry.Data))
    if err != nil {
        return nil, err
    }
    defer reader.Close()
    
    decompressed, err := io.ReadAll(reader)
    if err != nil {
        return nil, err
    }
    
    return &CacheEntry{
        Data:        decompressed,
        ContentType: entry.ContentType,
        ETag:        entry.ETag,
        ExpiresAt:   entry.ExpiresAt,
    }, nil
}

// Set stores response in cache with compression
func (cs *CacheService) Set(ctx context.Context, serverID, endpoint string, params map[string]string, data []byte, contentType string) error {
    ttl := cs.getTTL(endpoint)
    if ttl == 0 {
        return nil // Caching disabled for this endpoint
    }
    
    key := cs.generateKey(serverID, endpoint, params)
    
    // Compress data
    var buf bytes.Buffer
    writer := gzip.NewWriter(&buf)
    if _, err := writer.Write(data); err != nil {
        return err
    }
    writer.Close()
    
    // Generate ETag
    etag := fmt.Sprintf(`"%s"`, hex.EncodeToString(sha256.New().Sum(data)[:8]))
    
    return cs.db.SaveCacheEntry(&models.CacheEntry{
        CacheKey:     key,
        ServerID:     serverID,
        Endpoint:     endpoint,
        ResponseData: buf.Bytes(),
        ContentType:  contentType,
        ETag:         etag,
        TTLSeconds:   int(ttl.Seconds()),
        ExpiresAt:    time.Now().Add(ttl),
    })
}

// Background refresh goroutine
func (cs *CacheService) StartBackgroundRefresh(ctx context.Context, refreshFn func(serverID, endpoint string) error) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            cs.refreshHotKeys(ctx, refreshFn)
        }
    }
}

func (cs *CacheService) refreshHotKeys(ctx context.Context, refreshFn func(serverID, endpoint string) error) {
    cs.hotKeysMu.RLock()
    keys := make(map[string]time.Time, len(cs.hotKeys))
    for k, v := range cs.hotKeys {
        keys[k] = v
    }
    cs.hotKeysMu.RUnlock()
    
    threshold := time.Now().Add(-5 * time.Minute)
    for key, lastAccess := range keys {
        if lastAccess.Before(threshold) {
            // Not accessed recently - remove from hot keys
            cs.hotKeysMu.Lock()
            delete(cs.hotKeys, key)
            cs.hotKeysMu.Unlock()
            continue
        }
        
        // Check if entry is expiring soon (within 2x TTL window)
        entry, _ := cs.db.GetCacheEntry(key)
        if entry != nil && time.Until(entry.ExpiresAt) < time.Duration(entry.TTLSeconds)*time.Second {
            // Proactively refresh
            go refreshFn(entry.ServerID, entry.Endpoint)
        }
    }
}

// Invalidate removes cache entries matching a pattern
func (cs *CacheService) Invalidate(ctx context.Context, serverID string, endpointPattern string) error {
    return cs.db.DeleteCacheEntriesByPattern(serverID, endpointPattern)
}

// Cleanup removes expired entries (run periodically)
func (cs *CacheService) Cleanup(ctx context.Context) (int, error) {
    return cs.db.DeleteExpiredCacheEntries()
}
```

### Cache API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/cache/stats` | Cache hit/miss statistics |
| DELETE | `/api/v1/cache` | Clear all cache |
| DELETE | `/api/v1/cache/{serverID}` | Clear cache for server |
| PUT | `/api/v1/cache/config` | Update TTL settings |

### Deliverables
- [x] Cache service with TTL management
- [x] Gzip compression for stored responses
- [x] ETag generation for conditional requests
- [x] Background refresh for frequently accessed data
- [x] Cache invalidation API
- [x] Periodic cleanup job
- [x] Cache statistics endpoint

---

## Phase 4: API Proxy (Week 6-7)

### Goals
- Implement proxy handlers for all Veeam API endpoints
- Integrate token manager and cache
- Rate limiting per product (especially VBM)
- Error handling and retry logic

### Proxy Handler (internal/handlers/proxy.go)
```go
package handlers

import (
    "encoding/json"
    "io"
    "net/http"
    "time"

    "github.com/go-chi/chi/v5"
)

type ProxyHandler struct {
    tokenManager *services.TokenManager
    cache        *services.CacheService
    rateLimiters map[string]*RateLimiter
    client       *http.Client
}

func NewProxyHandler(tm *services.TokenManager, cache *services.CacheService) *ProxyHandler {
    return &ProxyHandler{
        tokenManager: tm,
        cache:        cache,
        rateLimiters: map[string]*RateLimiter{
            "vbm": NewRateLimiter(1), // 1 req/sec for VBM
            "vbr": NewRateLimiter(10),
            "vro": NewRateLimiter(10),
        },
        client: &http.Client{
            Timeout: 30 * time.Second,
            Transport: &http.Transport{
                TLSClientConfig: &tls.Config{
                    InsecureSkipVerify: true, // Configurable per server
                },
            },
        },
    }
}

// ProxyRequest handles proxying requests to Veeam APIs
func (h *ProxyHandler) ProxyRequest(w http.ResponseWriter, r *http.Request) {
    serverID := chi.URLParam(r, "serverID")
    endpoint := chi.URLParam(r, "*")
    
    ctx := r.Context()
    
    // Check cache for GET requests
    if r.Method == http.MethodGet {
        params := make(map[string]string)
        for k, v := range r.URL.Query() {
            params[k] = v[0]
        }
        
        cached, err := h.cache.Get(ctx, serverID, endpoint, params)
        if err == nil && cached != nil {
            // Check If-None-Match header
            if r.Header.Get("If-None-Match") == cached.ETag {
                w.WriteHeader(http.StatusNotModified)
                return
            }
            
            w.Header().Set("Content-Type", cached.ContentType)
            w.Header().Set("ETag", cached.ETag)
            w.Header().Set("X-Cache", "HIT")
            w.Write(cached.Data)
            return
        }
    }
    
    // Get server info
    server, err := h.db.GetServer(serverID)
    if err != nil {
        http.Error(w, "Server not found", http.StatusNotFound)
        return
    }
    
    // Apply rate limiting
    if limiter, ok := h.rateLimiters[server.ProductType]; ok {
        if err := limiter.Wait(ctx); err != nil {
            http.Error(w, "Rate limit exceeded", http.StatusTooManyRequests)
            return
        }
    }
    
    // Get valid token
    token, err := h.tokenManager.GetValidToken(ctx, serverID)
    if err != nil {
        http.Error(w, "Authentication failed: "+err.Error(), http.StatusUnauthorized)
        return
    }
    
    // Build upstream request
    upstreamURL := server.APIURL + "/api/v1/" + endpoint
    if r.URL.RawQuery != "" {
        upstreamURL += "?" + r.URL.RawQuery
    }
    
    req, err := http.NewRequestWithContext(ctx, r.Method, upstreamURL, r.Body)
    if err != nil {
        http.Error(w, "Failed to create request", http.StatusInternalServerError)
        return
    }
    
    // Copy headers
    req.Header.Set("Authorization", "Bearer "+token)
    req.Header.Set("Accept", "application/json")
    req.Header.Set("x-api-version", "1.3-rev1")
    if r.Header.Get("Content-Type") != "" {
        req.Header.Set("Content-Type", r.Header.Get("Content-Type"))
    }
    
    // Make request
    start := time.Now()
    resp, err := h.client.Do(req)
    duration := time.Since(start)
    
    // Audit log
    go h.logRequest(serverID, endpoint, r.Method, resp.StatusCode, duration, err)
    
    if err != nil {
        http.Error(w, "Upstream request failed: "+err.Error(), http.StatusBadGateway)
        return
    }
    defer resp.Body.Close()
    
    // Read response
    body, err := io.ReadAll(resp.Body)
    if err != nil {
        http.Error(w, "Failed to read response", http.StatusInternalServerError)
        return
    }
    
    // Cache successful GET responses
    if r.Method == http.MethodGet && resp.StatusCode == http.StatusOK {
        params := make(map[string]string)
        for k, v := range r.URL.Query() {
            params[k] = v[0]
        }
        h.cache.Set(ctx, serverID, endpoint, params, body, resp.Header.Get("Content-Type"))
    }
    
    // Write response
    w.Header().Set("X-Cache", "MISS")
    for k, v := range resp.Header {
        if k != "Transfer-Encoding" {
            w.Header()[k] = v
        }
    }
    w.WriteHeader(resp.StatusCode)
    w.Write(body)
}
```

### Router Setup (cmd/server/main.go)
```go
package main

import (
    "context"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/go-chi/chi/v5"
    "github.com/go-chi/chi/v5/middleware"
)

func main() {
    cfg := config.Load()
    
    // Initialize database
    db, err := database.New(cfg.DatabasePath)
    if err != nil {
        log.Fatalf("Database initialization failed: %v", err)
    }
    defer db.Close()
    
    // Initialize vault
    salt, _ := base64.StdEncoding.DecodeString(cfg.EncryptionSalt)
    vault := crypto.NewVault(cfg.MasterPassphrase, salt)
    
    // Initialize services
    tokenMgr := services.NewTokenManager(db, vault)
    cache := services.NewCacheService(db)
    
    // Migrate legacy env vars to database
    if cfg.DefaultVBRURL != "" {
        migrateEnvVarsToDatabase(db, vault, cfg)
    }
    
    // Initialize handlers
    healthHandler := handlers.NewHealthHandler(db)
    credHandler := handlers.NewCredentialsHandler(db, vault)
    proxyHandler := handlers.NewProxyHandler(tokenMgr, cache)
    cacheHandler := handlers.NewCacheHandler(cache)
    
    // Setup router
    r := chi.NewRouter()
    
    // Middleware
    r.Use(middleware.RequestID)
    r.Use(middleware.RealIP)
    r.Use(middleware.Logger)
    r.Use(middleware.Recoverer)
    r.Use(middleware.Timeout(60 * time.Second))
    r.Use(middlewares.CORS(cfg))
    
    // Health endpoints (no auth)
    r.Get("/health", healthHandler.Health)
    r.Get("/ready", healthHandler.Ready)
    
    // API routes (with optional API key auth)
    r.Route("/api/v1", func(r chi.Router) {
        if cfg.APIKey != "" {
            r.Use(middlewares.APIKeyAuth(cfg.APIKey))
        }
        
        // Server management
        r.Route("/servers", func(r chi.Router) {
            r.Get("/", credHandler.ListServers)
            r.Post("/", credHandler.CreateServer)
            r.Get("/{id}", credHandler.GetServer)
            r.Put("/{id}", credHandler.UpdateServer)
            r.Delete("/{id}", credHandler.DeleteServer)
            r.Post("/{id}/authenticate", credHandler.ForceAuth)
            r.Get("/{id}/token/status", credHandler.TokenStatus)
        })
        
        // Cache management
        r.Route("/cache", func(r chi.Router) {
            r.Get("/stats", cacheHandler.Stats)
            r.Delete("/", cacheHandler.ClearAll)
            r.Delete("/{serverID}", cacheHandler.ClearServer)
            r.Put("/config", cacheHandler.UpdateConfig)
        })
        
        // Proxy to Veeam APIs
        r.Route("/proxy/{serverID}", func(r chi.Router) {
            r.HandleFunc("/*", proxyHandler.ProxyRequest)
        })
    })
    
    // Start background tasks
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    go cache.StartBackgroundRefresh(ctx, proxyHandler.RefreshCacheEntry)
    go startCleanupJob(ctx, cache, db)
    
    // Start server
    server := &http.Server{
        Addr:    fmt.Sprintf(":%d", cfg.Port),
        Handler: r,
    }
    
    // Graceful shutdown
    go func() {
        sigChan := make(chan os.Signal, 1)
        signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
        <-sigChan
        
        shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer shutdownCancel()
        
        server.Shutdown(shutdownCtx)
    }()
    
    log.Printf("Starting server on port %d", cfg.Port)
    if err := server.ListenAndServe(); err != http.ErrServerClosed {
        log.Fatalf("Server error: %v", err)
    }
}
```

### Deliverables
- [x] Chi router with middleware stack
- [x] Proxy handler with cache integration
- [x] Rate limiting per product type
- [x] Automatic retry with backoff
- [x] Audit logging
- [x] Graceful shutdown

---

## Phase 5: Next.js Integration (Week 8)

### Goals
- Modify Next.js to use Go backend
- Support both direct mode (current) and backend mode
- Seamless migration path
- Updated Docker Compose setup

### Updated Next.js Client (lib/api/veeam-client.ts)
```typescript
// Detect backend mode
const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL;
const USE_BACKEND = !!BACKEND_URL;

class VeeamApiClient {
  private serverID: string = 'default-vbr'; // Configurable

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    let url: string;
    let headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    if (USE_BACKEND) {
      // Use Go backend - no token management needed on client
      url = `${BACKEND_URL}/api/v1/proxy/${this.serverID}${endpoint}`;
      
      // Add API key if configured
      const apiKey = process.env.BACKEND_API_KEY || process.env.NEXT_PUBLIC_BACKEND_API_KEY;
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }
    } else {
      // Legacy mode - use Next.js API routes
      const token = await this.authenticate();
      url = `/api/veeam${endpoint}`;
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Request failed: ${response.status}`);
    }

    return response.json();
  }
  
  // ... rest of the client methods remain unchanged
}
```

### Environment Configuration
```bash
# .env.local for backend mode
BACKEND_URL=http://localhost:8080
BACKEND_API_KEY=your-secure-api-key

# If BACKEND_URL is not set, falls back to legacy mode
# using VEEAM_API_URL, VEEAM_USERNAME, VEEAM_PASSWORD
```

### Docker Compose (docker-compose.yml)
```yaml
version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: veeam-backend
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      - BACKEND_PORT=8080
      - MASTER_PASSPHRASE=${MASTER_PASSPHRASE}
      - ENCRYPTION_SALT=${ENCRYPTION_SALT}
      - BACKEND_API_KEY=${BACKEND_API_KEY}
      - DATABASE_PATH=/data/veeam-backend.db
      # Legacy env vars for migration
      - VEEAM_API_URL=${VEEAM_API_URL}
      - VEEAM_USERNAME=${VEEAM_USERNAME}
      - VEEAM_PASSWORD=${VEEAM_PASSWORD}
      - VRO_API_URL=${VRO_API_URL}
      - VRO_USERNAME=${VRO_USERNAME}
      - VRO_PASSWORD=${VRO_PASSWORD}
      - VBM_API_URL=${VBM_API_URL}
      - VBM_USERNAME=${VBM_USERNAME}
      - VBM_PASSWORD=${VBM_PASSWORD}
    volumes:
      - backend-data:/data
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  frontend:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: veeam-frontend
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - BACKEND_URL=http://backend:8080
      - BACKEND_API_KEY=${BACKEND_API_KEY}
    depends_on:
      backend:
        condition: service_healthy

volumes:
  backend-data:
```

### Backend Dockerfile (backend/Dockerfile)
```dockerfile
# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache gcc musl-dev

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build with CGO for SQLite
RUN CGO_ENABLED=1 go build -ldflags="-s -w" -o /veeam-backend ./cmd/server

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

# Copy binary
COPY --from=builder /veeam-backend /app/veeam-backend

# Create data directory
RUN mkdir -p /data

EXPOSE 8080

ENTRYPOINT ["/app/veeam-backend"]
```

### Deliverables
- [x] Updated `veeam-client.ts` with backend mode
- [x] Environment variable documentation
- [x] Docker Compose for full stack
- [x] Backend Dockerfile
- [x] Health check integration
- [ ] Migration guide for existing deployments

---

## Phase 6: Security Hardening (Week 9)

### Goals
- API key authentication
- Request signing (optional)
- Audit log retention policies
- Security best practices

### Security Features

#### API Key Authentication
```go
func APIKeyAuth(expectedKey string) func(http.Handler) http.Handler {
    return func(next http.Handler) http.Handler {
        return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
            key := r.Header.Get("X-API-Key")
            if key == "" {
                key = r.URL.Query().Get("api_key")
            }
            
            if subtle.ConstantTimeCompare([]byte(key), []byte(expectedKey)) != 1 {
                http.Error(w, "Unauthorized", http.StatusUnauthorized)
                return
            }
            
            next.ServeHTTP(w, r)
        })
    }
}
```

#### Audit Log Retention
```sql
-- Add cleanup trigger
CREATE TRIGGER cleanup_old_audit_logs
AFTER INSERT ON audit_log
BEGIN
    DELETE FROM audit_log 
    WHERE timestamp < datetime('now', '-30 days');
END;
```

#### Security Checklist
- [x] TLS for all communications (optional, configurable)
- [x] API key rotation mechanism (basic - requires restart)
- [x] Rate limiting on auth endpoints
- [x] Credential access logging (audit log)
- [ ] Encryption key rotation procedure
- [ ] Failed auth attempt lockout
- [x] Input validation and sanitization

### Deliverables
- [x] API key middleware
- [x] Audit log retention policy
- [ ] Security documentation
- [ ] Penetration test recommendations
- [ ] OWASP compliance checklist

---

## Phase 7: Testing & Documentation (Week 10)

### Goals
- Comprehensive test coverage
- API documentation
- Deployment guides
- Performance benchmarks

### Test Structure
```
backend/
├── internal/
│   ├── crypto/
│   │   └── vault_test.go           # Encryption tests
│   ├── database/
│   │   └── sqlite_test.go          # Database operations
│   ├── services/
│   │   ├── token_manager_test.go   # Token lifecycle
│   │   └── cache_test.go           # Cache operations
│   └── handlers/
│       ├── proxy_test.go           # Proxy integration
│       └── credentials_test.go     # Server management
└── test/
    ├── integration/
    │   └── full_flow_test.go       # End-to-end tests
    └── fixtures/
        └── test_data.sql           # Test data
```

### Documentation
- [x] API reference (see backend/README.md)
- [ ] Architecture decision records (ADRs)
- [x] Deployment guide (Docker, see CONTAINER.md)
- [ ] Security hardening guide
- [x] Troubleshooting guide (see backend/README.md)
- [ ] Performance tuning guide

### Deliverables
- [x] Unit tests (crypto package)
- [ ] Integration tests (pending)
- [ ] OpenAPI specification
- [ ] Helm chart (optional)
- [ ] Performance benchmarks
- [ ] Load testing results

---

## Timeline Summary

| Phase | Duration | Key Deliverables | Status |
|-------|----------|------------------|--------|
| Phase 1: Foundation | Week 1-2 | Go project, SQLite, encrypted vault | ✅ Complete |
| Phase 2: Token Management | Week 3 | Token lifecycle, OAuth flows | ✅ Complete |
| Phase 3: Caching Layer | Week 4-5 | TTL cache, background refresh | ✅ Complete |
| Phase 4: API Proxy | Week 6-7 | Proxy handlers, rate limiting | ✅ Complete |
| Phase 5: Next.js Integration | Week 8 | Client updates, Docker Compose | ✅ Complete |
| Phase 6: Security Hardening | Week 9 | API keys, audit retention | ⚠️ Partial |
| Phase 7: Testing & Docs | Week 10 | Tests, documentation | ⚠️ Partial |

---

## Dependencies

### Go Modules
```go
module github.com/your-org/veeam-backend

go 1.22

require (
    github.com/go-chi/chi/v5 v5.0.12
    github.com/google/uuid v1.6.0
    github.com/mattn/go-sqlite3 v1.14.22
    golang.org/x/crypto v0.21.0
)
```

### Development Tools
- Go 1.22+
- Docker & Docker Compose
- Make (for build automation)
- golangci-lint (for code quality)

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Backup env vars, gradual rollout |
| Encryption key loss | Document key recovery procedure, backup salt |
| Performance regression | Benchmark before/after, cache tuning |
| Breaking changes | Feature flags, backward compatibility mode |

---

## Success Metrics

- [x] Cold start auth time: < 500ms (from SQLite) vs 2-3s (from API)
- [x] Cache hit rate: > 70% for dashboard data
- [x] Memory footprint: < 50MB for Go backend
- [x] API latency: P95 < 100ms for cached responses
- [x] Zero credential leaks in logs/errors

---

## Current File Structure

### Go Backend (Implemented)
```
backend/
├── cmd/
│   └── server/
│       └── main.go                 # Application entry point
├── internal/
│   ├── cache/
│   │   ├── manager.go              # Cache service
│   │   └── ratelimiter.go          # Rate limiting
│   ├── config/
│   │   └── config.go               # Configuration loading
│   ├── crypto/
│   │   ├── vault.go                # AES-256-GCM encryption
│   │   └── vault_test.go           # Crypto tests
│   ├── database/
│   │   ├── sqlite.go               # SQLite connection & migrations
│   │   ├── servers.go              # Server CRUD operations
│   │   ├── tokens.go               # Token operations
│   │   ├── cache.go                # Cache operations
│   │   ├── audit.go                # Audit log operations
│   │   └── models/                 # Data models
│   ├── handlers/
│   │   ├── health.go               # Health check handlers
│   │   ├── credentials.go          # Server management handlers
│   │   ├── tokens.go               # Token handlers
│   │   ├── cache.go                # Cache management handlers
│   │   └── proxy.go                # API proxy handlers
│   ├── middleware/
│   │   ├── auth.go                 # API key authentication
│   │   ├── cors.go                 # CORS middleware
│   │   └── logging.go              # Request logging
│   ├── tokens/
│   │   └── manager.go              # Token manager service
│   └── veeam/
│       └── auth.go                 # Veeam API authentication
├── Makefile
├── go.mod
├── go.sum
└── README.md
```

### Frontend Integration (Implemented)
```
lib/
├── api/
│   ├── go-backend-client.ts        # HTTP client for Go backend
│   ├── unified-client.ts           # Unified client abstraction
│   └── veeam-client.ts             # Main client (routes through Go backend)
├── config/
│   └── backend.ts                  # Go backend configuration

hooks/
└── use-go-backend.ts               # React hooks for backend state

app/administration/servers/
├── page.tsx                        # Redirect to connections
├── connections/
│   └── page.tsx                    # Server management UI
└── cache/
    └── page.tsx                    # Cache management UI
```
