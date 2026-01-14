package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
)

// SaveCacheEntry saves a cache entry
func (db *DB) SaveCacheEntry(entry *models.CacheEntry) error {
	_, err := db.conn.Exec(`
		INSERT OR REPLACE INTO cache_entries (cache_key, server_id, endpoint, response_data, content_type, etag, ttl_seconds, created_at, expires_at, last_accessed_at, hit_count)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, entry.CacheKey, entry.ServerID, entry.Endpoint, entry.ResponseData, entry.ContentType, entry.ETag, entry.TTLSeconds, entry.CreatedAt, entry.ExpiresAt, entry.LastAccessedAt, entry.HitCount)
	if err != nil {
		return fmt.Errorf("failed to save cache entry: %w", err)
	}
	return nil
}

// GetCacheEntry retrieves a cache entry by key
func (db *DB) GetCacheEntry(key string) (*models.CacheEntry, error) {
	var entry models.CacheEntry
	err := db.conn.QueryRow(`
		SELECT cache_key, server_id, endpoint, response_data, content_type, etag, ttl_seconds, created_at, expires_at, last_accessed_at, hit_count
		FROM cache_entries WHERE cache_key = ?
	`, key).Scan(
		&entry.CacheKey, &entry.ServerID, &entry.Endpoint, &entry.ResponseData,
		&entry.ContentType, &entry.ETag, &entry.TTLSeconds,
		&entry.CreatedAt, &entry.ExpiresAt, &entry.LastAccessedAt, &entry.HitCount,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get cache entry: %w", err)
	}
	return &entry, nil
}

// UpdateCacheAccess updates the access statistics for a cache entry
func (db *DB) UpdateCacheAccess(key string) error {
	_, err := db.conn.Exec(`
		UPDATE cache_entries SET last_accessed_at = ?, hit_count = hit_count + 1
		WHERE cache_key = ?
	`, time.Now(), key)
	if err != nil {
		return fmt.Errorf("failed to update cache access: %w", err)
	}
	return nil
}

// DeleteCacheEntry deletes a cache entry by key
func (db *DB) DeleteCacheEntry(key string) error {
	_, err := db.conn.Exec("DELETE FROM cache_entries WHERE cache_key = ?", key)
	if err != nil {
		return fmt.Errorf("failed to delete cache entry: %w", err)
	}
	return nil
}

// DeleteCacheEntriesByServer deletes all cache entries for a server
func (db *DB) DeleteCacheEntriesByServer(serverID string) (int64, error) {
	result, err := db.conn.Exec("DELETE FROM cache_entries WHERE server_id = ?", serverID)
	if err != nil {
		return 0, fmt.Errorf("failed to delete cache entries: %w", err)
	}
	return result.RowsAffected()
}

// DeleteCacheEntriesByPattern deletes cache entries matching an endpoint pattern
func (db *DB) DeleteCacheEntriesByPattern(serverID string, endpointPattern string) (int64, error) {
	result, err := db.conn.Exec(
		"DELETE FROM cache_entries WHERE server_id = ? AND endpoint LIKE ?",
		serverID, "%"+endpointPattern+"%",
	)
	if err != nil {
		return 0, fmt.Errorf("failed to delete cache entries by pattern: %w", err)
	}
	return result.RowsAffected()
}

// DeleteExpiredCacheEntries removes all expired cache entries
func (db *DB) DeleteExpiredCacheEntries() (int64, error) {
	result, err := db.conn.Exec("DELETE FROM cache_entries WHERE expires_at < ?", time.Now())
	if err != nil {
		return 0, fmt.Errorf("failed to delete expired cache entries: %w", err)
	}
	return result.RowsAffected()
}

// DeleteAllCacheEntries removes all cache entries
func (db *DB) DeleteAllCacheEntries() (int64, error) {
	result, err := db.conn.Exec("DELETE FROM cache_entries")
	if err != nil {
		return 0, fmt.Errorf("failed to delete all cache entries: %w", err)
	}
	return result.RowsAffected()
}

// GetCacheStats returns statistics about the cache
func (db *DB) GetCacheStats() (*models.CacheStats, error) {
	stats := &models.CacheStats{}

	// Total entries
	err := db.conn.QueryRow("SELECT COUNT(*) FROM cache_entries").Scan(&stats.TotalEntries)
	if err != nil {
		return nil, fmt.Errorf("failed to count cache entries: %w", err)
	}

	// Total size
	err = db.conn.QueryRow("SELECT COALESCE(SUM(LENGTH(response_data)), 0) FROM cache_entries").Scan(&stats.TotalSize)
	if err != nil {
		return nil, fmt.Errorf("failed to sum cache size: %w", err)
	}

	// Total hits
	err = db.conn.QueryRow("SELECT COALESCE(SUM(hit_count), 0) FROM cache_entries").Scan(&stats.HitCount)
	if err != nil {
		return nil, fmt.Errorf("failed to sum hit count: %w", err)
	}

	// Expired entries
	err = db.conn.QueryRow("SELECT COUNT(*) FROM cache_entries WHERE expires_at < ?", time.Now()).Scan(&stats.ExpiredEntries)
	if err != nil {
		return nil, fmt.Errorf("failed to count expired entries: %w", err)
	}

	// Oldest entry - SQLite returns timestamps as strings, so scan into sql.NullString first
	var oldestStr sql.NullString
	err = db.conn.QueryRow("SELECT MIN(created_at) FROM cache_entries").Scan(&oldestStr)
	if err != nil {
		return nil, fmt.Errorf("failed to get oldest entry: %w", err)
	}
	if oldestStr.Valid && oldestStr.String != "" {
		if t, parseErr := time.Parse(time.RFC3339, oldestStr.String); parseErr == nil {
			stats.OldestEntry = &t
		} else if t, parseErr := time.Parse("2006-01-02 15:04:05", oldestStr.String); parseErr == nil {
			stats.OldestEntry = &t
		}
	}

	// Newest entry - same approach for SQLite string timestamps
	var newestStr sql.NullString
	err = db.conn.QueryRow("SELECT MAX(created_at) FROM cache_entries").Scan(&newestStr)
	if err != nil {
		return nil, fmt.Errorf("failed to get newest entry: %w", err)
	}
	if newestStr.Valid && newestStr.String != "" {
		if t, parseErr := time.Parse(time.RFC3339, newestStr.String); parseErr == nil {
			stats.NewestEntry = &t
		} else if t, parseErr := time.Parse("2006-01-02 15:04:05", newestStr.String); parseErr == nil {
			stats.NewestEntry = &t
		}
	}

	return stats, nil
}

// GetCacheConfigs returns all cache configurations
func (db *DB) GetCacheConfigs() ([]*models.CacheConfig, error) {
	rows, err := db.conn.Query(`
		SELECT id, endpoint_pattern, ttl_seconds, enabled, COALESCE(description, '')
		FROM cache_config ORDER BY endpoint_pattern
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to get cache configs: %w", err)
	}
	defer rows.Close()

	var configs []*models.CacheConfig
	for rows.Next() {
		var cfg models.CacheConfig
		err := rows.Scan(&cfg.ID, &cfg.EndpointPattern, &cfg.TTLSeconds, &cfg.Enabled, &cfg.Description)
		if err != nil {
			return nil, fmt.Errorf("failed to scan cache config: %w", err)
		}
		configs = append(configs, &cfg)
	}
	return configs, nil
}

// UpdateCacheConfig updates a cache configuration
func (db *DB) UpdateCacheConfig(cfg *models.CacheConfig) error {
	result, err := db.conn.Exec(`
		UPDATE cache_config SET ttl_seconds = ?, enabled = ?, description = ?
		WHERE id = ?
	`, cfg.TTLSeconds, cfg.Enabled, cfg.Description, cfg.ID)
	if err != nil {
		return fmt.Errorf("failed to update cache config: %w", err)
	}
	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("cache config not found: %d", cfg.ID)
	}
	return nil
}
