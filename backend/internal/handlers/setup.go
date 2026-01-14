package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/crypto"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
	"github.com/ajbergh/veeam-single-ui/backend/internal/tokens"
)

// SetupHandler handles first-start setup wizard endpoints
type SetupHandler struct {
	db           *database.DB
	vault        *crypto.Vault
	tokenManager *tokens.Manager
}

// NewSetupHandler creates a new setup handler
func NewSetupHandler(db *database.DB, vault *crypto.Vault, tokenManager *tokens.Manager) *SetupHandler {
	return &SetupHandler{db: db, vault: vault, tokenManager: tokenManager}
}

// SetupStatusResponse represents the current setup status
type SetupStatusResponse struct {
	SetupComplete  bool           `json:"setupComplete"`
	HasVBRServer   bool           `json:"hasVbrServer"`
	HasVROServer   bool           `json:"hasVroServer"`
	HasVBMServer   bool           `json:"hasVbmServer"`
	HasVB365Server bool           `json:"hasVb365Server"`
	HasK10Server   bool           `json:"hasK10Server"`
	HasVONEServer  bool           `json:"hasVoneServer"`
	TotalServers   int            `json:"totalServers"`
	ServersByType  map[string]int `json:"serversByType"`
	LastSetupAt    *time.Time     `json:"lastSetupAt,omitempty"`
}

// GetSetupStatus returns the current setup status
// GET /api/v1/setup/status
func (h *SetupHandler) GetSetupStatus(w http.ResponseWriter, r *http.Request) {
	// Get server counts by product type
	serversByType := make(map[string]int)
	var totalServers int

	productTypes := []models.ProductType{
		models.ProductTypeVBR,
		models.ProductTypeVRO,
		models.ProductTypeVBM,
		models.ProductTypeVB365,
		models.ProductTypeK10,
		models.ProductTypeVONE,
	}

	for _, pt := range productTypes {
		count, err := h.db.CountServers(&pt)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Failed to count servers: "+err.Error())
			return
		}
		serversByType[string(pt)] = count
		totalServers += count
	}

	// Setup is complete if at least one VBR server is configured
	// (VBR is the primary/required product)
	hasVBR := serversByType["vbr"] > 0

	response := SetupStatusResponse{
		SetupComplete:  hasVBR,
		HasVBRServer:   hasVBR,
		HasVROServer:   serversByType["vro"] > 0,
		HasVBMServer:   serversByType["vbm"] > 0,
		HasVB365Server: serversByType["vb365"] > 0,
		HasK10Server:   serversByType["k10"] > 0,
		HasVONEServer:  serversByType["vone"] > 0,
		TotalServers:   totalServers,
		ServersByType:  serversByType,
	}

	writeJSON(w, http.StatusOK, response)
}

// WizardStepInput represents input for each wizard step
type WizardStepInput struct {
	Step int `json:"step"`
	// Step 1: VBR Server (Required)
	VBRServer *ServerSetupInput `json:"vbrServer,omitempty"`
	// Step 2: VRO Server (Optional)
	VROServer *ServerSetupInput `json:"vroServer,omitempty"`
	// Step 3: VBM/VB365 Server (Optional)
	VBMServer *ServerSetupInput `json:"vbmServer,omitempty"`
	// Step 4: Veeam ONE Server (Optional)
	VoneServer *ServerSetupInput `json:"voneServer,omitempty"`
	// Step 5: K10 Server (Optional)
	K10Server *ServerSetupInput `json:"k10Server,omitempty"`
}

// ServerSetupInput represents server configuration during wizard
type ServerSetupInput struct {
	Name        string `json:"name"`
	APIURL      string `json:"apiUrl"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	VerifySSL   bool   `json:"verifySSL"`
	TestConnect bool   `json:"testConnect"` // If true, test connection before saving
}

// WizardStepResponse represents the response after processing a wizard step
type WizardStepResponse struct {
	Success       bool                   `json:"success"`
	Step          int                    `json:"step"`
	Message       string                 `json:"message,omitempty"`
	Server        *models.ServerResponse `json:"server,omitempty"`
	TestResult    *ConnectionTestResult  `json:"testResult,omitempty"`
	SetupComplete bool                   `json:"setupComplete"`
}

// ConnectionTestResult represents the result of a connection test
type ConnectionTestResult struct {
	Success       bool   `json:"success"`
	Message       string `json:"message"`
	ServerVersion string `json:"serverVersion,omitempty"`
	ResponseTime  int64  `json:"responseTimeMs"`
}

// ProcessWizardStep processes a wizard step and saves configuration
// POST /api/v1/setup/wizard
func (h *SetupHandler) ProcessWizardStep(w http.ResponseWriter, r *http.Request) {
	var input WizardStepInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	var response WizardStepResponse
	response.Step = input.Step

	switch input.Step {
	case 1:
		// VBR Server Setup (Required)
		if input.VBRServer == nil {
			writeError(w, http.StatusBadRequest, "VBR server configuration is required for step 1")
			return
		}
		result, err := h.setupServer(input.VBRServer, models.ProductTypeVBR, true)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		response = *result

	case 2:
		// VRO Server Setup (Optional)
		if input.VROServer == nil {
			// Skip step
			response.Success = true
			response.Message = "VRO setup skipped"
		} else {
			result, err := h.setupServer(input.VROServer, models.ProductTypeVRO, true)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			response = *result
		}

	case 3:
		// VBM Server Setup (Optional)
		if input.VBMServer == nil {
			// Skip step
			response.Success = true
			response.Message = "VBM setup skipped"
		} else {
			result, err := h.setupServer(input.VBMServer, models.ProductTypeVBM, true)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			response = *result
		}

	case 4:
		// Veeam ONE Server Setup (Optional)
		if input.VoneServer == nil {
			// Skip step
			response.Success = true
			response.Message = "Veeam ONE setup skipped"
		} else {
			result, err := h.setupServer(input.VoneServer, models.ProductTypeVONE, true)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			response = *result
		}

	case 5:
		// K10 Server Setup (Optional)
		if input.K10Server == nil {
			// Skip step
			response.Success = true
			response.Message = "K10 setup skipped"
		} else {
			result, err := h.setupServer(input.K10Server, models.ProductTypeK10, true)
			if err != nil {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			response = *result
		}

	default:
		writeError(w, http.StatusBadRequest, "Invalid step number")
		return
	}

	// Check if setup is complete (has VBR)
	vbrType := models.ProductTypeVBR
	vbrCount, _ := h.db.CountServers(&vbrType)
	response.SetupComplete = vbrCount > 0
	response.Step = input.Step

	writeJSON(w, http.StatusOK, response)
}

// setupServer creates and optionally tests a server connection
func (h *SetupHandler) setupServer(input *ServerSetupInput, productType models.ProductType, isDefault bool) (*WizardStepResponse, error) {
	response := &WizardStepResponse{}

	// Validate input
	if input.Name == "" {
		return nil, &ValidationError{Field: "name", Message: "Server name is required"}
	}
	if input.APIURL == "" {
		return nil, &ValidationError{Field: "apiUrl", Message: "API URL is required"}
	}
	if input.Username == "" {
		return nil, &ValidationError{Field: "username", Message: "Username is required"}
	}
	if input.Password == "" {
		return nil, &ValidationError{Field: "password", Message: "Password is required"}
	}

	// Test connection if requested
	if input.TestConnect {
		startTime := time.Now()
		testResult := &ConnectionTestResult{}

		// Try to authenticate
		err := h.tokenManager.AuthenticateWithCredentials(productType, input.APIURL, input.Username, input.Password, input.VerifySSL)
		testResult.ResponseTime = time.Since(startTime).Milliseconds()

		if err != nil {
			testResult.Success = false
			testResult.Message = "Connection failed: " + err.Error()
			response.TestResult = testResult
			response.Success = false
			response.Message = "Connection test failed"
			return response, nil
		}

		testResult.Success = true
		testResult.Message = "Connection successful"
		response.TestResult = testResult
	}

	// Encrypt credentials
	usernameEncrypted, err := h.vault.Encrypt(input.Username)
	if err != nil {
		return nil, &InternalError{Message: "Failed to encrypt username"}
	}

	passwordEncrypted, err := h.vault.Encrypt(input.Password)
	if err != nil {
		return nil, &InternalError{Message: "Failed to encrypt password"}
	}

	// Create server entry
	server := &models.Server{
		Name:              input.Name,
		ProductType:       productType,
		APIURL:            input.APIURL,
		UsernameEncrypted: usernameEncrypted,
		PasswordEncrypted: passwordEncrypted,
		VerifySSL:         input.VerifySSL,
		IsDefault:         isDefault,
	}

	if err := h.db.CreateServer(server); err != nil {
		return nil, &InternalError{Message: "Failed to save server: " + err.Error()}
	}

	// Create response
	username, _ := h.vault.Decrypt(server.UsernameEncrypted)
	serverResponse := &models.ServerResponse{
		ID:          server.ID,
		Name:        server.Name,
		ProductType: server.ProductType,
		APIURL:      server.APIURL,
		Username:    username,
		VerifySSL:   server.VerifySSL,
		IsDefault:   server.IsDefault,
		CreatedAt:   server.CreatedAt,
		UpdatedAt:   server.UpdatedAt,
	}

	response.Success = true
	response.Message = "Server configured successfully"
	response.Server = serverResponse

	return response, nil
}

// TestConnection tests a connection without saving
// POST /api/v1/setup/test
func (h *SetupHandler) TestConnection(w http.ResponseWriter, r *http.Request) {
	var input struct {
		ProductType string `json:"productType"`
		APIURL      string `json:"apiUrl"`
		Username    string `json:"username"`
		Password    string `json:"password"`
		VerifySSL   bool   `json:"verifySSL"`
	}

	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request body: "+err.Error())
		return
	}

	if input.APIURL == "" || input.Username == "" || input.Password == "" {
		writeError(w, http.StatusBadRequest, "API URL, username, and password are required")
		return
	}

	productType := models.ProductType(input.ProductType)
	if !productType.IsValid() {
		writeError(w, http.StatusBadRequest, "Invalid product type")
		return
	}

	startTime := time.Now()
	result := ConnectionTestResult{}

	// Try to authenticate
	err := h.tokenManager.AuthenticateWithCredentials(productType, input.APIURL, input.Username, input.Password, input.VerifySSL)
	result.ResponseTime = time.Since(startTime).Milliseconds()

	if err != nil {
		result.Success = false
		result.Message = "Connection failed: " + err.Error()
	} else {
		result.Success = true
		result.Message = "Connection successful"
	}

	writeJSON(w, http.StatusOK, result)
}

// CompleteSetup marks the setup as complete
// POST /api/v1/setup/complete
func (h *SetupHandler) CompleteSetup(w http.ResponseWriter, r *http.Request) {
	// Verify at least one VBR server exists
	vbrType := models.ProductTypeVBR
	vbrCount, err := h.db.CountServers(&vbrType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to verify setup: "+err.Error())
		return
	}

	if vbrCount == 0 {
		writeError(w, http.StatusBadRequest, "At least one VBR server must be configured to complete setup")
		return
	}

	// Log completion in audit log
	details := "Initial setup wizard completed"
	h.db.CreateAuditLog(&models.AuditLog{
		Action:       "setup_complete",
		ErrorMessage: &details, // Using ErrorMessage field for details
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"success":       true,
		"message":       "Setup completed successfully",
		"setupComplete": true,
	})
}

// ValidationError represents a validation error
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	return e.Field + ": " + e.Message
}

// InternalError represents an internal server error
type InternalError struct {
	Message string
}

func (e *InternalError) Error() string {
	return e.Message
}
