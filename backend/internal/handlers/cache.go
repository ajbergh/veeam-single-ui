package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ajbergh/veeam-single-ui/backend/internal/cache"
	"github.com/go-chi/chi/v5"
)

// CacheHandler handles cache management endpoints
type CacheHandler struct {
	manager     *cache.Manager
	rateLimiter *cache.RateLimiter
}

// NewCacheHandler creates a new cache handler
func NewCacheHandler(manager *cache.Manager, rateLimiter *cache.RateLimiter) *CacheHandler {
	return &CacheHandler{
		manager:     manager,
		rateLimiter: rateLimiter,
	}
}

// GetStats returns cache statistics
// GET /api/v1/cache/stats
func (h *CacheHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.manager.GetStats()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get cache stats: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, stats)
}

// InvalidateServer clears all cache entries for a server
// DELETE /api/v1/servers/{id}/cache
func (h *CacheHandler) InvalidateServer(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "id")
	if serverID == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	deleted, err := h.manager.InvalidateByServer(serverID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to invalidate cache: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message":        "Cache invalidated for server",
		"serverID":       serverID,
		"deletedEntries": deleted,
	})
}

// InvalidatePattern clears cache entries matching a pattern
// DELETE /api/v1/servers/{id}/cache/{pattern}
func (h *CacheHandler) InvalidatePattern(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "id")
	pattern := chi.URLParam(r, "pattern")

	if serverID == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	deleted, err := h.manager.InvalidateByPattern(serverID, pattern)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to invalidate cache: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message":        "Cache invalidated for pattern",
		"serverID":       serverID,
		"pattern":        pattern,
		"deletedEntries": deleted,
	})
}

// InvalidateAll clears all cache entries
// DELETE /api/v1/cache
func (h *CacheHandler) InvalidateAll(w http.ResponseWriter, r *http.Request) {
	deleted, err := h.manager.InvalidateAll()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to invalidate cache: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message":        "All cache entries invalidated",
		"deletedEntries": deleted,
	})
}

// GetRateLimiterStats returns rate limiter statistics
// GET /api/v1/cache/ratelimit
func (h *CacheHandler) GetRateLimiterStats(w http.ResponseWriter, r *http.Request) {
	stats := h.rateLimiter.Stats()

	// Convert to more readable format
	response := make(map[string]map[string]interface{})
	for key, tokens := range stats {
		response[key] = map[string]interface{}{
			"availableTokens": tokens,
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"rateLimits": cache.RateLimits,
		"buckets":    response,
	})
}

// ResetRateLimiter resets rate limiter for a server
// POST /api/v1/servers/{id}/ratelimit/reset
func (h *CacheHandler) ResetRateLimiter(w http.ResponseWriter, r *http.Request) {
	serverID := chi.URLParam(r, "id")
	if serverID == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	var input struct {
		ProductType string `json:"productType"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		// If no body, that's fine
		input.ProductType = ""
	}

	if input.ProductType != "" {
		h.rateLimiter.Reset(serverID, input.ProductType)
	} else {
		// Reset all product types for this server
		for productType := range cache.RateLimits {
			h.rateLimiter.Reset(serverID, productType)
		}
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"message":  "Rate limiter reset",
		"serverID": serverID,
	})
}

// GetCacheConfigs returns cache configuration
// GET /api/v1/cache/config
func (h *CacheHandler) GetCacheConfigs(w http.ResponseWriter, r *http.Request) {
	// Return the endpoint TTL configuration
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"defaultTTL":   cache.DefaultTTL.String(),
		"shortTTL":     cache.ShortTTL.String(),
		"mediumTTL":    cache.MediumTTL.String(),
		"longTTL":      cache.LongTTL.String(),
		"veryLongTTL":  cache.VeryLongTTL.String(),
		"maxCacheSize": cache.MaxCacheSize,
		"compression":  cache.CompressionEnabled,
		"endpointTTLs": cache.DefaultEndpointTTLs,
	})
}
