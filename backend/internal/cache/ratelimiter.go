package cache

import (
	"sync"
	"time"
)

// RateLimits defines per-product rate limits
var RateLimits = map[string]RateLimit{
	"vbr":   {RequestsPerSecond: 10, BurstSize: 20}, // VBR: 10 req/sec, burst 20
	"vro":   {RequestsPerSecond: 10, BurstSize: 20}, // VRO: 10 req/sec, burst 20
	"vbm":   {RequestsPerSecond: 1, BurstSize: 1},   // VBM: 1 req/sec (strict)
	"vb365": {RequestsPerSecond: 1, BurstSize: 1},   // VB365: 1 req/sec (alias for VBM)
	"k10":   {RequestsPerSecond: 10, BurstSize: 20}, // K10: 10 req/sec, burst 20
}

// RateLimit defines the rate limit for a product
type RateLimit struct {
	RequestsPerSecond float64
	BurstSize         int
}

// RateLimiter implements a token bucket rate limiter
type RateLimiter struct {
	mu       sync.Mutex
	limiters map[string]*tokenBucket
}

// tokenBucket implements the token bucket algorithm
type tokenBucket struct {
	tokens         float64
	maxTokens      float64
	refillRate     float64 // tokens per second
	lastRefillTime time.Time
}

// NewRateLimiter creates a new rate limiter
func NewRateLimiter() *RateLimiter {
	return &RateLimiter{
		limiters: make(map[string]*tokenBucket),
	}
}

// Allow checks if a request should be allowed for the given server
func (rl *RateLimiter) Allow(serverID, productType string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	key := serverID + ":" + productType

	bucket, exists := rl.limiters[key]
	if !exists {
		limit, ok := RateLimits[productType]
		if !ok {
			// Unknown product type - use default limit
			limit = RateLimit{RequestsPerSecond: 10, BurstSize: 20}
		}

		bucket = &tokenBucket{
			tokens:         float64(limit.BurstSize),
			maxTokens:      float64(limit.BurstSize),
			refillRate:     limit.RequestsPerSecond,
			lastRefillTime: time.Now(),
		}
		rl.limiters[key] = bucket
	}

	return bucket.take()
}

// Wait blocks until a request is allowed
func (rl *RateLimiter) Wait(serverID, productType string) {
	for !rl.Allow(serverID, productType) {
		// Calculate wait time based on refill rate
		limit, ok := RateLimits[productType]
		if !ok {
			limit = RateLimit{RequestsPerSecond: 10, BurstSize: 20}
		}
		waitTime := time.Duration(1000/limit.RequestsPerSecond) * time.Millisecond
		time.Sleep(waitTime)
	}
}

// GetWaitTime returns the time to wait before the next request is allowed
func (rl *RateLimiter) GetWaitTime(serverID, productType string) time.Duration {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	key := serverID + ":" + productType

	bucket, exists := rl.limiters[key]
	if !exists {
		return 0 // No bucket yet, request allowed
	}

	bucket.refill()
	if bucket.tokens >= 1 {
		return 0
	}

	// Calculate time to get 1 token
	tokensNeeded := 1 - bucket.tokens
	return time.Duration(tokensNeeded/bucket.refillRate*1000) * time.Millisecond
}

// Reset resets the rate limiter for a specific server
func (rl *RateLimiter) Reset(serverID, productType string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	key := serverID + ":" + productType
	delete(rl.limiters, key)
}

// ResetAll resets all rate limiters
func (rl *RateLimiter) ResetAll() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	rl.limiters = make(map[string]*tokenBucket)
}

// take attempts to take a token from the bucket
func (tb *tokenBucket) take() bool {
	tb.refill()

	if tb.tokens >= 1 {
		tb.tokens--
		return true
	}
	return false
}

// refill adds tokens based on elapsed time
func (tb *tokenBucket) refill() {
	now := time.Now()
	elapsed := now.Sub(tb.lastRefillTime).Seconds()
	tb.lastRefillTime = now

	tb.tokens += elapsed * tb.refillRate
	if tb.tokens > tb.maxTokens {
		tb.tokens = tb.maxTokens
	}
}

// Stats returns the current token count
func (rl *RateLimiter) Stats() map[string]float64 {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	stats := make(map[string]float64)
	for key, bucket := range rl.limiters {
		bucket.refill()
		stats[key] = bucket.tokens
	}
	return stats
}
