/**
 * Go Backend API Client
 * 
 * This client communicates with the Go backend for:
 * - Server management (CRUD operations for Veeam server connections)
 * - Token management (authentication, logout, status)
 * - Caching layer control (stats, invalidation)
 * - Proxied API requests to Veeam products
 */

// Types for the Go backend API
export interface GoBackendServer {
  id: string;
  name: string;
  productType: 'vbr' | 'vro' | 'vbm' | 'vb365' | 'k10';
  apiUrl: string;
  username: string;
  verifySSL?: boolean;
  isDefault?: boolean;
  isActive?: boolean; // Computed from tokenStatus
  tokenStatus?: 'none' | 'valid' | 'expired';
  createdAt: string;
  updatedAt: string;
}

export interface CreateServerRequest {
  name: string;
  productType: 'vbr' | 'vro' | 'vbm' | 'vb365' | 'k10';
  apiUrl: string;
  username: string;
  password: string;
}

export interface UpdateServerRequest {
  name?: string;
  apiUrl?: string;
  username?: string;
  password?: string;
  isActive?: boolean;
}

export interface TokenStatus {
  hasToken: boolean;
  isExpired: boolean;
  expiresAt?: string;
  tokenType?: string;
}

export interface AuthenticateRequest {
  serverIds?: string[];
}

export interface AuthenticateResponse {
  serverId: string;
  success: boolean;
  error?: string;
  tokenType?: string;
  expiresAt?: string;
}

export interface CacheStats {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  totalSize: number;
  oldestEntry?: string;
  newestEntry?: string;
}

export interface CacheConfig {
  defaultTTL: string;
  shortTTL: string;
  mediumTTL: string;
  longTTL: string;
  veryLongTTL: string;
  compression: boolean;
  maxCacheSize: number;
}

export interface RateLimitStatus {
  [product: string]: {
    RequestsPerSecond: number;
    BurstSize: number;
  };
}

export interface GoBackendError {
  error: string;
  details?: string;
}

// Setup Wizard Types
export interface SetupStatusResponse {
  setupComplete: boolean;
  hasVbrServer: boolean;
  hasVroServer: boolean;
  hasVbmServer: boolean;
  hasVb365Server: boolean;
  hasK10Server: boolean;
  totalServers: number;
  serversByType: Record<string, number>;
  lastSetupAt?: string;
}

export interface ServerSetupInput {
  name: string;
  apiUrl: string;
  username: string;
  password: string;
  verifySSL: boolean;
  testConnect?: boolean;
}

export interface WizardStepInput {
  step: number;
  vbrServer?: ServerSetupInput;
  vroServer?: ServerSetupInput;
  vbmServer?: ServerSetupInput;
  k10Server?: ServerSetupInput;
}

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  serverVersion?: string;
  responseTimeMs: number;
}

export interface WizardStepResponse {
  success: boolean;
  step: number;
  message?: string;
  server?: GoBackendServer;
  testResult?: ConnectionTestResult;
  setupComplete: boolean;
}

class GoBackendClient {
  private baseUrl: string;
  private apiKey: string | null = null;

  constructor() {
    // Always default to localhost:8080 for standalone mode
    // In standalone deployments, the Go backend serves both API and frontend
    this.baseUrl = this.getConfiguredUrl();
    this.apiKey = (typeof process !== 'undefined' && process.env?.GO_BACKEND_API_KEY) || null;
  }

  /**
   * Get the configured backend URL from environment or default
   */
  private getConfiguredUrl(): string {
    // Check for explicit override
    if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GO_BACKEND_URL) {
      return process.env.NEXT_PUBLIC_GO_BACKEND_URL;
    }
    // Default to localhost:8080 (standalone mode)
    return 'http://localhost:8080';
  }

  /**
   * Check if the Go backend is enabled
   * In standalone mode, always returns true (availability checked via health)
   */
  isEnabled(): boolean {
    // Always enabled in production/standalone mode
    return true;
  }

  /**
   * Get the configured backend URL
   */
  getBackendUrl(): string {
    return this.baseUrl;
  }

  private async request<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${endpoint}`;

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options?.headers,
    };

    if (this.apiKey) {
      (headers as Record<string, string>)['X-API-Key'] = this.apiKey;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle empty responses
    if (response.status === 204) {
      return {} as T;
    }

    const text = await response.text();
    let data;

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Invalid JSON response: ${text}`);
    }

    if (!response.ok) {
      const errorMessage = data.error || data.message || `Request failed: ${response.status}`;
      throw new Error(errorMessage);
    }

    return data as T;
  }

  // ============================================
  // Health & Status
  // ============================================

  async checkHealth(): Promise<{ status: string; database: string; cache: string }> {
    const response = await fetch(`${this.baseUrl}/health`);
    return response.json();
  }

  async checkReady(): Promise<{ status: string }> {
    const response = await fetch(`${this.baseUrl}/ready`);
    return response.json();
  }

  // ============================================
  // Setup Wizard
  // ============================================

  async getSetupStatus(): Promise<SetupStatusResponse> {
    return this.request<SetupStatusResponse>('/setup/status');
  }

  async processWizardStep(input: WizardStepInput): Promise<WizardStepResponse> {
    return this.request<WizardStepResponse>('/setup/wizard', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  async testConnection(
    productType: string,
    apiUrl: string,
    username: string,
    password: string,
    verifySSL: boolean
  ): Promise<ConnectionTestResult> {
    return this.request<ConnectionTestResult>('/setup/test', {
      method: 'POST',
      body: JSON.stringify({ productType, apiUrl, username, password, verifySSL }),
    });
  }

  async completeSetup(): Promise<{ success: boolean; message: string; setupComplete: boolean }> {
    return this.request<{ success: boolean; message: string; setupComplete: boolean }>('/setup/complete', {
      method: 'POST',
    });
  }

  // ============================================
  // Server Management
  // ============================================

  async listServers(): Promise<GoBackendServer[]> {
    const response = await this.request<{ servers?: GoBackendServer[]; data?: GoBackendServer[] }>('/servers');
    // Handle both 'servers' and 'data' response formats
    const servers = response.servers || response.data || [];
    
    // Compute isActive for each server - a configured server is considered active
    // The tokenStatus field indicates authentication state separately
    return servers.map(server => ({
      ...server,
      isActive: true, // All configured servers are considered active/usable
    }));
  }

  async getServer(id: string): Promise<GoBackendServer> {
    return this.request<GoBackendServer>(`/servers/${id}`);
  }

  async createServer(server: CreateServerRequest): Promise<GoBackendServer> {
    return this.request<GoBackendServer>('/servers', {
      method: 'POST',
      body: JSON.stringify(server),
    });
  }

  async updateServer(id: string, updates: UpdateServerRequest): Promise<GoBackendServer> {
    return this.request<GoBackendServer>(`/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteServer(id: string): Promise<void> {
    await this.request<void>(`/servers/${id}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Token Management
  // ============================================

  async authenticateServer(serverId: string): Promise<AuthenticateResponse> {
    return this.request<AuthenticateResponse>(`/servers/${serverId}/authenticate`, {
      method: 'POST',
    });
  }

  async authenticateMultiple(serverIds: string[]): Promise<AuthenticateResponse[]> {
    const response = await this.request<{ results: AuthenticateResponse[] }>('/servers/authenticate', {
      method: 'POST',
      body: JSON.stringify({ serverIds }),
    });
    return response.results || [];
  }

  async authenticateAll(): Promise<AuthenticateResponse[]> {
    const response = await this.request<{ results: AuthenticateResponse[] }>('/servers/authenticate', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    return response.results || [];
  }

  async getTokenStatus(serverId: string): Promise<TokenStatus> {
    return this.request<TokenStatus>(`/servers/${serverId}/token/status`);
  }

  async logoutServer(serverId: string): Promise<void> {
    await this.request<void>(`/servers/${serverId}/logout`, {
      method: 'POST',
    });
  }

  // ============================================
  // Cache Management
  // ============================================

  async getCacheStats(): Promise<CacheStats> {
    return this.request<CacheStats>('/cache/stats');
  }

  async getCacheConfig(): Promise<CacheConfig> {
    return this.request<CacheConfig>('/cache/config');
  }

  async getRateLimitStatus(): Promise<RateLimitStatus> {
    return this.request<RateLimitStatus>('/cache/ratelimit');
  }

  async invalidateAllCache(): Promise<{ deletedEntries: number }> {
    return this.request<{ deletedEntries: number }>('/cache', {
      method: 'DELETE',
    });
  }

  async invalidateServerCache(serverId: string): Promise<{ deletedEntries: number }> {
    return this.request<{ deletedEntries: number }>(`/servers/${serverId}/cache`, {
      method: 'DELETE',
    });
  }

  async invalidateServerCachePattern(serverId: string, pattern: string): Promise<{ deletedEntries: number }> {
    return this.request<{ deletedEntries: number }>(`/servers/${serverId}/cache/${encodeURIComponent(pattern)}`, {
      method: 'DELETE',
    });
  }

  async resetServerRateLimit(serverId: string): Promise<void> {
    await this.request<void>(`/servers/${serverId}/ratelimit/reset`, {
      method: 'POST',
    });
  }

  // ============================================
  // Proxy Requests (to Veeam APIs via Go backend)
  // ============================================

  /**
   * Make a GET request through the Go backend proxy (uses caching)
   */
  async proxyGet<T>(serverId: string, apiPath: string): Promise<T> {
    return this.request<T>(`/proxy/${serverId}${apiPath}`);
  }

  /**
   * Make a POST request through the Go backend proxy (no caching, invalidates cache)
   */
  async proxyPost<T>(serverId: string, apiPath: string, body?: unknown): Promise<T> {
    return this.request<T>(`/proxy/${serverId}${apiPath}`, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Make a PUT request through the Go backend proxy (no caching, invalidates cache)
   */
  async proxyPut<T>(serverId: string, apiPath: string, body?: unknown): Promise<T> {
    return this.request<T>(`/proxy/${serverId}${apiPath}`, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Make a DELETE request through the Go backend proxy (no caching, invalidates cache)
   */
  async proxyDelete<T>(serverId: string, apiPath: string): Promise<T> {
    return this.request<T>(`/proxy/${serverId}${apiPath}`, {
      method: 'DELETE',
    });
  }

  // ============================================
  // Convenience Methods for Common Operations
  // ============================================

  /**
   * Get all servers of a specific product type
   */
  async getServersByType(productType: GoBackendServer['productType']): Promise<GoBackendServer[]> {
    const servers = await this.listServers();
    return servers.filter(s => s.productType === productType && s.isActive);
  }

  /**
   * Get the first active server of a specific type (for single-server setups)
   */
  async getPrimaryServer(productType: GoBackendServer['productType']): Promise<GoBackendServer | null> {
    const servers = await this.getServersByType(productType);
    return servers.length > 0 ? servers[0] : null;
  }

  /**
   * Authenticate and get token for a primary server of a type
   */
  async authenticatePrimaryServer(productType: GoBackendServer['productType']): Promise<AuthenticateResponse | null> {
    const server = await this.getPrimaryServer(productType);
    if (!server) return null;
    return this.authenticateServer(server.id);
  }

  /**
   * Make a proxied GET request to the primary server of a type
   */
  async proxyGetToPrimary<T>(productType: GoBackendServer['productType'], apiPath: string): Promise<T> {
    const server = await this.getPrimaryServer(productType);
    if (!server) {
      throw new Error(`No active ${productType.toUpperCase()} server configured`);
    }
    return this.proxyGet<T>(server.id, apiPath);
  }

  /**
   * Make a proxied POST request to the primary server of a type
   */
  async proxyPostToPrimary<T>(productType: GoBackendServer['productType'], apiPath: string, body?: unknown): Promise<T> {
    const server = await this.getPrimaryServer(productType);
    if (!server) {
      throw new Error(`No active ${productType.toUpperCase()} server configured`);
    }
    return this.proxyPost<T>(server.id, apiPath, body);
  }
}

// Singleton instance
export const goBackendClient = new GoBackendClient();

// Export types
export type { GoBackendClient };
