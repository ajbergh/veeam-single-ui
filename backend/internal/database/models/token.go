package models

import "time"

// Token represents an encrypted API token
type Token struct {
	ID                    string    `json:"id"`
	ServerID              string    `json:"serverId"`
	AccessTokenEncrypted  []byte    `json:"-"` // Never expose
	RefreshTokenEncrypted []byte    `json:"-"`
	TokenType             string    `json:"tokenType"`
	ExpiresAt             time.Time `json:"expiresAt"`
	IssuedAt              time.Time `json:"issuedAt"`
	CreatedAt             time.Time `json:"createdAt"`
}

// TokenStatus represents the status of a token for API responses
type TokenStatus struct {
	ServerID  string     `json:"serverId"`
	HasToken  bool       `json:"hasToken"`
	TokenType string     `json:"tokenType,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	IsExpired bool       `json:"isExpired"`
	ExpiresIn int64      `json:"expiresIn,omitempty"` // Seconds until expiry
}

// IsValid returns true if the token is valid and not expired
func (t *Token) IsValid() bool {
	return t != nil && time.Now().Before(t.ExpiresAt)
}

// IsExpiringSoon returns true if the token expires within the given duration
func (t *Token) IsExpiringSoon(buffer time.Duration) bool {
	return t != nil && time.Now().Add(buffer).After(t.ExpiresAt)
}

// TokenResponse represents the OAuth token response from Veeam APIs
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	RefreshToken string `json:"refresh_token,omitempty"`
	ExpiresIn    int    `json:"expires_in"` // Seconds
	Issued       string `json:".issued,omitempty"`
	Expires      string `json:".expires,omitempty"`
	Username     string `json:"username,omitempty"`
}
