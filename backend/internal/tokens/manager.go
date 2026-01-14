/*
Package tokens provides token lifecycle management for Veeam API authentication.

This file implements the token Manager which handles:
  - OAuth2 authentication for all Veeam product types (VBR, VRO, VBM, VB365, K10)
  - Encrypted token persistence in SQLite database
  - Automatic token refresh before expiry
  - Thread-safe token operations with mutex protection

Token Lifecycle:
 1. AuthenticateServer: Initial authentication, stores encrypted token
 2. GetToken: Returns valid token, refreshes if expiring soon
 3. RefreshToken: Uses refresh token to obtain new access token
 4. LogoutServer: Invalidates token on Veeam server and removes from database

Auto-Refresh:
  - Background goroutine checks tokens every 2 minutes
  - Refreshes tokens 5 minutes before expiry (RefreshThreshold)
  - Logs failures but continues running

Key Types:
  - Manager: Main token manager with database and vault access
  - Authenticator: Interface for product-specific authentication
  - TokenStatus: Current state of a server's token

Key Functions:
  - NewManager: Creates token manager with dependencies
  - AuthenticateServer: Performs initial OAuth authentication
  - GetToken: Retrieves valid access token (auto-refreshes if needed)
  - StartAutoRefresh: Starts background refresh goroutine
  - Stop: Gracefully stops auto-refresh
*/
package tokens

import (
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/crypto"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database"
	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
)

// RefreshThreshold is the time before expiry when we should refresh the token
const RefreshThreshold = 5 * time.Minute

// Manager handles token lifecycle operations
type Manager struct {
	db            *database.DB
	vault         *crypto.Vault
	mu            sync.RWMutex
	authenticator Authenticator
	stopChan      chan struct{}
	wg            sync.WaitGroup
}

// Authenticator interface for product-specific authentication
type Authenticator interface {
	// Authenticate performs initial authentication and returns token response
	Authenticate(server *models.Server, username, password string) (*models.TokenResponse, error)

	// Refresh uses refresh token to get new access token
	Refresh(server *models.Server, refreshToken string) (*models.TokenResponse, error)

	// Logout invalidates the token on the server
	Logout(server *models.Server, accessToken string) error
}

// NewManager creates a new token manager with database, encryption vault, and authenticator.
//
// Parameters:
//   - db: Database connection for token persistence
//   - vault: Encryption vault for secure token storage
//   - auth: Authenticator implementation for product-specific OAuth flows
//
// Returns:
//   - *Manager: Token manager ready for authentication operations
func NewManager(db *database.DB, vault *crypto.Vault, auth Authenticator) *Manager {
	return &Manager{
		db:            db,
		vault:         vault,
		authenticator: auth,
		stopChan:      make(chan struct{}),
	}
}

// AuthenticateServer performs OAuth authentication for a server and stores the encrypted token.
//
// This function:
//  1. Retrieves server configuration from database
//  2. Decrypts stored username and password
//  3. Calls product-specific authentication endpoint
//  4. Encrypts and stores the received tokens
//  5. Logs successful authentication to audit log
//
// Parameters:
//   - serverID: UUID of the server to authenticate
//
// Returns:
//   - *models.TokenStatus: Current token status after authentication
//   - error: Authentication or storage error
//
// Thread Safety: This method is protected by a mutex lock.
func (m *Manager) AuthenticateServer(serverID string) (*models.TokenStatus, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Get server details
	server, err := m.db.GetServer(serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}
	if server == nil {
		return nil, fmt.Errorf("server not found: %s", serverID)
	}

	// Decrypt the username
	username, err := m.vault.DecryptBytes(server.UsernameEncrypted)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt username: %w", err)
	}

	// Decrypt the password
	password, err := m.vault.DecryptBytes(server.PasswordEncrypted)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt password: %w", err)
	}

	// Perform authentication
	tokenResp, err := m.authenticator.Authenticate(server, string(username), string(password))
	if err != nil {
		return nil, fmt.Errorf("authentication failed: %w", err)
	}

	// Store the token
	if err := m.storeToken(serverID, tokenResp); err != nil {
		return nil, fmt.Errorf("failed to store token: %w", err)
	}

	// Log successful auth
	m.db.CreateAuditLog(&models.AuditLog{
		Action:   models.AuditActionAuthSuccess,
		ServerID: &serverID,
	})

	return m.db.GetTokenStatus(serverID)
}

// storeToken encrypts and stores a token response in the database.
func (m *Manager) storeToken(serverID string, tokenResp *models.TokenResponse) error {
	// Encrypt access token
	encryptedAccess, err := m.vault.EncryptBytes([]byte(tokenResp.AccessToken))
	if err != nil {
		return fmt.Errorf("failed to encrypt access token: %w", err)
	}

	// Encrypt refresh token if present
	var encryptedRefresh []byte
	if tokenResp.RefreshToken != "" {
		encryptedRefresh, err = m.vault.EncryptBytes([]byte(tokenResp.RefreshToken))
		if err != nil {
			return fmt.Errorf("failed to encrypt refresh token: %w", err)
		}
	}

	// Calculate expiry
	expiresAt := time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	token := &models.Token{
		ServerID:              serverID,
		AccessTokenEncrypted:  encryptedAccess,
		RefreshTokenEncrypted: encryptedRefresh,
		TokenType:             tokenResp.TokenType,
		ExpiresAt:             expiresAt,
		IssuedAt:              time.Now(),
	}

	return m.db.SaveToken(token)
}

// GetAccessToken retrieves a valid access token for a server, refreshing if needed
func (m *Manager) GetAccessToken(serverID string) (string, error) {
	m.mu.RLock()
	token, err := m.db.GetToken(serverID)
	m.mu.RUnlock()

	if err != nil {
		return "", fmt.Errorf("failed to get token: %w", err)
	}

	// No token exists
	if token == nil {
		return "", fmt.Errorf("no token for server %s - authentication required", serverID)
	}

	// Token is still valid
	if token.IsValid() && !token.IsExpiringSoon(RefreshThreshold) {
		accessToken, err := m.vault.DecryptBytes(token.AccessTokenEncrypted)
		if err != nil {
			return "", fmt.Errorf("failed to decrypt access token: %w", err)
		}
		return string(accessToken), nil
	}

	// Token is expired or expiring soon - try to refresh
	if len(token.RefreshTokenEncrypted) > 0 {
		m.mu.Lock()
		defer m.mu.Unlock()

		// Double-check after acquiring write lock
		token, err = m.db.GetToken(serverID)
		if err != nil {
			return "", err
		}
		if token.IsValid() && !token.IsExpiringSoon(RefreshThreshold) {
			accessToken, err := m.vault.DecryptBytes(token.AccessTokenEncrypted)
			if err != nil {
				return "", err
			}
			return string(accessToken), nil
		}

		// Refresh the token
		refreshToken, err := m.vault.DecryptBytes(token.RefreshTokenEncrypted)
		if err != nil {
			return "", fmt.Errorf("failed to decrypt refresh token: %w", err)
		}

		server, err := m.db.GetServer(serverID)
		if err != nil {
			return "", err
		}

		tokenResp, err := m.authenticator.Refresh(server, string(refreshToken))
		if err != nil {
			// Refresh failed - need re-authentication
			return "", fmt.Errorf("token refresh failed, re-authentication required: %w", err)
		}

		if err := m.storeToken(serverID, tokenResp); err != nil {
			return "", err
		}

		return tokenResp.AccessToken, nil
	}

	// No refresh token, need full re-authentication
	return "", fmt.Errorf("token expired and no refresh token available - authentication required")
}

// GetTokenStatus returns the status of a token
func (m *Manager) GetTokenStatus(serverID string) (*models.TokenStatus, error) {
	return m.db.GetTokenStatus(serverID)
}

// LogoutServer invalidates the token for a server
func (m *Manager) LogoutServer(serverID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	token, err := m.db.GetToken(serverID)
	if err != nil {
		return err
	}
	if token == nil {
		return nil // No token to invalidate
	}

	// Try to invalidate on the server
	if m.authenticator != nil {
		accessToken, err := m.vault.DecryptBytes(token.AccessTokenEncrypted)
		if err == nil {
			server, _ := m.db.GetServer(serverID)
			if server != nil {
				_ = m.authenticator.Logout(server, string(accessToken))
			}
		}
	}

	// Delete the token
	return m.db.DeleteToken(serverID)
}

// StartAutoRefresh starts a background goroutine that refreshes tokens before they expire
func (m *Manager) StartAutoRefresh(interval time.Duration) {
	m.wg.Add(1)
	go func() {
		defer m.wg.Done()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-m.stopChan:
				log.Println("Token auto-refresh stopped")
				return
			case <-ticker.C:
				m.refreshExpiringTokens()
			}
		}
	}()
	log.Printf("Token auto-refresh started (interval: %v)", interval)
}

// Stop stops the auto-refresh goroutine
func (m *Manager) Stop() {
	close(m.stopChan)
	m.wg.Wait()
}

// refreshExpiringTokens checks all tokens and refreshes those expiring soon
func (m *Manager) refreshExpiringTokens() {
	servers, err := m.db.ListServers(nil)
	if err != nil {
		log.Printf("Error listing servers for token refresh: %v", err)
		return
	}

	for _, server := range servers {
		token, err := m.db.GetToken(server.ID)
		if err != nil {
			log.Printf("Error getting token for server %s: %v", server.ID, err)
			continue
		}
		if token == nil {
			continue
		}

		// Check if token is expiring soon
		if token.IsExpiringSoon(RefreshThreshold) && len(token.RefreshTokenEncrypted) > 0 {
			log.Printf("Token for server %s expiring soon, refreshing...", server.Name)

			_, err := m.GetAccessToken(server.ID) // This will trigger refresh
			if err != nil {
				log.Printf("Failed to refresh token for server %s: %v", server.Name, err)

				// Log the failure
				errMsg := err.Error()
				m.db.CreateAuditLog(&models.AuditLog{
					Action:       models.AuditActionTokenRefreshFail,
					ServerID:     &server.ID,
					ErrorMessage: &errMsg,
				})
			} else {
				log.Printf("Token refreshed for server %s", server.Name)

				m.db.CreateAuditLog(&models.AuditLog{
					Action:   models.AuditActionTokenRefresh,
					ServerID: &server.ID,
				})
			}
		}
	}
}

// CleanupExpiredTokens removes all expired tokens from the database
func (m *Manager) CleanupExpiredTokens() (int64, error) {
	count, err := m.db.DeleteExpiredTokens()
	if err != nil {
		return 0, err
	}
	if count > 0 {
		log.Printf("Cleaned up %d expired tokens", count)
	}
	return count, nil
}

// AuthenticateWithCredentials tests authentication with provided credentials
// This is used for connection testing without storing the server
func (m *Manager) AuthenticateWithCredentials(productType models.ProductType, apiURL, username, password string, verifySSL bool) error {
	// Create a temporary server object for authentication
	tempServer := &models.Server{
		ProductType: productType,
		APIURL:      apiURL,
		VerifySSL:   verifySSL,
	}

	// Attempt authentication
	_, err := m.authenticator.Authenticate(tempServer, username, password)
	if err != nil {
		return err
	}

	return nil
}
