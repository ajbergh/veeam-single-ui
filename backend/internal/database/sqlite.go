/*
Package database provides SQLite database operations for the Veeam Single-UI Go Backend.

This file implements the database connection manager with:
  - SQLite database with WAL mode for better read concurrency
  - Automatic schema migrations on startup
  - Connection pool configuration optimized for SQLite
  - Pure Go SQLite driver (modernc.org/sqlite) - no CGO required

Database Tables:
  - servers: Veeam server connections with encrypted credentials
  - tokens: OAuth access/refresh tokens with encrypted storage
  - cache: Response cache with TTL, compression, and ETag support
  - audit_logs: Security-relevant operation logging

Key Functions:
  - New: Creates database connection and runs migrations
  - Close: Closes database connection gracefully
  - migrate: Applies schema migrations idempotently

SQLite Configuration:
  - Journal mode: WAL (Write-Ahead Logging)
  - Busy timeout: 5000ms
  - Foreign keys: Enabled
  - Max connections: 1 (SQLite limitation for writes)
*/
package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// DB wraps the SQLite database connection
type DB struct {
	conn *sql.DB
}

// New creates a new database connection and runs migrations
func New(dbPath string) (*DB, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create database directory: %w", err)
	}

	// Open database with WAL mode for better concurrency
	// modernc.org/sqlite uses "sqlite" as driver name and different pragma syntax
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", dbPath)
	conn, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	// Configure connection pool
	conn.SetMaxOpenConns(1) // SQLite doesn't support multiple write connections
	conn.SetMaxIdleConns(1)
	conn.SetConnMaxLifetime(time.Hour)

	// Test connection
	if err := conn.Ping(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	db := &DB{conn: conn}

	// Run migrations
	if err := db.migrate(); err != nil {
		conn.Close()
		return nil, fmt.Errorf("failed to run migrations: %w", err)
	}

	return db, nil
}

// Close closes the database connection
func (db *DB) Close() error {
	return db.conn.Close()
}

// Conn returns the underlying database connection for advanced queries
func (db *DB) Conn() *sql.DB {
	return db.conn
}

// migrate runs database migrations
func (db *DB) migrate() error {
	migrations := []string{
		migrationInitial,
		migrationCache,
		migrationAddVONE,
	}

	// Create migrations tracking table
	_, err := db.conn.Exec(`
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version INTEGER PRIMARY KEY,
			applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return fmt.Errorf("failed to create migrations table: %w", err)
	}

	// Run each migration
	for i, migration := range migrations {
		version := i + 1

		// Check if already applied
		var count int
		err := db.conn.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = ?", version).Scan(&count)
		if err != nil {
			return fmt.Errorf("failed to check migration %d: %w", version, err)
		}

		if count > 0 {
			continue // Already applied
		}

		// Apply migration
		_, err = db.conn.Exec(migration)
		if err != nil {
			return fmt.Errorf("failed to apply migration %d: %w", version, err)
		}

		// Record migration
		_, err = db.conn.Exec("INSERT INTO schema_migrations (version) VALUES (?)", version)
		if err != nil {
			return fmt.Errorf("failed to record migration %d: %w", version, err)
		}
	}

	return nil
}

// Migration 1: Initial schema - servers, tokens, audit log
const migrationInitial = `
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
    method TEXT,
    status_code INTEGER,
    duration_ms INTEGER,
    error_message TEXT,
    client_ip TEXT,
    user_agent TEXT
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_servers_product ON servers(product_type);
CREATE INDEX IF NOT EXISTS idx_servers_default ON servers(product_type, is_default);
CREATE INDEX IF NOT EXISTS idx_tokens_server ON tokens(server_id);
CREATE INDEX IF NOT EXISTS idx_tokens_expiry ON tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
`

// Migration 2: Cache tables
const migrationCache = `
-- API response cache
CREATE TABLE IF NOT EXISTS cache_entries (
    cache_key TEXT PRIMARY KEY,
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    response_data BLOB NOT NULL,
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
    endpoint_pattern TEXT NOT NULL UNIQUE,
    ttl_seconds INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    description TEXT
);

-- Default cache configurations
INSERT OR IGNORE INTO cache_config (endpoint_pattern, ttl_seconds, description) VALUES
    ('^/jobs$', 60, 'Job list - refresh every minute'),
    ('^/jobs/states$', 30, 'Job states - more frequent refresh'),
    ('^/sessions$', 60, 'Sessions list'),
    ('^/repositories$', 300, 'Repositories - slower changing'),
    ('^/infrastructure', 300, 'Infrastructure data'),
    ('^/license$', 3600, 'License info - hourly'),
    ('^/malwareEvents$', 120, 'Malware events'),
    ('^/stats', 60, 'Dashboard stats');

-- Indexes for cache
CREATE INDEX IF NOT EXISTS idx_cache_expires ON cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_cache_server ON cache_entries(server_id);
`

// Migration 3: Add 'vone' (Veeam ONE) as valid product type
// SQLite doesn't support ALTER COLUMN, so we need to recreate the table
const migrationAddVONE = `
-- Create new servers table with vone in the CHECK constraint
CREATE TABLE IF NOT EXISTS servers_new (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    product_type TEXT NOT NULL CHECK (product_type IN ('vbr', 'vro', 'vbm', 'vb365', 'k10', 'vone')),
    api_url TEXT NOT NULL,
    username_encrypted BLOB NOT NULL,
    password_encrypted BLOB NOT NULL,
    verify_ssl INTEGER DEFAULT 1,
    is_default INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Copy existing data
INSERT INTO servers_new SELECT * FROM servers;

-- Drop old table
DROP TABLE servers;

-- Rename new table
ALTER TABLE servers_new RENAME TO servers;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_servers_product ON servers(product_type);
CREATE INDEX IF NOT EXISTS idx_servers_default ON servers(product_type, is_default);
`
