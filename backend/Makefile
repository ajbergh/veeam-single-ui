.PHONY: all build run test clean lint fmt tidy

# Variables
BINARY_NAME=veeam-backend
ifeq ($(OS),Windows_NT)
	BINARY_EXT=.exe
else
	BINARY_EXT=
endif

# Go commands
GO=go
GOFLAGS=-v

# Default target
all: build

# Build the binary
build:
	CGO_ENABLED=1 $(GO) build $(GOFLAGS) -o bin/$(BINARY_NAME)$(BINARY_EXT) ./cmd/server

# Build for production (optimized)
build-prod:
	CGO_ENABLED=1 $(GO) build -ldflags="-s -w" -o bin/$(BINARY_NAME)$(BINARY_EXT) ./cmd/server

# Run the server locally
run:
	$(GO) run ./cmd/server

# Run with hot reload (requires air: go install github.com/cosmtrek/air@latest)
dev:
	@if command -v air > /dev/null; then \
		air; \
	else \
		echo "Air not installed. Run: go install github.com/cosmtrek/air@latest"; \
		echo "Falling back to regular run..."; \
		$(GO) run ./cmd/server; \
	fi

# Run tests
test:
	$(GO) test -v ./...

# Run tests with coverage
test-coverage:
	$(GO) test -v -coverprofile=coverage.out ./...
	$(GO) tool cover -html=coverage.out -o coverage.html
	@echo "Coverage report: coverage.html"

# Run benchmarks
bench:
	$(GO) test -bench=. -benchmem ./...

# Lint the code (requires golangci-lint)
lint:
	@if command -v golangci-lint > /dev/null; then \
		golangci-lint run; \
	else \
		echo "golangci-lint not installed. Run: go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest"; \
	fi

# Format code
fmt:
	$(GO) fmt ./...

# Tidy modules
tidy:
	$(GO) mod tidy

# Download dependencies
deps:
	$(GO) mod download

# Clean build artifacts
clean:
	rm -rf bin/
	rm -f coverage.out coverage.html

# Generate random salt (for initial setup)
generate-salt:
	@echo "Generated salt (base64):"
	@openssl rand -base64 32

# Generate random API key
generate-api-key:
	@echo "Generated API key:"
	@openssl rand -hex 32

# Create .env file from template
init-env:
	@if [ ! -f .env ]; then \
		echo "Creating .env file..."; \
		echo "MASTER_PASSPHRASE=$$(openssl rand -base64 24)" > .env; \
		echo "ENCRYPTION_SALT=$$(openssl rand -base64 32)" >> .env; \
		echo "BACKEND_API_KEY=$$(openssl rand -hex 32)" >> .env; \
		echo "BACKEND_PORT=8080" >> .env; \
		echo "DATABASE_PATH=./data/veeam-backend.db" >> .env; \
		echo "ENVIRONMENT=development" >> .env; \
		echo ""; \
		echo "# Legacy Veeam credentials (optional - for migration)" >> .env; \
		echo "# VEEAM_API_URL=https://vbr.example.com:9419" >> .env; \
		echo "# VEEAM_USERNAME=administrator" >> .env; \
		echo "# VEEAM_PASSWORD=password" >> .env; \
		echo ".env file created. Please review and update values."; \
	else \
		echo ".env file already exists."; \
	fi

# Help
help:
	@echo "Available targets:"
	@echo "  build          - Build the binary"
	@echo "  build-prod     - Build optimized binary for production"
	@echo "  run            - Run the server"
	@echo "  dev            - Run with hot reload (requires air)"
	@echo "  test           - Run tests"
	@echo "  test-coverage  - Run tests with coverage report"
	@echo "  bench          - Run benchmarks"
	@echo "  lint           - Run linter (requires golangci-lint)"
	@echo "  fmt            - Format code"
	@echo "  tidy           - Tidy go modules"
	@echo "  deps           - Download dependencies"
	@echo "  clean          - Remove build artifacts"
	@echo "  generate-salt  - Generate random encryption salt"
	@echo "  generate-api-key - Generate random API key"
	@echo "  init-env       - Create .env file from template"
	@echo "  help           - Show this help"
