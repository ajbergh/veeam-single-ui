package models

import "time"

// CacheEntry represents a cached API response
type CacheEntry struct {
	CacheKey       string    `json:"cacheKey"`
	ServerID       string    `json:"serverId"`
	Endpoint       string    `json:"endpoint"`
	ResponseData   []byte    `json:"-"` // Compressed data, not for JSON
	ContentType    string    `json:"contentType"`
	ETag           string    `json:"etag"`
	TTLSeconds     int       `json:"ttlSeconds"`
	CreatedAt      time.Time `json:"createdAt"`
	ExpiresAt      time.Time `json:"expiresAt"`
	LastAccessedAt time.Time `json:"lastAccessedAt"`
	HitCount       int       `json:"hitCount"`
}

// CacheConfig represents cache configuration for an endpoint pattern
type CacheConfig struct {
	ID              int    `json:"id"`
	EndpointPattern string `json:"endpointPattern"`
	TTLSeconds      int    `json:"ttlSeconds"`
	Enabled         bool   `json:"enabled"`
	Description     string `json:"description,omitempty"`
}

// IsExpired returns true if the cache entry has expired
func (c *CacheEntry) IsExpired() bool {
	return time.Now().After(c.ExpiresAt)
}

// TimeToLive returns the remaining time until expiry
func (c *CacheEntry) TimeToLive() time.Duration {
	return time.Until(c.ExpiresAt)
}

// CacheStats represents cache statistics
type CacheStats struct {
	TotalEntries   int        `json:"totalEntries"`
	TotalSize      int64      `json:"totalSizeBytes"`
	HitCount       int64      `json:"hitCount"`
	MissCount      int64      `json:"missCount"`
	HitRate        float64    `json:"hitRate"`
	ExpiredEntries int        `json:"expiredEntries"`
	OldestEntry    *time.Time `json:"oldestEntry,omitempty"`
	NewestEntry    *time.Time `json:"newestEntry,omitempty"`
}
