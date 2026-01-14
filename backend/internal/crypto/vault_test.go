package crypto

import (
	"encoding/base64"
	"testing"
)

func TestVaultEncryptDecrypt(t *testing.T) {
	salt := []byte("test-salt-for-unit-tests")
	vault := NewVault("test-master-passphrase", salt)

	tests := []struct {
		name      string
		plaintext string
	}{
		{"simple string", "hello world"},
		{"password", "SuperSecretP@ssw0rd!"},
		{"url", "https://vbr.example.com:9419"},
		{"unicode", "用户名密码"},
		{"long string", "This is a very long string that contains multiple sentences and special characters like @#$%^&*()_+{}|:<>?"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encrypted, err := vault.Encrypt(tt.plaintext)
			if err != nil {
				t.Fatalf("Encrypt failed: %v", err)
			}

			if len(encrypted) == 0 {
				t.Fatal("Encrypted data is empty")
			}

			// Ensure ciphertext is different from plaintext
			if string(encrypted) == tt.plaintext {
				t.Fatal("Ciphertext should not equal plaintext")
			}

			decrypted, err := vault.Decrypt(encrypted)
			if err != nil {
				t.Fatalf("Decrypt failed: %v", err)
			}

			if decrypted != tt.plaintext {
				t.Fatalf("Decrypted text does not match: got %q, want %q", decrypted, tt.plaintext)
			}
		})
	}
}

func TestVaultEncryptProducesDifferentCiphertext(t *testing.T) {
	salt := []byte("test-salt-for-unit-tests")
	vault := NewVault("test-master-passphrase", salt)

	plaintext := "same plaintext"

	encrypted1, err := vault.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("First encryption failed: %v", err)
	}

	encrypted2, err := vault.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Second encryption failed: %v", err)
	}

	// Due to random nonce, same plaintext should produce different ciphertext
	if string(encrypted1) == string(encrypted2) {
		t.Fatal("Same plaintext should produce different ciphertext (random nonce)")
	}

	// But both should decrypt to the same value
	decrypted1, _ := vault.Decrypt(encrypted1)
	decrypted2, _ := vault.Decrypt(encrypted2)

	if decrypted1 != decrypted2 {
		t.Fatal("Both ciphertexts should decrypt to the same plaintext")
	}
}

func TestVaultDifferentPassphrasesFail(t *testing.T) {
	salt := []byte("test-salt-for-unit-tests")
	vault1 := NewVault("passphrase-one", salt)
	vault2 := NewVault("passphrase-two", salt)

	plaintext := "secret data"

	encrypted, err := vault1.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encryption failed: %v", err)
	}

	// Decryption with different passphrase should fail
	_, err = vault2.Decrypt(encrypted)
	if err == nil {
		t.Fatal("Decryption with different passphrase should fail")
	}
}

func TestVaultDifferentSaltsFail(t *testing.T) {
	passphrase := "same-passphrase"
	vault1 := NewVault(passphrase, []byte("salt-one-sixteen"))
	vault2 := NewVault(passphrase, []byte("salt-two-sixteen"))

	plaintext := "secret data"

	encrypted, err := vault1.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encryption failed: %v", err)
	}

	// Decryption with different salt should fail
	_, err = vault2.Decrypt(encrypted)
	if err == nil {
		t.Fatal("Decryption with different salt should fail")
	}
}

func TestVaultEmptyInput(t *testing.T) {
	salt := []byte("test-salt-for-unit-tests")
	vault := NewVault("test-master-passphrase", salt)

	// Empty plaintext should fail
	_, err := vault.Encrypt("")
	if err == nil {
		t.Fatal("Encryption of empty string should fail")
	}

	// Empty ciphertext should fail
	_, err = vault.Decrypt([]byte{})
	if err == nil {
		t.Fatal("Decryption of empty ciphertext should fail")
	}

	// Nil ciphertext should fail
	_, err = vault.Decrypt(nil)
	if err == nil {
		t.Fatal("Decryption of nil ciphertext should fail")
	}
}

func TestVaultTamperedCiphertext(t *testing.T) {
	salt := []byte("test-salt-for-unit-tests")
	vault := NewVault("test-master-passphrase", salt)

	plaintext := "secret data"
	encrypted, err := vault.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encryption failed: %v", err)
	}

	// Tamper with ciphertext
	if len(encrypted) > 20 {
		encrypted[20] ^= 0xFF // Flip bits
	}

	// Decryption should fail due to authentication tag mismatch
	_, err = vault.Decrypt(encrypted)
	if err == nil {
		t.Fatal("Decryption of tampered ciphertext should fail")
	}
}

func TestVaultBytes(t *testing.T) {
	salt := []byte("test-salt-for-unit-tests")
	vault := NewVault("test-master-passphrase", salt)

	original := []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD}

	encrypted, err := vault.EncryptBytes(original)
	if err != nil {
		t.Fatalf("EncryptBytes failed: %v", err)
	}

	decrypted, err := vault.DecryptBytes(encrypted)
	if err != nil {
		t.Fatalf("DecryptBytes failed: %v", err)
	}

	if len(decrypted) != len(original) {
		t.Fatalf("Decrypted length mismatch: got %d, want %d", len(decrypted), len(original))
	}

	for i, b := range original {
		if decrypted[i] != b {
			t.Fatalf("Decrypted byte mismatch at %d: got %x, want %x", i, decrypted[i], b)
		}
	}
}

func TestGenerateSalt(t *testing.T) {
	// Valid length
	salt, err := GenerateSalt(32)
	if err != nil {
		t.Fatalf("GenerateSalt failed: %v", err)
	}
	if len(salt) != 32 {
		t.Fatalf("Salt length should be 32, got %d", len(salt))
	}

	// Two salts should be different
	salt2, _ := GenerateSalt(32)
	if string(salt) == string(salt2) {
		t.Fatal("Two generated salts should not be identical")
	}

	// Invalid length
	_, err = GenerateSalt(8)
	if err == nil {
		t.Fatal("GenerateSalt with length < 16 should fail")
	}
}

func BenchmarkEncrypt(b *testing.B) {
	salt := []byte("benchmark-salt-value")
	vault := NewVault("benchmark-passphrase", salt)
	plaintext := "benchmark test password data"

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = vault.Encrypt(plaintext)
	}
}

func BenchmarkDecrypt(b *testing.B) {
	salt := []byte("benchmark-salt-value")
	vault := NewVault("benchmark-passphrase", salt)
	plaintext := "benchmark test password data"
	encrypted, _ := vault.Encrypt(plaintext)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = vault.Decrypt(encrypted)
	}
}

// Example of base64 encoding for storage
func TestBase64Storage(t *testing.T) {
	salt := []byte("test-salt-for-unit-tests")
	vault := NewVault("test-master-passphrase", salt)

	plaintext := "my-secret-password"

	encrypted, err := vault.Encrypt(plaintext)
	if err != nil {
		t.Fatalf("Encryption failed: %v", err)
	}

	// Encode for storage (e.g., in database or JSON)
	encoded := base64.StdEncoding.EncodeToString(encrypted)

	// Decode from storage
	decoded, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("Base64 decode failed: %v", err)
	}

	// Decrypt
	decrypted, err := vault.Decrypt(decoded)
	if err != nil {
		t.Fatalf("Decryption failed: %v", err)
	}

	if decrypted != plaintext {
		t.Fatalf("Round-trip failed: got %q, want %q", decrypted, plaintext)
	}
}
