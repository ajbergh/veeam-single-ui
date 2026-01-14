/*
Package crypto provides cryptographic utilities for secure credential and token storage.

This file implements the Vault, which provides AES-256-GCM authenticated encryption
with Argon2id key derivation for protecting sensitive data at rest.

Security Features:
  - AES-256-GCM authenticated encryption (confidentiality + integrity)
  - Argon2id key derivation (memory-hard, resistant to GPU/ASIC attacks)
  - Random nonce generation for each encryption operation
  - OWASP-recommended Argon2 parameters

Argon2id Parameters (OWASP recommendations):
  - Time cost: 3 iterations
  - Memory cost: 64 MB
  - Parallelism: 4 threads
  - Key length: 256 bits

Key Functions:
  - NewVault: Creates vault with derived key from master passphrase
  - Encrypt: Encrypts plaintext to nonce+ciphertext
  - Decrypt: Decrypts nonce+ciphertext back to plaintext

Usage:

	vault := crypto.NewVault(masterPassphrase, salt)
	encrypted, err := vault.Encrypt("sensitive data")
	decrypted, err := vault.Decrypt(encrypted)
*/
package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"io"

	"golang.org/x/crypto/argon2"
)

// Vault provides AES-256-GCM encryption with Argon2id key derivation
type Vault struct {
	key []byte
}

// Argon2id parameters (OWASP recommended for password hashing)
const (
	argonTime    = 3         // Number of iterations
	argonMemory  = 64 * 1024 // 64 MB memory
	argonThreads = 4         // Parallelism
	argonKeyLen  = 32        // 256-bit key
)

// NewVault creates a new vault with a key derived from the master passphrase
// using Argon2id (memory-hard key derivation function)
func NewVault(masterPassphrase string, salt []byte) *Vault {
	key := argon2.IDKey(
		[]byte(masterPassphrase),
		salt,
		argonTime,
		argonMemory,
		argonThreads,
		argonKeyLen,
	)
	return &Vault{key: key}
}

// Encrypt encrypts plaintext using AES-256-GCM
// Returns: nonce + ciphertext (nonce is prepended to ciphertext)
func (v *Vault) Encrypt(plaintext string) ([]byte, error) {
	if plaintext == "" {
		return nil, errors.New("plaintext cannot be empty")
	}

	block, err := aes.NewCipher(v.key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// Generate random nonce
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	// Seal appends the encrypted data to nonce
	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return ciphertext, nil
}

// Decrypt decrypts ciphertext using AES-256-GCM
// Expects: nonce + ciphertext (nonce prepended to ciphertext)
func (v *Vault) Decrypt(ciphertext []byte) (string, error) {
	if len(ciphertext) == 0 {
		return "", errors.New("ciphertext cannot be empty")
	}

	block, err := aes.NewCipher(v.key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	nonce, encryptedData := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, encryptedData, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

// EncryptBytes encrypts byte data using AES-256-GCM
func (v *Vault) EncryptBytes(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("data cannot be empty")
	}

	block, err := aes.NewCipher(v.key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, err
	}

	ciphertext := gcm.Seal(nonce, nonce, data, nil)
	return ciphertext, nil
}

// DecryptBytes decrypts byte data using AES-256-GCM
func (v *Vault) DecryptBytes(ciphertext []byte) ([]byte, error) {
	if len(ciphertext) == 0 {
		return nil, errors.New("ciphertext cannot be empty")
	}

	block, err := aes.NewCipher(v.key)
	if err != nil {
		return nil, err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return nil, errors.New("ciphertext too short")
	}

	nonce, encryptedData := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, encryptedData, nil)
	if err != nil {
		return nil, err
	}

	return plaintext, nil
}

// GenerateSalt generates a cryptographically secure random salt
func GenerateSalt(length int) ([]byte, error) {
	if length < 16 {
		return nil, errors.New("salt length must be at least 16 bytes")
	}

	salt := make([]byte, length)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}

	return salt, nil
}
