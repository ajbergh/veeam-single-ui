package database

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
	"github.com/google/uuid"
)

// CreateServer creates a new server entry
func (db *DB) CreateServer(server *models.Server) error {
	if server.ID == "" {
		server.ID = uuid.New().String()
	}
	now := time.Now()
	server.CreatedAt = now
	server.UpdatedAt = now

	// If this is set as default, unset other defaults for this product type
	if server.IsDefault {
		_, err := db.conn.Exec(
			"UPDATE servers SET is_default = 0 WHERE product_type = ? AND is_default = 1",
			server.ProductType,
		)
		if err != nil {
			return fmt.Errorf("failed to unset default: %w", err)
		}
	}

	_, err := db.conn.Exec(`
		INSERT INTO servers (id, name, product_type, api_url, username_encrypted, password_encrypted, verify_ssl, is_default, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, server.ID, server.Name, server.ProductType, server.APIURL, server.UsernameEncrypted, server.PasswordEncrypted, server.VerifySSL, server.IsDefault, server.CreatedAt, server.UpdatedAt)
	if err != nil {
		return fmt.Errorf("failed to create server: %w", err)
	}
	return nil
}

// GetServer retrieves a server by ID
func (db *DB) GetServer(id string) (*models.Server, error) {
	var server models.Server
	err := db.conn.QueryRow(`
		SELECT id, name, product_type, api_url, username_encrypted, password_encrypted, verify_ssl, is_default, created_at, updated_at
		FROM servers WHERE id = ?
	`, id).Scan(
		&server.ID, &server.Name, &server.ProductType, &server.APIURL,
		&server.UsernameEncrypted, &server.PasswordEncrypted,
		&server.VerifySSL, &server.IsDefault, &server.CreatedAt, &server.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get server: %w", err)
	}
	return &server, nil
}

// GetDefaultServer retrieves the default server for a product type
func (db *DB) GetDefaultServer(productType models.ProductType) (*models.Server, error) {
	var server models.Server
	err := db.conn.QueryRow(`
		SELECT id, name, product_type, api_url, username_encrypted, password_encrypted, verify_ssl, is_default, created_at, updated_at
		FROM servers WHERE product_type = ? AND is_default = 1
	`, productType).Scan(
		&server.ID, &server.Name, &server.ProductType, &server.APIURL,
		&server.UsernameEncrypted, &server.PasswordEncrypted,
		&server.VerifySSL, &server.IsDefault, &server.CreatedAt, &server.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get default server: %w", err)
	}
	return &server, nil
}

// ListServers retrieves all servers, optionally filtered by product type
func (db *DB) ListServers(productType *models.ProductType) ([]*models.Server, error) {
	var rows *sql.Rows
	var err error

	if productType != nil {
		rows, err = db.conn.Query(`
			SELECT id, name, product_type, api_url, username_encrypted, password_encrypted, verify_ssl, is_default, created_at, updated_at
			FROM servers WHERE product_type = ? ORDER BY name
		`, *productType)
	} else {
		rows, err = db.conn.Query(`
			SELECT id, name, product_type, api_url, username_encrypted, password_encrypted, verify_ssl, is_default, created_at, updated_at
			FROM servers ORDER BY product_type, name
		`)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to list servers: %w", err)
	}
	defer rows.Close()

	var servers []*models.Server
	for rows.Next() {
		var server models.Server
		err := rows.Scan(
			&server.ID, &server.Name, &server.ProductType, &server.APIURL,
			&server.UsernameEncrypted, &server.PasswordEncrypted,
			&server.VerifySSL, &server.IsDefault, &server.CreatedAt, &server.UpdatedAt,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan server: %w", err)
		}
		servers = append(servers, &server)
	}
	return servers, nil
}

// UpdateServer updates an existing server
func (db *DB) UpdateServer(server *models.Server) error {
	server.UpdatedAt = time.Now()

	// If this is set as default, unset other defaults for this product type
	if server.IsDefault {
		_, err := db.conn.Exec(
			"UPDATE servers SET is_default = 0 WHERE product_type = ? AND is_default = 1 AND id != ?",
			server.ProductType, server.ID,
		)
		if err != nil {
			return fmt.Errorf("failed to unset default: %w", err)
		}
	}

	result, err := db.conn.Exec(`
		UPDATE servers SET name = ?, product_type = ?, api_url = ?, username_encrypted = ?, password_encrypted = ?, verify_ssl = ?, is_default = ?, updated_at = ?
		WHERE id = ?
	`, server.Name, server.ProductType, server.APIURL, server.UsernameEncrypted, server.PasswordEncrypted, server.VerifySSL, server.IsDefault, server.UpdatedAt, server.ID)
	if err != nil {
		return fmt.Errorf("failed to update server: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("server not found: %s", server.ID)
	}
	return nil
}

// DeleteServer deletes a server by ID
func (db *DB) DeleteServer(id string) error {
	result, err := db.conn.Exec("DELETE FROM servers WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete server: %w", err)
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return fmt.Errorf("server not found: %s", id)
	}
	return nil
}

// CountServers returns the number of servers, optionally by product type
func (db *DB) CountServers(productType *models.ProductType) (int, error) {
	var count int
	var err error

	if productType != nil {
		err = db.conn.QueryRow("SELECT COUNT(*) FROM servers WHERE product_type = ?", *productType).Scan(&count)
	} else {
		err = db.conn.QueryRow("SELECT COUNT(*) FROM servers").Scan(&count)
	}
	if err != nil {
		return 0, fmt.Errorf("failed to count servers: %w", err)
	}
	return count, nil
}
