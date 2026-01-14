/*
Package veeam provides authentication adapters for all Veeam product REST APIs.

This file implements the Authenticator which handles OAuth2 authentication for:
  - VBR (Veeam Backup & Replication): OAuth2 password grant on /api/oauth2/token
  - VRO (Veeam Recovery Orchestrator): Token endpoint on /api/token
  - VBM (Veeam Backup for Microsoft 365): Token endpoint on /v7/Token
  - VB365: Alias for VBM
  - K10 (Kasten): OIDC token endpoint on /k10/oidc/token

Authentication Flow:
 1. Authenticate: POST username/password to product-specific token endpoint
 2. Parse response for access_token, refresh_token, expires_in
 3. Store encrypted tokens in database via token Manager
 4. Refresh: POST refresh_token before expiry
 5. Logout: POST to revoke endpoint to invalidate token

Product Differences:
  - VBR: Uses x-api-version header (1.2-rev0)
  - VRO: Standard OAuth2 with grant_type=password
  - VBM: Uses organization-scoped tokens
  - K10: Uses OIDC with client credentials

Key Types:
  - Authenticator: Main authentication handler
  - ProductType: Enum for product identification
  - AuthEndpoints: Map of product to token endpoint

Key Functions:
  - NewAuthenticator: Creates authenticator with TLS settings
  - Authenticate: Performs initial OAuth authentication
  - Refresh: Refreshes expired token using refresh_token
  - Logout: Revokes token on the Veeam server
*/
package veeam

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
)

// ProductType identifies the Veeam product type
type ProductType string

const (
	ProductVBR   ProductType = "vbr"   // Veeam Backup & Replication
	ProductVRO   ProductType = "vro"   // Veeam Recovery Orchestrator
	ProductVBM   ProductType = "vbm"   // Veeam Backup for Microsoft 365
	ProductVB365 ProductType = "vb365" // Veeam Backup for Microsoft 365 (alias)
	ProductK10   ProductType = "k10"   // Kasten K10
	ProductVONE  ProductType = "vone"  // Veeam ONE
)

// AuthEndpoints maps product types to their authentication endpoints
var AuthEndpoints = map[ProductType]string{
	ProductVBR:   "/api/oauth2/token",
	ProductVRO:   "/api/token",
	ProductVBM:   "/v7/Token",
	ProductVB365: "/v7/Token",
	ProductK10:   "/k10/oidc/token", // K10 uses OIDC
	ProductVONE:  "/api/token",      // Veeam ONE uses OAuth2
}

// Authenticator implements product-specific authentication for Veeam products
type Authenticator struct {
	defaultVerifySSL bool
}

// NewAuthenticator creates a new Veeam authenticator
func NewAuthenticator(verifySSL bool) *Authenticator {
	return &Authenticator{
		defaultVerifySSL: verifySSL,
	}
}

// getClientForServer creates an HTTP client with the appropriate TLS settings for the server
func (a *Authenticator) getClientForServer(server *models.Server) *http.Client {
	// Use server-specific VerifySSL setting, fallback to default
	verifySSL := server.VerifySSL

	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			InsecureSkipVerify: !verifySSL,
		},
	}

	return &http.Client{
		Transport: transport,
		Timeout:   30 * time.Second,
	}
}

// Authenticate performs initial authentication for a Veeam server
func (a *Authenticator) Authenticate(server *models.Server, username, password string) (*models.TokenResponse, error) {
	productType := ProductType(server.ProductType)

	switch productType {
	case ProductVBR:
		return a.authenticateVBR(server, password, username)
	case ProductVRO:
		return a.authenticateVRO(server, password, username)
	case ProductVBM, ProductVB365:
		return a.authenticateVBM(server, password, username)
	case ProductK10:
		return a.authenticateK10(server, password, username)
	case ProductVONE:
		return a.authenticateVONE(server, password, username)
	default:
		return nil, fmt.Errorf("unsupported product type: %s", productType)
	}
}

// Refresh uses the refresh token to get a new access token
func (a *Authenticator) Refresh(server *models.Server, refreshToken string) (*models.TokenResponse, error) {
	productType := ProductType(server.ProductType)

	switch productType {
	case ProductVBR:
		return a.refreshVBR(server, refreshToken)
	case ProductVRO:
		return a.refreshVRO(server, refreshToken)
	case ProductVBM, ProductVB365:
		return a.refreshVBM(server, refreshToken)
	case ProductK10:
		return a.refreshK10(server, refreshToken)
	case ProductVONE:
		return a.refreshVONE(server, refreshToken)
	default:
		return nil, fmt.Errorf("unsupported product type: %s", productType)
	}
}

// Logout invalidates the token on the server
func (a *Authenticator) Logout(server *models.Server, accessToken string) error {
	productType := ProductType(server.ProductType)

	switch productType {
	case ProductVBR:
		return a.logoutVBR(server, accessToken)
	case ProductVRO:
		return nil // VRO doesn't have logout endpoint
	case ProductVBM, ProductVB365:
		return a.logoutVBM(server, accessToken)
	case ProductK10:
		return nil // K10 tokens expire naturally
	case ProductVONE:
		return nil // Veeam ONE tokens expire naturally
	default:
		return nil
	}
}

// ===== VBR (Veeam Backup & Replication) Authentication =====

func (a *Authenticator) authenticateVBR(server *models.Server, password string, username string) (*models.TokenResponse, error) {
	authURL := strings.TrimSuffix(server.APIURL, "/") + AuthEndpoints[ProductVBR]

	data := url.Values{}
	data.Set("grant_type", "password")
	data.Set("username", username)
	data.Set("password", password)

	req, err := http.NewRequest("POST", authURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("x-api-version", "1.2-rev0")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("authentication failed (status %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp models.TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// VBR tokens typically expire in 15 minutes (900 seconds)
	if tokenResp.ExpiresIn == 0 {
		tokenResp.ExpiresIn = 900
	}

	return &tokenResp, nil
}

func (a *Authenticator) refreshVBR(server *models.Server, refreshToken string) (*models.TokenResponse, error) {
	authURL := strings.TrimSuffix(server.APIURL, "/") + AuthEndpoints[ProductVBR]

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequest("POST", authURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("x-api-version", "1.2-rev0")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("refresh failed (status %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp models.TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &tokenResp, nil
}

func (a *Authenticator) logoutVBR(server *models.Server, accessToken string) error {
	logoutURL := strings.TrimSuffix(server.APIURL, "/") + "/api/oauth2/logout"

	req, err := http.NewRequest("POST", logoutURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("x-api-version", "1.2-rev0")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	// 200 or 204 both indicate success
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusNoContent {
		return fmt.Errorf("logout failed with status %d", resp.StatusCode)
	}

	return nil
}

// ===== VRO (Veeam ONE) Authentication =====

func (a *Authenticator) authenticateVRO(server *models.Server, password string, username string) (*models.TokenResponse, error) {
	authURL := strings.TrimSuffix(server.APIURL, "/") + AuthEndpoints[ProductVRO]

	data := url.Values{}
	data.Set("grant_type", "password")
	data.Set("username", username)
	data.Set("password", password)

	req, err := http.NewRequest("POST", authURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("authentication failed (status %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp models.TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// VRO tokens typically expire in 1 hour (3600 seconds)
	if tokenResp.ExpiresIn == 0 {
		tokenResp.ExpiresIn = 3600
	}

	return &tokenResp, nil
}

func (a *Authenticator) refreshVRO(server *models.Server, refreshToken string) (*models.TokenResponse, error) {
	authURL := strings.TrimSuffix(server.APIURL, "/") + AuthEndpoints[ProductVRO]

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequest("POST", authURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("refresh failed (status %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp models.TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &tokenResp, nil
}

// ===== VBM/VB365 (Veeam Backup for Microsoft 365) Authentication =====

func (a *Authenticator) authenticateVBM(server *models.Server, password string, username string) (*models.TokenResponse, error) {
	authURL := strings.TrimSuffix(server.APIURL, "/") + AuthEndpoints[ProductVBM]

	data := url.Values{}
	data.Set("grant_type", "password")
	data.Set("username", username)
	data.Set("password", password)

	req, err := http.NewRequest("POST", authURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("authentication failed (status %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp models.TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	// VBM tokens typically expire in 1 hour (3600 seconds)
	if tokenResp.ExpiresIn == 0 {
		tokenResp.ExpiresIn = 3600
	}

	return &tokenResp, nil
}

func (a *Authenticator) refreshVBM(server *models.Server, refreshToken string) (*models.TokenResponse, error) {
	authURL := strings.TrimSuffix(server.APIURL, "/") + AuthEndpoints[ProductVBM]

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequest("POST", authURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("refresh failed (status %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp models.TokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &tokenResp, nil
}

func (a *Authenticator) logoutVBM(server *models.Server, accessToken string) error {
	logoutURL := strings.TrimSuffix(server.APIURL, "/") + "/v7/Logout"

	req, err := http.NewRequest("POST", logoutURL, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	return nil
}

// ===== K10 (Kasten) Authentication =====

func (a *Authenticator) authenticateK10(server *models.Server, password string, username string) (*models.TokenResponse, error) {
	// K10 uses API tokens or OIDC - for simplicity, we'll use basic auth
	// and return a synthetic token
	authURL := strings.TrimSuffix(server.APIURL, "/") + "/k10/api/v1/config"

	req, err := http.NewRequest("GET", authURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.SetBasicAuth(username, password)

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("authentication failed (status %d): %s", resp.StatusCode, string(body))
	}

	// K10 doesn't use OAuth - create a synthetic token from the password
	// The password itself is the API token
	return &models.TokenResponse{
		AccessToken: password, // K10 API tokens are static
		TokenType:   "Basic",
		ExpiresIn:   86400 * 365, // 1 year - K10 tokens don't expire
	}, nil
}

func (a *Authenticator) refreshK10(server *models.Server, refreshToken string) (*models.TokenResponse, error) {
	// K10 tokens don't expire in the traditional OAuth sense
	// Just return the existing token
	return &models.TokenResponse{
		AccessToken: refreshToken,
		TokenType:   "Basic",
		ExpiresIn:   86400 * 365,
	}, nil
}

// ===== Veeam ONE Authentication =====

func (a *Authenticator) authenticateVONE(server *models.Server, password string, username string) (*models.TokenResponse, error) {
	authURL := strings.TrimSuffix(server.APIURL, "/") + AuthEndpoints[ProductVONE]

	// Veeam ONE uses multipart form-data with ui_login=true for web UI tokens
	boundary := "----WebKitFormBoundary7MA4YWxkTrZu0gW"
	bodyParts := []string{
		"--" + boundary,
		"Content-Disposition: form-data; name=\"grant_type\"",
		"",
		"password",
		"--" + boundary,
		"Content-Disposition: form-data; name=\"username\"",
		"",
		username,
		"--" + boundary,
		"Content-Disposition: form-data; name=\"password\"",
		"",
		password,
		"--" + boundary,
		"Content-Disposition: form-data; name=\"ui_login\"",
		"",
		"true",
		"--" + boundary + "--",
		"",
	}
	body := strings.Join(bodyParts, "\r\n")

	req, err := http.NewRequest("POST", authURL, strings.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "multipart/form-data; boundary="+boundary)
	req.Header.Set("Accept", "application/json")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("authentication failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int    `json:"expires_in"`
		RefreshToken string `json:"refresh_token,omitempty"`
	}

	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	return &models.TokenResponse{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		TokenType:    tokenResp.TokenType,
		ExpiresIn:    tokenResp.ExpiresIn,
	}, nil
}

func (a *Authenticator) refreshVONE(server *models.Server, refreshToken string) (*models.TokenResponse, error) {
	authURL := strings.TrimSuffix(server.APIURL, "/") + AuthEndpoints[ProductVONE]

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequest("POST", authURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")

	client := a.getClientForServer(server)
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token refresh failed (status %d): %s", resp.StatusCode, string(respBody))
	}

	var tokenResp struct {
		AccessToken  string `json:"access_token"`
		TokenType    string `json:"token_type"`
		ExpiresIn    int    `json:"expires_in"`
		RefreshToken string `json:"refresh_token,omitempty"`
	}

	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	return &models.TokenResponse{
		AccessToken:  tokenResp.AccessToken,
		RefreshToken: tokenResp.RefreshToken,
		TokenType:    tokenResp.TokenType,
		ExpiresIn:    tokenResp.ExpiresIn,
	}, nil
}
