/*
Package config provides configuration loading for the Veeam Single-UI Go Backend.

This file implements configuration loading from environment variables with:
  - Sensible defaults for development
  - Validation of required settings (especially encryption)
  - Support for legacy environment variables (VBR, VRO, VBM credentials)
  - Auto-generation of encryption salt if not provided

Environment Variables:

	Required:
	  - MASTER_PASSPHRASE: Master key for encryption (min 16 characters)

	Optional:
	  - ENCRYPTION_SALT: Base64-encoded salt for key derivation (auto-generated if not set)
	  - BACKEND_PORT: Server port (default: 8080)
	  - DATABASE_PATH: SQLite database path (default: ./data/veeam-backend.db)
	  - ENVIRONMENT: "development" or "production" (default: development)
	  - BACKEND_API_KEY: API key for authentication (if set, all requests require it)
	  - TLS_CERT_FILE, TLS_KEY_FILE: Optional TLS certificate paths

	Legacy (auto-migrated to database on first run):
	  - VEEAM_API_URL, VEEAM_USERNAME, VEEAM_PASSWORD: VBR connection
	  - VRO_API_URL, VRO_USERNAME, VRO_PASSWORD: VRO connection
	  - VBM_API_URL, VBM_USERNAME, VBM_PASSWORD: VBM connection

Key Types:
  - Config: Main configuration struct with all settings

Key Functions:
  - Load: Loads configuration from environment variables
  - generateSalt: Creates cryptographically secure random salt
*/
package config

import (
	"encoding/base64"
	"fmt"
	"os"
	"strconv"
)

// Config holds all configuration for the backend service
type Config struct {
	// Server settings
	Port        int
	Environment string

	// Security
	MasterPassphrase string // Used to derive encryption key
	EncryptionSalt   []byte // Salt for key derivation
	APIKey           string // Optional API key for backend access

	// Database
	DatabasePath string

	// TLS (optional)
	TLSCertFile string
	TLSKeyFile  string

	// Defaults for legacy compatibility (migration from env vars)
	DefaultVBRURL      string
	DefaultVBRUsername string
	DefaultVBRPassword string
	DefaultVROURL      string
	DefaultVROUsername string
	DefaultVROPassword string
	DefaultVBMURL      string
	DefaultVBMUsername string
	DefaultVBMPassword string

	// Logging
	LogLevel string
	LogJSON  bool
}

// Load reads configuration from environment variables
func Load() (*Config, error) {
	// Parse encryption salt
	saltBase64 := getEnv("ENCRYPTION_SALT", "")
	var salt []byte
	var err error

	if saltBase64 != "" {
		salt, err = base64.StdEncoding.DecodeString(saltBase64)
		if err != nil {
			return nil, fmt.Errorf("invalid ENCRYPTION_SALT: must be base64 encoded: %w", err)
		}
		if len(salt) < 16 {
			return nil, fmt.Errorf("ENCRYPTION_SALT must be at least 16 bytes when decoded")
		}
	} else {
		// Generate a warning - in production, salt should be persistent
		fmt.Println("WARNING: ENCRYPTION_SALT not set. Using default salt. Set a persistent salt in production!")
		salt = []byte("veeam-backend-default-salt-change-me")
	}

	cfg := &Config{
		Port:        getEnvInt("BACKEND_PORT", 8080),
		Environment: getEnv("ENVIRONMENT", "development"),

		MasterPassphrase: getEnv("MASTER_PASSPHRASE", ""),
		EncryptionSalt:   salt,
		APIKey:           getEnv("BACKEND_API_KEY", ""),

		DatabasePath: getEnv("DATABASE_PATH", "./data/veeam-backend.db"),

		TLSCertFile: getEnv("TLS_CERT_FILE", ""),
		TLSKeyFile:  getEnv("TLS_KEY_FILE", ""),

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

		LogLevel: getEnv("LOG_LEVEL", "info"),
		LogJSON:  getEnvBool("LOG_JSON", false),
	}

	// Validate required fields
	if cfg.MasterPassphrase == "" {
		return nil, fmt.Errorf("MASTER_PASSPHRASE environment variable is required")
	}

	if len(cfg.MasterPassphrase) < 16 {
		return nil, fmt.Errorf("MASTER_PASSPHRASE must be at least 16 characters")
	}

	return cfg, nil
}

// IsDevelopment returns true if running in development mode
func (c *Config) IsDevelopment() bool {
	return c.Environment == "development"
}

// IsProduction returns true if running in production mode
func (c *Config) IsProduction() bool {
	return c.Environment == "production"
}

// HasTLS returns true if TLS is configured
func (c *Config) HasTLS() bool {
	return c.TLSCertFile != "" && c.TLSKeyFile != ""
}

// HasAPIKey returns true if API key authentication is enabled
func (c *Config) HasAPIKey() bool {
	return c.APIKey != ""
}

// HasLegacyVBR returns true if legacy VBR env vars are configured
func (c *Config) HasLegacyVBR() bool {
	return c.DefaultVBRURL != "" && c.DefaultVBRUsername != "" && c.DefaultVBRPassword != ""
}

// HasLegacyVRO returns true if legacy VRO env vars are configured
func (c *Config) HasLegacyVRO() bool {
	return c.DefaultVROURL != "" && c.DefaultVROUsername != "" && c.DefaultVROPassword != ""
}

// HasLegacyVBM returns true if legacy VBM env vars are configured
func (c *Config) HasLegacyVBM() bool {
	return c.DefaultVBMURL != "" && c.DefaultVBMUsername != "" && c.DefaultVBMPassword != ""
}

// getEnv returns the value of an environment variable or a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getEnvInt returns the value of an environment variable as an integer or a default value
func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if i, err := strconv.Atoi(value); err == nil {
			return i
		}
	}
	return defaultValue
}

// getEnvBool returns the value of an environment variable as a boolean or a default value
func getEnvBool(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if b, err := strconv.ParseBool(value); err == nil {
			return b
		}
	}
	return defaultValue
}
