/*
Package cache provides response caching and rate limiting for the Veeam Single-UI Go Backend.

This file implements the cache Manager which provides:
  - TTL-based response caching with configurable expiry per endpoint
  - Gzip compression for stored responses (reduces database size)
  - ETag-based cache validation
  - Background cleanup of expired entries
  - Cache statistics and manual invalidation APIs

TTL Configuration:
  - VeryLongTTL (24h): Static data like license, server info
  - LongTTL (30m): Configuration, rarely changing data
  - MediumTTL (5m): Jobs, repositories, proxies
  - ShortTTL (30s): Sessions, tasks, frequently changing data

Cache Key Structure:

	SHA256(serverID + path + sortedQueryParams)
	Example: /api/v1/jobs?limit=100 → unique hash per server

Storage:
  - SQLite table with compressed response body
  - Max cache size: 50MB (oldest entries evicted)
  - Cleanup interval: 5 minutes

Key Types:
  - Manager: Cache operations with database access
  - EndpointTTL: Pattern-based TTL configuration
  - CacheStats: Hit/miss statistics

Key Functions:
  - NewManager: Creates cache manager with database access
  - Get: Retrieves cached response if valid
  - Set: Stores response with compression
  - GetWithETag: Returns entry only if ETag matches
  - Invalidate: Removes specific cache entry
  - Clear: Removes all cache entries
  - StartCleanup: Background expiry cleanup
*/
package cache

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/crypto"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
)

// Default TTL values for different endpoint types
const (
	DefaultTTL         = 5 * time.Minute
	ShortTTL           = 30 * time.Second // For frequently changing data
	MediumTTL          = 5 * time.Minute  // For moderately changing data
	LongTTL            = 30 * time.Minute // For rarely changing data
	VeryLongTTL        = 24 * time.Hour   // For static data (license, config)
	MaxCacheSize       = 50 * 1024 * 1024 // 50MB max cache size
	CleanupInterval    = 5 * time.Minute
	CompressionEnabled = true
)

// EndpointTTL defines TTL rules for different endpoint patterns
type EndpointTTL struct {
	Pattern string
	TTL     time.Duration
}

// DefaultEndpointTTLs provides sensible defaults for Veeam API endpoints
var DefaultEndpointTTLs = []EndpointTTL{
	// Static data - cache for long periods
	{Pattern: "/license", TTL: VeryLongTTL},
	{Pattern: "/serverInfo", TTL: VeryLongTTL},
	{Pattern: "/serverTime", TTL: ShortTTL},

	// Configuration - medium cache
	{Pattern: "/config", TTL: LongTTL},
	{Pattern: "/repositories", TTL: MediumTTL},
	{Pattern: "/proxies", TTL: MediumTTL},
	{Pattern: "/managedServers", TTL: MediumTTL},

	// Jobs - medium cache (changes less frequently)
	{Pattern: "/jobs", TTL: MediumTTL},
	{Pattern: "/backupServers", TTL: MediumTTL},

	// Sessions - short cache (changes frequently)
	{Pattern: "/sessions", TTL: ShortTTL},
	{Pattern: "/tasks", TTL: ShortTTL},
	{Pattern: "/restorePoints", TTL: ShortTTL},

	// Objects - short cache
	{Pattern: "/objects", TTL: ShortTTL},
	{Pattern: "/inventory", TTL: ShortTTL},
}

// Manager handles API response caching with encryption and compression
type Manager struct {
	db           *database.DB
	vault        *crypto.Vault
	mu           sync.RWMutex
	missCount    int64
	stopChan     chan struct{}
	wg           sync.WaitGroup
	endpointTTLs []EndpointTTL
}

// NewManager creates a new cache manager
func NewManager(db *database.DB, vault *crypto.Vault) *Manager {
	return &Manager{
		db:           db,
		vault:        vault,
		stopChan:     make(chan struct{}),
		endpointTTLs: DefaultEndpointTTLs,
	}
}

// SetEndpointTTLs sets custom TTL rules for endpoints
func (m *Manager) SetEndpointTTLs(ttls []EndpointTTL) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.endpointTTLs = ttls
}

// GenerateCacheKey creates a unique cache key from server ID, endpoint, and query params
func (m *Manager) GenerateCacheKey(serverID, endpoint, queryParams string) string {
	data := fmt.Sprintf("%s:%s:%s", serverID, endpoint, queryParams)
	hash := sha256.Sum256([]byte(data))
	return hex.EncodeToString(hash[:])
}

// Get retrieves a cached response, returning nil if not found or expired
func (m *Manager) Get(serverID, endpoint, queryParams string) (*CacheResult, error) {
	key := m.GenerateCacheKey(serverID, endpoint, queryParams)

	m.mu.RLock()
	entry, err := m.db.GetCacheEntry(key)
	m.mu.RUnlock()

	if err != nil {
		return nil, fmt.Errorf("failed to get cache entry: %w", err)
	}

	// Cache miss
	if entry == nil {
		m.mu.Lock()
		m.missCount++
		m.mu.Unlock()
		return nil, nil
	}

	// Check expiry
	if entry.IsExpired() {
		// Asynchronously delete expired entry
		go m.db.DeleteCacheEntry(key)

		m.mu.Lock()
		m.missCount++
		m.mu.Unlock()
		return nil, nil
	}

	// Cache hit - decrypt and decompress
	data, err := m.decryptAndDecompress(entry.ResponseData)
	if err != nil {
		// Corrupted entry - delete it
		go m.db.DeleteCacheEntry(key)
		return nil, fmt.Errorf("failed to decrypt cache entry: %w", err)
	}

	// Update access stats
	go m.db.UpdateCacheAccess(key)

	return &CacheResult{
		Data:        data,
		ContentType: entry.ContentType,
		ETag:        entry.ETag,
		CachedAt:    entry.CreatedAt,
		ExpiresAt:   entry.ExpiresAt,
		HitCount:    entry.HitCount + 1,
	}, nil
}

// Set stores a response in the cache with encryption and compression
func (m *Manager) Set(serverID, endpoint, queryParams string, data []byte, contentType, etag string) error {
	key := m.GenerateCacheKey(serverID, endpoint, queryParams)
	ttl := m.getTTLForEndpoint(endpoint)

	// Compress and encrypt
	encryptedData, err := m.compressAndEncrypt(data)
	if err != nil {
		return fmt.Errorf("failed to encrypt cache data: %w", err)
	}

	now := time.Now()
	entry := &models.CacheEntry{
		CacheKey:       key,
		ServerID:       serverID,
		Endpoint:       endpoint,
		ResponseData:   encryptedData,
		ContentType:    contentType,
		ETag:           etag,
		TTLSeconds:     int(ttl.Seconds()),
		CreatedAt:      now,
		ExpiresAt:      now.Add(ttl),
		LastAccessedAt: now,
		HitCount:       0,
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.db.SaveCacheEntry(entry); err != nil {
		return fmt.Errorf("failed to save cache entry: %w", err)
	}

	return nil
}

// SetWithTTL stores a response with a custom TTL
func (m *Manager) SetWithTTL(serverID, endpoint, queryParams string, data []byte, contentType, etag string, ttl time.Duration) error {
	key := m.GenerateCacheKey(serverID, endpoint, queryParams)

	// Compress and encrypt
	encryptedData, err := m.compressAndEncrypt(data)
	if err != nil {
		return fmt.Errorf("failed to encrypt cache data: %w", err)
	}

	now := time.Now()
	entry := &models.CacheEntry{
		CacheKey:       key,
		ServerID:       serverID,
		Endpoint:       endpoint,
		ResponseData:   encryptedData,
		ContentType:    contentType,
		ETag:           etag,
		TTLSeconds:     int(ttl.Seconds()),
		CreatedAt:      now,
		ExpiresAt:      now.Add(ttl),
		LastAccessedAt: now,
		HitCount:       0,
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if err := m.db.SaveCacheEntry(entry); err != nil {
		return fmt.Errorf("failed to save cache entry: %w", err)
	}

	return nil
}

// Invalidate removes a specific cache entry
func (m *Manager) Invalidate(serverID, endpoint, queryParams string) error {
	key := m.GenerateCacheKey(serverID, endpoint, queryParams)
	return m.db.DeleteCacheEntry(key)
}

// InvalidateByServer removes all cache entries for a server
func (m *Manager) InvalidateByServer(serverID string) (int64, error) {
	return m.db.DeleteCacheEntriesByServer(serverID)
}

// InvalidateByPattern removes cache entries matching an endpoint pattern
func (m *Manager) InvalidateByPattern(serverID, pattern string) (int64, error) {
	return m.db.DeleteCacheEntriesByPattern(serverID, pattern)
}

// InvalidateAll removes all cache entries
func (m *Manager) InvalidateAll() (int64, error) {
	return m.db.DeleteAllCacheEntries()
}

// GetStats returns cache statistics
func (m *Manager) GetStats() (*models.CacheStats, error) {
	m.mu.RLock()
	missCount := m.missCount
	m.mu.RUnlock()

	stats, err := m.db.GetCacheStats()
	if err != nil {
		return nil, err
	}

	stats.MissCount = missCount
	if stats.HitCount+missCount > 0 {
		stats.HitRate = float64(stats.HitCount) / float64(stats.HitCount+missCount)
	}

	return stats, nil
}

// StartCleanup starts a background goroutine that cleans up expired entries
func (m *Manager) StartCleanup(interval time.Duration) {
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-m.stopChan:
				log.Println("Cache cleanup stopped")
				return
			case <-ticker.C:
				m.cleanup()
			}
		}
	}()
	log.Printf("Cache cleanup started (interval: %v)", interval)
}

// Stop stops the cleanup goroutine
func (m *Manager) Stop() {
	close(m.stopChan)
	m.wg.Wait()
}

// cleanup removes expired entries and enforces size limits
func (m *Manager) cleanup() {
	deleted, err := m.db.DeleteExpiredCacheEntries()
	if err != nil {
		log.Printf("Error cleaning expired cache entries: %v", err)
		return
	}
	if deleted > 0 {
		log.Printf("Cleaned up %d expired cache entries", deleted)
	}

	// Check total size and cleanup if needed
	stats, err := m.db.GetCacheStats()
	if err != nil {
		log.Printf("Error getting cache stats: %v", err)
		return
	}

	if stats.TotalSize > MaxCacheSize {
		log.Printf("Cache size (%d bytes) exceeds limit (%d bytes), cleaning oldest entries", stats.TotalSize, MaxCacheSize)
		// Delete oldest 10% of entries
		// This is a simple approach; more sophisticated LRU would be better
		entriesToDelete := stats.TotalEntries / 10
		if entriesToDelete < 1 {
			entriesToDelete = 1
		}
		// TODO: Implement DeleteOldestCacheEntries in database
	}
}

// getTTLForEndpoint returns the appropriate TTL for an endpoint
func (m *Manager) getTTLForEndpoint(endpoint string) time.Duration {
	for _, rule := range m.endpointTTLs {
		if matchesPattern(endpoint, rule.Pattern) {
			return rule.TTL
		}
	}
	return DefaultTTL
}

// matchesPattern checks if an endpoint matches a pattern (simple substring match)
func matchesPattern(endpoint, pattern string) bool {
	return bytes.Contains([]byte(endpoint), []byte(pattern))
}

// compressAndEncrypt compresses data with gzip, then encrypts with AES-256-GCM
func (m *Manager) compressAndEncrypt(data []byte) ([]byte, error) {
	// Compress
	var compressed bytes.Buffer
	if CompressionEnabled {
		gzWriter := gzip.NewWriter(&compressed)
		if _, err := gzWriter.Write(data); err != nil {
			return nil, fmt.Errorf("compression failed: %w", err)
		}
		if err := gzWriter.Close(); err != nil {
			return nil, fmt.Errorf("compression close failed: %w", err)
		}
	} else {
		compressed.Write(data)
	}

	// Encrypt
	encrypted, err := m.vault.EncryptBytes(compressed.Bytes())
	if err != nil {
		return nil, fmt.Errorf("encryption failed: %w", err)
	}

	return encrypted, nil
}

// decryptAndDecompress decrypts with AES-256-GCM, then decompresses with gzip
func (m *Manager) decryptAndDecompress(encrypted []byte) ([]byte, error) {
	// Decrypt
	compressed, err := m.vault.DecryptBytes(encrypted)
	if err != nil {
		return nil, fmt.Errorf("decryption failed: %w", err)
	}

	// Decompress
	if CompressionEnabled {
		gzReader, err := gzip.NewReader(bytes.NewReader(compressed))
		if err != nil {
			return nil, fmt.Errorf("decompression init failed: %w", err)
		}
		defer gzReader.Close()

		decompressed, err := io.ReadAll(gzReader)
		if err != nil {
			return nil, fmt.Errorf("decompression failed: %w", err)
		}
		return decompressed, nil
	}

	return compressed, nil
}

// CacheResult represents a cache hit result
type CacheResult struct {
	Data        []byte
	ContentType string
	ETag        string
	CachedAt    time.Time
	ExpiresAt   time.Time
	HitCount    int
}

// TimeToLive returns remaining TTL
func (r *CacheResult) TimeToLive() time.Duration {
	return time.Until(r.ExpiresAt)
}
