package database

import (
	"fmt"
	"time"

	"github.com/ajbergh/veeam-single-ui/backend/internal/database/models"
)

// CreateAuditLog creates a new audit log entry
func (db *DB) CreateAuditLog(log *models.AuditLog) error {
	if log.Timestamp.IsZero() {
		log.Timestamp = time.Now()
	}

	_, err := db.conn.Exec(`
		INSERT INTO audit_log (timestamp, action, server_id, endpoint, method, status_code, duration_ms, error_message, client_ip, user_agent)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, log.Timestamp, log.Action, log.ServerID, log.Endpoint, log.Method, log.StatusCode, log.DurationMS, log.ErrorMessage, log.ClientIP, log.UserAgent)
	if err != nil {
		return fmt.Errorf("failed to create audit log: %w", err)
	}
	return nil
}

// ListAuditLogs retrieves audit logs with optional filters
func (db *DB) ListAuditLogs(opts *AuditLogOptions) ([]*models.AuditLog, error) {
	if opts == nil {
		opts = &AuditLogOptions{Limit: 100}
	}
	if opts.Limit <= 0 || opts.Limit > 1000 {
		opts.Limit = 100
	}

	query := "SELECT id, timestamp, action, server_id, endpoint, method, status_code, duration_ms, error_message, client_ip, user_agent FROM audit_log WHERE 1=1"
	args := []interface{}{}

	if opts.ServerID != nil {
		query += " AND server_id = ?"
		args = append(args, *opts.ServerID)
	}
	if opts.Action != nil {
		query += " AND action = ?"
		args = append(args, *opts.Action)
	}
	if opts.Since != nil {
		query += " AND timestamp >= ?"
		args = append(args, *opts.Since)
	}
	if opts.Until != nil {
		query += " AND timestamp <= ?"
		args = append(args, *opts.Until)
	}

	query += " ORDER BY timestamp DESC LIMIT ?"
	args = append(args, opts.Limit)

	if opts.Offset > 0 {
		query += " OFFSET ?"
		args = append(args, opts.Offset)
	}

	rows, err := db.conn.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to list audit logs: %w", err)
	}
	defer rows.Close()

	var logs []*models.AuditLog
	for rows.Next() {
		var log models.AuditLog
		err := rows.Scan(
			&log.ID, &log.Timestamp, &log.Action, &log.ServerID, &log.Endpoint,
			&log.Method, &log.StatusCode, &log.DurationMS, &log.ErrorMessage,
			&log.ClientIP, &log.UserAgent,
		)
		if err != nil {
			return nil, fmt.Errorf("failed to scan audit log: %w", err)
		}
		logs = append(logs, &log)
	}
	return logs, nil
}

// AuditLogOptions contains options for listing audit logs
type AuditLogOptions struct {
	ServerID *string
	Action   *string
	Since    *time.Time
	Until    *time.Time
	Limit    int
	Offset   int
}

// DeleteOldAuditLogs removes audit logs older than the specified duration
func (db *DB) DeleteOldAuditLogs(retention time.Duration) (int64, error) {
	cutoff := time.Now().Add(-retention)
	result, err := db.conn.Exec("DELETE FROM audit_log WHERE timestamp < ?", cutoff)
	if err != nil {
		return 0, fmt.Errorf("failed to delete old audit logs: %w", err)
	}
	return result.RowsAffected()
}

// CountAuditLogs returns the number of audit log entries
func (db *DB) CountAuditLogs() (int, error) {
	var count int
	err := db.conn.QueryRow("SELECT COUNT(*) FROM audit_log").Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("failed to count audit logs: %w", err)
	}
	return count, nil
}
