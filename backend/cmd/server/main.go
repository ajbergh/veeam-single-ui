/*
Package main is the entry point for the Veeam Single-UI Go Backend Server.

The backend provides a unified API layer for managing multiple Veeam products with:
  - Encrypted credential storage (AES-256-GCM with Argon2id key derivation)
  - Token lifecycle management with automatic refresh
  - Response caching with configurable TTL per endpoint
  - Rate limiting per product (especially for VBM's 1 req/sec limit)
  - API proxy to Veeam products (VBR, VRO, VBM, VB365, K10)

Architecture:

	Browser → Next.js Frontend → Go Backend → Veeam APIs
	                                  ↓
	                            SQLite Database

Key Features:
  - Multi-server support: Connect multiple Veeam servers from a single UI
  - Zero-config deployment: Auto-generates encryption keys on first run
  - Setup wizard: Guided first-start experience for server configuration
  - Graceful shutdown: Properly closes database connections and stops background tasks

Environment Variables:
  - MASTER_PASSPHRASE: Master key for encryption (auto-generated if not set)
  - ENCRYPTION_SALT: Salt for key derivation (auto-generated if not set)
  - BACKEND_PORT: Server port (default: 8080)
  - DATABASE_PATH: SQLite database path (default: ./data/veeam-backend.db)
  - ENVIRONMENT: development or production
  - TLS_CERT_FILE, TLS_KEY_FILE: Optional TLS certificate paths
*/
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/cache"
	"github.com/ajbergh/veeam-single-ui/backend/internal/config"
	"github.com/ajbergh/veeam-single-ui/backend/internal/crypto"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
	"github.com/ajbergh/veeam-single-ui/backend/internal/handlers"
	"github.com/ajbergh/veeam-single-ui/backend/internal/middleware"
	"github.com/ajbergh/veeam-single-ui/backend/internal/tokens"
	"github.com/ajbergh/veeam-single-ui/backend/internal/veeam"
	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Println("Starting Veeam Backend Server...")

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	log.Printf("Environment: %s", cfg.Environment)
	log.Printf("Database path: %s", cfg.DatabasePath)

	// Initialize database
	db, err := database.New(cfg.DatabasePath)
	if err != nil {
		log.Fatalf("Failed to initialize database: %v", err)
	}
	defer db.Close()
	log.Println("Database initialized successfully")

	// Initialize encryption vault
	vault := crypto.NewVault(cfg.MasterPassphrase, cfg.EncryptionSalt)
	log.Println("Encryption vault initialized")

	// Initialize Veeam authenticator
	verifySSL := cfg.Environment == "production" // Enable SSL verification in production
	veeamAuth := veeam.NewAuthenticator(verifySSL)

	// Initialize token manager
	tokenManager := tokens.NewManager(db, vault, veeamAuth)

	// Start token auto-refresh (check every 2 minutes)
	tokenManager.StartAutoRefresh(2 * time.Minute)
	defer tokenManager.Stop()
	log.Println("Token auto-refresh started")

	// Initialize cache manager
	cacheManager := cache.NewManager(db, vault)

	// Start cache cleanup (every 5 minutes)
	cacheManager.StartCleanup(5 * time.Minute)
	defer cacheManager.Stop()
	log.Println("Cache manager initialized")

	// Initialize rate limiter
	rateLimiter := cache.NewRateLimiter()
	log.Println("Rate limiter initialized")

	// Migrate legacy environment variables to database
	if err := migrateLegacyEnvVars(db, vault, cfg); err != nil {
		log.Printf("Warning: Failed to migrate legacy env vars: %v", err)
	}

	// Initialize handlers
	healthHandler := handlers.NewHealthHandler(db)
	credHandler := handlers.NewCredentialsHandler(db, vault)
	tokenHandler := handlers.NewTokenHandler(tokenManager)
	cacheHandler := handlers.NewCacheHandler(cacheManager, rateLimiter)
	proxyHandler := handlers.NewProxyHandler(db, tokenManager, cacheManager, rateLimiter)
	setupHandler := handlers.NewSetupHandler(db, vault, tokenManager)

	// Setup router
	r := chi.NewRouter()

	// Global middleware
	r.Use(chimiddleware.RequestID)
	r.Use(chimiddleware.RealIP)
	if cfg.LogJSON {
		r.Use(middleware.JSONLogger)
	} else {
		r.Use(middleware.Logger)
	}
	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.Timeout(60 * time.Second))
	r.Use(middleware.CORS(nil)) // Use default CORS config

	// Health endpoints (no auth required)
	r.Get("/health", healthHandler.Health)
	r.Get("/ready", healthHandler.Ready)

	// API routes
	r.Route("/api/v1", func(r chi.Router) {
		// Apply API key auth if configured
		if cfg.HasAPIKey() {
			r.Use(middleware.APIKeyAuth(cfg.APIKey))
		}

		// Setup wizard endpoints (no auth required for initial setup)
		r.Route("/setup", func(r chi.Router) {
			r.Get("/status", setupHandler.GetSetupStatus)
			r.Post("/wizard", setupHandler.ProcessWizardStep)
			r.Post("/test", setupHandler.TestConnection)
			r.Post("/complete", setupHandler.CompleteSetup)
		})

		// Server management
		r.Route("/servers", func(r chi.Router) {
			r.Get("/", credHandler.ListServers)
			r.Post("/", credHandler.CreateServer)
			r.Post("/authenticate", tokenHandler.AuthenticateMultiple)
			r.Get("/{id}", credHandler.GetServer)
			r.Put("/{id}", credHandler.UpdateServer)
			r.Delete("/{id}", credHandler.DeleteServer)
			r.Post("/{id}/authenticate", tokenHandler.Authenticate)
			r.Post("/{id}/logout", tokenHandler.Logout)
			r.Get("/{id}/token", tokenHandler.GetAccessToken)
			r.Get("/{id}/token/status", tokenHandler.GetTokenStatus)
			r.Delete("/{id}/cache", cacheHandler.InvalidateServer)
			r.Delete("/{id}/cache/{pattern}", cacheHandler.InvalidatePattern)
			r.Post("/{id}/ratelimit/reset", cacheHandler.ResetRateLimiter)
		})

		// Cache management
		r.Route("/cache", func(r chi.Router) {
			r.Get("/stats", cacheHandler.GetStats)
			r.Get("/config", cacheHandler.GetCacheConfigs)
			r.Get("/ratelimit", cacheHandler.GetRateLimiterStats)
			r.Delete("/", cacheHandler.InvalidateAll)
		})

		// Proxy routes (with caching)
		r.Get("/proxy/{serverID}/*", proxyHandler.ProxyRequest)
		r.Post("/proxy/{serverID}/*", proxyHandler.ProxyNoCache)
		r.Put("/proxy/{serverID}/*", proxyHandler.ProxyNoCache)
		r.Delete("/proxy/{serverID}/*", proxyHandler.ProxyNoCache)
		r.Patch("/proxy/{serverID}/*", proxyHandler.ProxyNoCache)
	})

	// Create server
	server := &http.Server{
		Addr:         fmt.Sprintf(":%d", cfg.Port),
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Start background cleanup job
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go startCleanupJob(ctx, db)

	// Graceful shutdown
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		sig := <-sigChan

		log.Printf("Received signal %v, shutting down...", sig)

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()

		if err := server.Shutdown(shutdownCtx); err != nil {
			log.Printf("Error during shutdown: %v", err)
		}
	}()

	// Start server
	log.Printf("Server listening on port %d", cfg.Port)
	if cfg.HasTLS() {
		log.Println("TLS enabled")
		if err := server.ListenAndServeTLS(cfg.TLSCertFile, cfg.TLSKeyFile); err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	} else {
		if cfg.IsProduction() {
			log.Println("WARNING: Running in production without TLS!")
		}
		if err := server.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}

	log.Println("Server stopped")
}

// migrateLegacyEnvVars migrates legacy environment variables to the database
func migrateLegacyEnvVars(db *database.DB, vault *crypto.Vault, cfg *config.Config) error {
	// Check if any servers already exist
	count, err := db.CountServers(nil)
	if err != nil {
		return err
	}
	if count > 0 {
		log.Printf("Found %d existing servers, skipping legacy migration", count)
		return nil
	}

	// Migrate VBR
	if cfg.HasLegacyVBR() {
		log.Println("Migrating legacy VBR environment variables...")
		if err := createServerFromEnv(db, vault, "default-vbr", "Default VBR Server", models.ProductTypeVBR, cfg.DefaultVBRURL, cfg.DefaultVBRUsername, cfg.DefaultVBRPassword); err != nil {
			log.Printf("Warning: Failed to migrate VBR: %v", err)
		}
	}

	// Migrate VRO
	if cfg.HasLegacyVRO() {
		log.Println("Migrating legacy VRO environment variables...")
		if err := createServerFromEnv(db, vault, "default-vro", "Default VRO Server", models.ProductTypeVRO, cfg.DefaultVROURL, cfg.DefaultVROUsername, cfg.DefaultVROPassword); err != nil {
			log.Printf("Warning: Failed to migrate VRO: %v", err)
		}
	}

	// Migrate VBM
	if cfg.HasLegacyVBM() {
		log.Println("Migrating legacy VBM environment variables...")
		if err := createServerFromEnv(db, vault, "default-vbm", "Default VBM Server", models.ProductTypeVBM, cfg.DefaultVBMURL, cfg.DefaultVBMUsername, cfg.DefaultVBMPassword); err != nil {
			log.Printf("Warning: Failed to migrate VBM: %v", err)
		}
	}

	return nil
}

func createServerFromEnv(db *database.DB, vault *crypto.Vault, id, name string, productType models.ProductType, url, username, password string) error {
	usernameEncrypted, err := vault.Encrypt(username)
	if err != nil {
		return fmt.Errorf("failed to encrypt username: %w", err)
	}

	passwordEncrypted, err := vault.Encrypt(password)
	if err != nil {
		return fmt.Errorf("failed to encrypt password: %w", err)
	}

	server := &models.Server{
		ID:                id,
		Name:              name,
		ProductType:       productType,
		APIURL:            url,
		UsernameEncrypted: usernameEncrypted,
		PasswordEncrypted: passwordEncrypted,
		VerifySSL:         false, // Legacy behavior - lab environments often use self-signed certs
		IsDefault:         true,
	}

	return db.CreateServer(server)
}

// startCleanupJob runs periodic cleanup tasks
func startCleanupJob(ctx context.Context, db *database.DB) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Clean up expired tokens
			deleted, err := db.DeleteExpiredTokens()
			if err != nil {
				log.Printf("Error cleaning expired tokens: %v", err)
			} else if deleted > 0 {
				log.Printf("Cleaned up %d expired tokens", deleted)
			}

			// Clean up expired cache entries
			deleted, err = db.DeleteExpiredCacheEntries()
			if err != nil {
				log.Printf("Error cleaning expired cache: %v", err)
			} else if deleted > 0 {
				log.Printf("Cleaned up %d expired cache entries", deleted)
			}

			// Clean up old audit logs (keep 30 days)
			deleted, err = db.DeleteOldAuditLogs(30 * 24 * time.Hour)
			if err != nil {
				log.Printf("Error cleaning old audit logs: %v", err)
			} else if deleted > 0 {
				log.Printf("Cleaned up %d old audit log entries", deleted)
			}
		}
	}
}
