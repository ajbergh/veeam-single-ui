package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
	"github.com/google/uuid"
)

// SaveToken saves or updates a token for a server
func (db *DB) SaveToken(token *models.Token) error {
	if token.ID == "" {
		token.ID = uuid.New().String()
	}
	token.CreatedAt = time.Now()

	// Delete existing token for this server
	_, err := db.conn.Exec("DELETE FROM tokens WHERE server_id = ?", token.ServerID)
	if err != nil {
		return fmt.Errorf("failed to delete existing token: %w", err)
	}

	_, err = db.conn.Exec(`
		INSERT INTO tokens (id, server_id, access_token_encrypted, refresh_token_encrypted, token_type, expires_at, issued_at, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, token.ID, token.ServerID, token.AccessTokenEncrypted, token.RefreshTokenEncrypted, token.TokenType, token.ExpiresAt, token.IssuedAt, token.CreatedAt)
	if err != nil {
		return fmt.Errorf("failed to save token: %w", err)
	}
	return nil
}

// GetToken retrieves the token for a server
func (db *DB) GetToken(serverID string) (*models.Token, error) {
	var token models.Token
	err := db.conn.QueryRow(`
		SELECT id, server_id, access_token_encrypted, refresh_token_encrypted, token_type, expires_at, issued_at, created_at
		FROM tokens WHERE server_id = ?
	`, serverID).Scan(
		&token.ID, &token.ServerID, &token.AccessTokenEncrypted, &token.RefreshTokenEncrypted,
		&token.TokenType, &token.ExpiresAt, &token.IssuedAt, &token.CreatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get token: %w", err)
	}
	return &token, nil
}

// DeleteToken deletes the token for a server
func (db *DB) DeleteToken(serverID string) error {
	_, err := db.conn.Exec("DELETE FROM tokens WHERE server_id = ?", serverID)
	if err != nil {
		return fmt.Errorf("failed to delete token: %w", err)
	}
	return nil
}

// GetTokenStatus returns the status of a token for a server
func (db *DB) GetTokenStatus(serverID string) (*models.TokenStatus, error) {
	token, err := db.GetToken(serverID)
	if err != nil {
		return nil, err
	}

	status := &models.TokenStatus{
		ServerID: serverID,
		HasToken: token != nil,
	}

	if token != nil {
		status.TokenType = token.TokenType
		status.ExpiresAt = &token.ExpiresAt
		status.IsExpired = time.Now().After(token.ExpiresAt)
		if !status.IsExpired {
			status.ExpiresIn = int64(time.Until(token.ExpiresAt).Seconds())
		}
	}

	return status, nil
}

// DeleteExpiredTokens removes all expired tokens
func (db *DB) DeleteExpiredTokens() (int64, error) {
	result, err := db.conn.Exec("DELETE FROM tokens WHERE expires_at < ?", time.Now())
	if err != nil {
		return 0, fmt.Errorf("failed to delete expired tokens: %w", err)
	}
	return result.RowsAffected()
}
