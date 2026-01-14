package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/ajbergh/veeam-single-ui/backend/internal/crypto"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
	"github.com/go-chi/chi/v5"
)

// CredentialsHandler handles server credential management
type CredentialsHandler struct {
	db    *database.DB
	vault *crypto.Vault
}

// NewCredentialsHandler creates a new credentials handler
func NewCredentialsHandler(db *database.DB, vault *crypto.Vault) *CredentialsHandler {
	return &CredentialsHandler{db: db, vault: vault}
}

// ListServers returns all servers with credentials redacted
// GET /api/v1/servers
func (h *CredentialsHandler) ListServers(w http.ResponseWriter, r *http.Request) {
	productType := r.URL.Query().Get("productType")

	var pt *models.ProductType
	if productType != "" {
		p := models.ProductType(productType)
		if !p.IsValid() {
			writeError(w, http.StatusBadRequest, "Invalid productType")
			return
		}
		pt = &p
	}

	servers, err := h.db.ListServers(pt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to list servers: "+err.Error())
		return
	}

	// Convert to response format (with redacted credentials)
	responses := make([]*models.ServerResponse, 0, len(servers))
	for _, server := range servers {
		resp, err := h.serverToResponse(server)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to process server: "+err.Error())
			return
		}
		responses = append(responses, resp)
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"data":  responses,
		"total": len(responses),
	})
}

// CreateServer creates a new server with encrypted credentials
// POST /api/v1/servers
func (h *CredentialsHandler) CreateServer(w http.ResponseWriter, r *http.Request) {
	var input models.ServerInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	// Validate input
	if err := input.Validate(); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Encrypt credentials
	usernameEncrypted, err := h.vault.Encrypt(input.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to encrypt username")
		return
	}

	passwordEncrypted, err := h.vault.Encrypt(input.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to encrypt password")
		return
	}

	// Set defaults
	verifySSL := true
	if input.VerifySSL != nil {
		verifySSL = *input.VerifySSL
	}

	isDefault := false
	if input.IsDefault != nil {
		isDefault = *input.IsDefault
	}

	server := &models.Server{
		Name:              input.Name,
		ProductType:       input.ProductType,
		APIURL:            input.APIURL,
		UsernameEncrypted: usernameEncrypted,
		PasswordEncrypted: passwordEncrypted,
		VerifySSL:         verifySSL,
		IsDefault:         isDefault,
	}

	if err := h.db.CreateServer(server); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to create server: "+err.Error())
		return
	}

	// Log audit
	h.logAudit(r, models.AuditActionServerCreate, &server.ID, nil)

	resp, _ := h.serverToResponse(server)
	writeJSON(w, http.StatusCreated, resp)
}

// GetServer returns a single server by ID
// GET /api/v1/servers/{id}
func (h *CredentialsHandler) GetServer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	server, err := h.db.GetServer(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get server: "+err.Error())
		return
	}
	if server == nil {
		writeError(w, http.StatusNotFound, "Server not found")
		return
	}

	resp, err := h.serverToResponse(server)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to process server: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

// UpdateServer updates an existing server
// PUT /api/v1/servers/{id}
func (h *CredentialsHandler) UpdateServer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	// Get existing server
	existing, err := h.db.GetServer(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get server: "+err.Error())
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "Server not found")
		return
	}

	var input models.ServerInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	// Update fields if provided
	if input.Name != "" {
		existing.Name = input.Name
	}
	if input.ProductType != "" {
		if !input.ProductType.IsValid() {
			writeError(w, http.StatusBadRequest, "Invalid productType")
			return
		}
		existing.ProductType = input.ProductType
	}
	if input.APIURL != "" {
		existing.APIURL = input.APIURL
	}
	if input.Username != "" {
		usernameEncrypted, err := h.vault.Encrypt(input.Username)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to encrypt username")
			return
		}
		existing.UsernameEncrypted = usernameEncrypted
	}
	if input.Password != "" {
		passwordEncrypted, err := h.vault.Encrypt(input.Password)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to encrypt password")
			return
		}
		existing.PasswordEncrypted = passwordEncrypted

		// Clear existing token when password changes
		h.db.DeleteToken(id)
	}
	if input.VerifySSL != nil {
		existing.VerifySSL = *input.VerifySSL
	}
	if input.IsDefault != nil {
		existing.IsDefault = *input.IsDefault
	}

	if err := h.db.UpdateServer(existing); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to update server: "+err.Error())
		return
	}

	// Log audit
	h.logAudit(r, models.AuditActionServerUpdate, &id, nil)

	resp, _ := h.serverToResponse(existing)
	writeJSON(w, http.StatusOK, resp)
}

// DeleteServer deletes a server
// DELETE /api/v1/servers/{id}
func (h *CredentialsHandler) DeleteServer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	if err := h.db.DeleteServer(id); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to delete server: "+err.Error())
		return
	}

	// Log audit
	h.logAudit(r, models.AuditActionServerDelete, &id, nil)

	w.WriteHeader(http.StatusNoContent)
}

// ForceAuth forces re-authentication for a server
// POST /api/v1/servers/{id}/authenticate
func (h *CredentialsHandler) ForceAuth(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	// Clear existing token to force re-auth
	if err := h.db.DeleteToken(id); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to clear token: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"message": "Token cleared. Next request will trigger re-authentication.",
	})
}

// TokenStatus returns the token status for a server
// GET /api/v1/servers/{id}/token/status
func (h *CredentialsHandler) TokenStatus(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "Server ID is required")
		return
	}

	status, err := h.db.GetTokenStatus(id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to get token status: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, status)
}

// serverToResponse converts a server model to API response format
func (h *CredentialsHandler) serverToResponse(server *models.Server) (*models.ServerResponse, error) {
	// Decrypt username for display (but never password)
	username, err := h.vault.Decrypt(server.UsernameEncrypted)
	if err != nil {
		return nil, err
	}

	// Get token status
	tokenStatus := "none"
	status, err := h.db.GetTokenStatus(server.ID)
	if err == nil && status.HasToken {
		if status.IsExpired {
			tokenStatus = "expired"
		} else {
			tokenStatus = "valid"
		}
	}

	return &models.ServerResponse{
		ID:          server.ID,
		Name:        server.Name,
		ProductType: server.ProductType,
		APIURL:      server.APIURL,
		Username:    username,
		VerifySSL:   server.VerifySSL,
		IsDefault:   server.IsDefault,
		CreatedAt:   server.CreatedAt,
		UpdatedAt:   server.UpdatedAt,
		TokenStatus: tokenStatus,
	}, nil
}

// logAudit creates an audit log entry
func (h *CredentialsHandler) logAudit(r *http.Request, action string, serverID *string, errMsg *string) {
	log := &models.AuditLog{
		Action:       action,
		ServerID:     serverID,
		ErrorMessage: errMsg,
		ClientIP:     ptrString(r.RemoteAddr),
		UserAgent:    ptrString(r.UserAgent()),
	}
	h.db.CreateAuditLog(log)
}

// Helper functions

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func ptrString(s string) *string {
	return &s
}
