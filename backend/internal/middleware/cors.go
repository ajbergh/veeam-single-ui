/*
Package middleware provides HTTP middleware for the Veeam Single-UI Go Backend.

This file implements CORS (Cross-Origin Resource Sharing) middleware that:
  - Handles preflight OPTIONS requests automatically
  - Configures allowed origins, methods, and headers
  - Sets Access-Control headers on all responses
  - Supports credential-inclusive requests (cookies, authorization)

Default Configuration:
  - Allowed Origins: * (all origins - configure for production)
  - Allowed Methods: GET, POST, PUT, DELETE, OPTIONS, PATCH
  - Allowed Headers: Accept, Authorization, Content-Type, X-API-Key, X-Requested-With
  - Allow Credentials: true
  - Max Age: 24 hours (cached preflight responses)

IMPORTANT: The proxy handler filters CORS headers from upstream Veeam API responses
to prevent "Multiple CORS header" errors when both the backend and upstream
set Access-Control headers.

Key Types:
  - CORSConfig: Configuration struct for CORS settings

Key Functions:
  - DefaultCORSConfig: Returns development-safe CORS configuration
  - CORS: Returns middleware handler with given configuration
*/
package middleware

import (
	"net/http"
	"strings"
)

// CORSConfig contains CORS configuration
type CORSConfig struct {
	AllowedOrigins   []string
	AllowedMethods   []string
	AllowedHeaders   []string
	AllowCredentials bool
	MaxAge           int
}

// DefaultCORSConfig returns a permissive CORS configuration for development
func DefaultCORSConfig() *CORSConfig {
	return &CORSConfig{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-API-Key", "X-Requested-With"},
		AllowCredentials: true,
		MaxAge:           86400, // 24 hours
	}
}

// CORS returns middleware that handles Cross-Origin Resource Sharing
func CORS(config *CORSConfig) func(http.Handler) http.Handler {
	if config == nil {
		config = DefaultCORSConfig()
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			// Check if origin is allowed
			allowed := false
			for _, o := range config.AllowedOrigins {
				if o == "*" || o == origin {
					allowed = true
					break
				}
			}

			if allowed && origin != "" {
				if config.AllowedOrigins[0] == "*" && !config.AllowCredentials {
					w.Header().Set("Access-Control-Allow-Origin", "*")
				} else {
					w.Header().Set("Access-Control-Allow-Origin", origin)
				}
			}

			if config.AllowCredentials {
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}

			// Handle preflight requests
			if r.Method == http.MethodOptions {
				w.Header().Set("Access-Control-Allow-Methods", strings.Join(config.AllowedMethods, ", "))
				w.Header().Set("Access-Control-Allow-Headers", strings.Join(config.AllowedHeaders, ", "))
				if config.MaxAge > 0 {
					w.Header().Set("Access-Control-Max-Age", string(rune(config.MaxAge)))
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}
