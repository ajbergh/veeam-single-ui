package models

import "time"

// AuditLog represents an audit log entry
type AuditLog struct {
	ID           int64     `json:"id"`
	Timestamp    time.Time `json:"timestamp"`
	Action       string    `json:"action"`
	ServerID     *string   `json:"serverId,omitempty"`
	Endpoint     *string   `json:"endpoint,omitempty"`
	Method       *string   `json:"method,omitempty"`
	StatusCode   *int      `json:"statusCode,omitempty"`
	DurationMS   *int      `json:"durationMs,omitempty"`
	ErrorMessage *string   `json:"errorMessage,omitempty"`
	ClientIP     *string   `json:"clientIp,omitempty"`
	UserAgent    *string   `json:"userAgent,omitempty"`
}

// AuditAction constants
const (
	AuditActionServerCreate     = "server.create"
	AuditActionServerUpdate     = "server.update"
	AuditActionServerDelete     = "server.delete"
	AuditActionAuthSuccess      = "auth.success"
	AuditActionAuthFailure      = "auth.failure"
	AuditActionTokenRefresh     = "token.refresh"
	AuditActionTokenRefreshFail = "token.refresh.failure"
	AuditActionProxyRequest     = "proxy.request"
	AuditActionCacheHit         = "cache.hit"
	AuditActionCacheMiss        = "cache.miss"
	AuditActionCacheClear       = "cache.clear"
)
