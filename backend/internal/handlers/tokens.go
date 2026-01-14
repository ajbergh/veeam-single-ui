package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ajbergh/veeam-single-ui/backend/internal/tokens"
	"github.com/go-chi/chi/v5"
)

// TokenHandler handles token management endpoints
type TokenHandler struct {
	manager *tokens.Manager
}

// NewTokenHandler creates a new token handler
func NewTokenHandler(manager *tokens.Manager) *TokenHandler {
	return &TokenHandler{manager: manager}
}

// Authenticate performs authentication for a server
// POST /api/v1/servers/{id}/authenticate
func (h *TokenHandler) Authenticate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	status, err := h.manager.AuthenticateServer(id)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "Authentication failed: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": "Authentication successful",
		"token":   status,
	})
}

// GetTokenStatus returns the token status for a server
// GET /api/v1/servers/{id}/token/status
func (h *TokenHandler) GetTokenStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	status, err := h.manager.GetTokenStatus(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get token status: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, status)
}

// Logout invalidates the token for a server
// POST /api/v1/servers/{id}/logout
func (h *TokenHandler) Logout(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	if err := h.manager.LogoutServer(id); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to logout: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"message": "Logged out successfully",
	})
}

// GetAccessToken returns a valid access token for making API calls
// GET /api/v1/servers/{id}/token
func (h *TokenHandler) GetAccessToken(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	token, err := h.manager.GetAccessToken(id)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"accessToken": token,
	})
}

// AuthenticateMultiple authenticates multiple servers at once
// POST /api/v1/servers/authenticate
func (h *TokenHandler) AuthenticateMultiple(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ServerIDs []string `json:"serverIds"`
	}
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if len(input.ServerIDs) == 0 {
		writeError(w, http.StatusBadRequest, "serverIds is required")
		return
	}

	results := make(map[string]interface{})
	for _, id := range input.ServerIDs {
		status, err := h.manager.AuthenticateServer(id)
		if err != nil {
			results[id] = map[string]interface{}{
				"success": false,
				"error":   err.Error(),
			}
		} else {
			results[id] = map[string]interface{}{
				"success": true,
				"token":   status,
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"results": results,
	})
}
