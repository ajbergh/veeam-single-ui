package models

import "time"

// ProductType represents the type of Veeam product
type ProductType string

const (
	ProductTypeVBR   ProductType = "vbr"
	ProductTypeVRO   ProductType = "vro"
	ProductTypeVBM   ProductType = "vbm"
	ProductTypeVB365 ProductType = "vb365"
	ProductTypeK10   ProductType = "k10"
)

// Server represents a Veeam server connection
type Server struct {
	ID                string      `json:"id"`
	Name              string      `json:"name"`
	ProductType       ProductType `json:"productType"`
	APIURL            string      `json:"apiUrl"`
	UsernameEncrypted []byte      `json:"-"` // Never expose encrypted data in JSON
	PasswordEncrypted []byte      `json:"-"`
	VerifySSL         bool        `json:"verifySSL"`
	IsDefault         bool        `json:"isDefault"`
	CreatedAt         time.Time   `json:"createdAt"`
	UpdatedAt         time.Time   `json:"updatedAt"`
}

// ServerInput represents the input for creating/updating a server
type ServerInput struct {
	Name        string      `json:"name"`
	ProductType ProductType `json:"productType"`
	APIURL      string      `json:"apiUrl"`
	Username    string      `json:"username"`
	Password    string      `json:"password"`
	VerifySSL   *bool       `json:"verifySSL,omitempty"` // Pointer to distinguish unset from false
	IsDefault   *bool       `json:"isDefault,omitempty"`
}

// ServerResponse represents the API response for a server (with redacted credentials)
type ServerResponse struct {
	ID          string      `json:"id"`
	Name        string      `json:"name"`
	ProductType ProductType `json:"productType"`
	APIURL      string      `json:"apiUrl"`
	Username    string      `json:"username"` // Returned but not password
	VerifySSL   bool        `json:"verifySSL"`
	IsDefault   bool        `json:"isDefault"`
	CreatedAt   time.Time   `json:"createdAt"`
	UpdatedAt   time.Time   `json:"updatedAt"`
	TokenStatus string      `json:"tokenStatus,omitempty"` // "valid", "expired", "none"
}

// Validate validates the server input
func (s *ServerInput) Validate() error {
	if s.Name == "" {
		return &ValidationError{Field: "name", Message: "name is required"}
	}
	if s.ProductType == "" {
		return &ValidationError{Field: "productType", Message: "productType is required"}
	}
	if !s.ProductType.IsValid() {
		return &ValidationError{Field: "productType", Message: "invalid productType"}
	}
	if s.APIURL == "" {
		return &ValidationError{Field: "apiUrl", Message: "apiUrl is required"}
	}
	if s.Username == "" {
		return &ValidationError{Field: "username", Message: "username is required"}
	}
	if s.Password == "" {
		return &ValidationError{Field: "password", Message: "password is required"}
	}
	return nil
}

// IsValid checks if the product type is valid
func (p ProductType) IsValid() bool {
	switch p {
	case ProductTypeVBR, ProductTypeVRO, ProductTypeVBM, ProductTypeVB365, ProductTypeK10:
		return true
	default:
		return false
	}
}

// ValidationError represents a validation error
type ValidationError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e *ValidationError) Error() string {
	return e.Message
}
