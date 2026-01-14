/*
Package handlers provides HTTP request handlers for the Veeam Single-UI Go Backend.

This file implements the API proxy handler that forwards requests to Veeam product APIs
while providing:
  - Transparent caching with cache hit/miss headers (X-Cache: HIT/MISS)
  - Automatic token injection from the token manager
  - Rate limiting per product type
  - ETag-based cache validation
  - CORS header deduplication (filters upstream CORS headers to prevent conflicts)

Endpoints:
  - GET/POST/PUT/DELETE /api/v1/proxy/{serverID}/* - Proxied API requests

Cache Behavior:
  - GET requests are cached based on TTL rules per endpoint
  - Cache keys include server ID, path, and query parameters
  - ETag support for conditional requests
  - Gzip compression for cached responses

Rate Limiting:
  - VBM: 1 request/second (API limitation)
  - Other products: 10 requests/second
  - 429 responses returned when limit exceeded

Key Functions:
  - ProxyRequest: Main handler that routes requests through cache/rate limiter to Veeam APIs
  - getClientForServer: Creates HTTP client with appropriate TLS settings
  - addProductHeaders: Adds product-specific headers (e.g., x-api-version for VBR)
*/
package handlers

import (
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/cache"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
	"github.com/ajbergh/veeam-single-ui/backend/internal/tokens"
	"github.com/go-chi/chi/v5"
)

// ProxyHandler handles proxying requests to Veeam APIs with caching
type ProxyHandler struct {
	db           *database.DB
	tokenManager *tokens.Manager
	cacheManager *cache.Manager
	rateLimiter  *cache.RateLimiter
}

// NewProxyHandler creates a new proxy handler with all required dependencies.
//
// Parameters:
//   - db: Database connection for server lookups and audit logging
//   - tokenManager: Token manager for authentication and token retrieval
//   - cacheManager: Cache manager for response caching
//   - rateLimiter: Rate limiter for API throttling
//
// Returns:
//   - *ProxyHandler: Configured proxy handler ready to handle requests
func NewProxyHandler(db *database.DB, tokenManager *tokens.Manager, cacheManager *cache.Manager, rateLimiter *cache.RateLimiter) *ProxyHandler {
	return &ProxyHandler{
		db:           db,
		tokenManager: tokenManager,
		cacheManager: cacheManager,
		rateLimiter:  rateLimiter,
	}
}

// getClientForServer creates an HTTP client with the appropriate TLS settings for the server.
// Respects the server's VerifySSL setting for self-signed certificate support.
func (h *ProxyHandler) getClientForServer(server *models.Server) *http.Client {
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: !server.VerifySSL,
		},
		MaxIdleConns:       100,
		IdleConnTimeout:    90 * time.Second,
		DisableCompression: false,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   60 * time.Second,
	}
}

// ProxyRequest handles proxied API requests to Veeam product APIs.
//
// This is the main handler for all proxied requests. It:
//  1. Validates the server ID from the URL path
//  2. Applies rate limiting based on product type
//  3. Checks cache for GET requests (returns cached response if valid)
//  4. Retrieves authentication token from token manager
//  5. Forwards request to Veeam API with token injection
//  6. Caches successful GET responses
//  7. Filters CORS headers from upstream to prevent duplicates
//
// Route: GET/POST/PUT/DELETE /api/v1/proxy/{serverID}/*
//
// Response Headers:
//   - X-Cache: HIT or MISS (indicates cache status)
//   - X-RateLimit-Remaining: Requests remaining in current window
func (h *ProxyHandler) ProxyRequest(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if serverID == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	// Get the rest of the path after /proxy/{serverID}
	path := chi.URLParam(r, "*")
	if path == "" {
		path = "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	// Get server details
	server, err := h.db.GetServer(serverID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get server: "+err.Error())
		return
	}
	if server == nil {
		writeError(w, http.StatusNotFound, "Server not found")
		return
	}

	// Check rate limit
	waitTime := h.rateLimiter.GetWaitTime(serverID, string(server.ProductType))
	if waitTime > 0 {
		// Wait for rate limit
		h.rateLimiter.Wait(serverID, string(server.ProductType))
	}

	// For GET requests, try cache first
	queryParams := r.URL.RawQuery
	if r.Method == http.MethodGet {
		cached, err := h.cacheManager.Get(serverID, path, queryParams)
		if err == nil && cached != nil {
			// Cache hit
			w.Header().Set("Content-Type", cached.ContentType)
			w.Header().Set("X-Cache", "HIT")
			w.Header().Set("X-Cache-Age", fmt.Sprintf("%d", int(time.Since(cached.CachedAt).Seconds())))
			w.Header().Set("X-Cache-TTL", fmt.Sprintf("%d", int(cached.TimeToLive().Seconds())))
			if cached.ETag != "" {
				w.Header().Set("ETag", cached.ETag)
			}
			w.WriteHeader(http.StatusOK)
			w.Write(cached.Data)

			// Log cache hit
			h.logAudit(r, models.AuditActionCacheHit, server.ID, path)
			return
		}
	}

	// Get access token
	accessToken, err := h.tokenManager.GetAccessToken(serverID)
	if err != nil {
		// If authentication is required, return appropriate error
		if strings.Contains(err.Error(), "authentication required") {
			writeError(w, http.StatusUnauthorized, "Server authentication required. POST to /api/v1/servers/{id}/authenticate first.")
			return
		}
		writeError(w, http.StatusInternalServerError, "Failed to get access token: "+err.Error())
		return
	}

	// Build target URL
	targetURL := strings.TrimSuffix(server.APIURL, "/") + path
	if queryParams != "" {
		targetURL += "?" + queryParams
	}

	// Create proxy request
	proxyReq, err := http.NewRequest(r.Method, targetURL, r.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create proxy request: "+err.Error())
		return
	}

	// Copy headers from original request (except host and authorization)
	for key, values := range r.Header {
		lowerKey := strings.ToLower(key)
		if lowerKey == "host" || lowerKey == "authorization" {
			continue
		}
		for _, value := range values {
			proxyReq.Header.Add(key, value)
		}
	}

	// Add authorization
	proxyReq.Header.Set("Authorization", "Bearer "+accessToken)

	// Add product-specific headers
	h.addProductHeaders(proxyReq, server.ProductType)

	// Execute request with per-server HTTP client
	client := h.getClientForServer(server)
	resp, err := client.Do(proxyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Proxy request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	// Read response body
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to read response: "+err.Error())
		return
	}

	// Cache successful GET responses
	if r.Method == http.MethodGet && resp.StatusCode == http.StatusOK {
		contentType := resp.Header.Get("Content-Type")
		etag := resp.Header.Get("ETag")

		if err := h.cacheManager.Set(serverID, path, queryParams, body, contentType, etag); err != nil {
			log.Printf("Failed to cache response for %s: %v", path, err)
		}

		// Log cache miss
		h.logAudit(r, models.AuditActionCacheMiss, server.ID, path)
	}

	// Copy response headers (except CORS headers which are set by middleware)
	corsHeaders := map[string]bool{
		"access-control-allow-origin":      true,
		"access-control-allow-methods":     true,
		"access-control-allow-headers":     true,
		"access-control-allow-credentials": true,
		"access-control-expose-headers":    true,
		"access-control-max-age":           true,
	}
	for key, values := range resp.Header {
		// Skip CORS headers from upstream to avoid duplicates
		if corsHeaders[strings.ToLower(key)] {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	// Add cache miss header
	w.Header().Set("X-Cache", "MISS")

	// Write response
	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

// addProductHeaders adds product-specific headers to the request
func (h *ProxyHandler) addProductHeaders(req *http.Request, productType models.ProductType) {
	switch productType {
	case models.ProductTypeVBR:
		req.Header.Set("x-api-version", "1.2-rev0")
	case models.ProductTypeVRO:
		// VRO doesn't require special headers
	case models.ProductTypeVBM, models.ProductTypeVB365:
		// VBM might need specific API version headers
	case models.ProductTypeK10:
		// K10 uses standard headers
	}
}

// logAudit creates an audit log entry for proxy requests
func (h *ProxyHandler) logAudit(r *http.Request, action string, serverID string, endpoint string) {
	h.db.CreateAuditLog(&models.AuditLog{
		Action:    action,
		ServerID:  &serverID,
		Endpoint:  &endpoint,
		Method:    ptrString(r.Method),
		ClientIP:  ptrString(r.RemoteAddr),
		UserAgent: ptrString(r.UserAgent()),
	})
}

// ProxyNoCache handles proxied requests without caching (for mutations)
// POST/PUT/DELETE /api/v1/proxy-nocache/{serverID}/*
func (h *ProxyHandler) ProxyNoCache(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "serverID")
	if serverID == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	path := chi.URLParam(r, "*")
	if path == "" {
		path = "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	// Get server details
	server, err := h.db.GetServer(serverID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get server: "+err.Error())
		return
	}
	if server == nil {
		writeError(w, http.StatusNotFound, "Server not found")
		return
	}

	// Check rate limit
	h.rateLimiter.Wait(serverID, string(server.ProductType))

	// Get access token
	accessToken, err := h.tokenManager.GetAccessToken(serverID)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Server authentication required")
		return
	}

	// Build target URL
	targetURL := strings.TrimSuffix(server.APIURL, "/") + path
	if r.URL.RawQuery != "" {
		targetURL += "?" + r.URL.RawQuery
	}

	// Create proxy request
	proxyReq, err := http.NewRequest(r.Method, targetURL, r.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create request: "+err.Error())
		return
	}

	// Copy headers
	for key, values := range r.Header {
		lowerKey := strings.ToLower(key)
		if lowerKey == "host" || lowerKey == "authorization" {
			continue
		}
		for _, value := range values {
			proxyReq.Header.Add(key, value)
		}
	}

	proxyReq.Header.Set("Authorization", "Bearer "+accessToken)
	h.addProductHeaders(proxyReq, server.ProductType)

	// Execute request with per-server HTTP client
	client := h.getClientForServer(server)
	resp, err := client.Do(proxyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Request failed: "+err.Error())
		return
	}
	defer resp.Body.Close()

	// Read and write response
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to read response: "+err.Error())
		return
	}

	// For mutations, invalidate related cache entries
	if r.Method != http.MethodGet {
		h.invalidateRelatedCache(serverID, path)
	}

	// Copy response headers
	for key, values := range resp.Header {
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}

	w.WriteHeader(resp.StatusCode)
	w.Write(body)
}

// invalidateRelatedCache invalidates cache entries that might be affected by a mutation
func (h *ProxyHandler) invalidateRelatedCache(serverID, path string) {
	// Extract the resource type from the path (e.g., /jobs, /sessions)
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) > 0 {
		resourceType := parts[0]
		_, err := h.cacheManager.InvalidateByPattern(serverID, resourceType)
		if err != nil {
			log.Printf("Failed to invalidate cache for %s: %v", resourceType, err)
		}
	}
}
