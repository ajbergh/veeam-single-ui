/**
 * Unified Veeam API Client
 * 
 * This module provides a unified interface for accessing Veeam APIs.
 * It can use either:
 * 1. Legacy mode: Direct Next.js API routes (when Go backend is not configured)
 * 2. Backend mode: Go backend proxy with caching and encryption (when configured)
 * 
 * The appropriate mode is selected based on NEXT_PUBLIC_GO_BACKEND_URL environment variable.
 */

import { isGoBackendEnabled } from '@/lib/config/backend';
import { goBackendClient, GoBackendServer } from '@/lib/api/go-backend-client';

export interface UnifiedClientConfig {
  productType: GoBackendServer['productType'];
  serverId?: string; // Optional: specific server ID to use
}

/**
 * Get the API mode (backend or legacy)
 */
export function getApiMode(): 'backend' | 'legacy' {
  return isGoBackendEnabled() ? 'backend' : 'legacy';
}

/**
 * Check if a specific product is configured
 * In backend mode, checks for active servers of that type
 * In legacy mode, checks for environment variables
 */
export async function isProductConfigured(productType: GoBackendServer['productType']): Promise<boolean> {
  if (isGoBackendEnabled()) {
    try {
      const servers = await goBackendClient.getServersByType(productType);
      return servers.length > 0;
    } catch {
      return false;
    }
  } else {
    // Legacy mode - check environment variables
    switch (productType) {
      case 'vbr':
        return !!process.env.VEEAM_API_URL;
      case 'vro':
        return !!process.env.VRO_API_URL;
      case 'vbm':
      case 'vb365':
        return !!process.env.VBM_API_URL;
      case 'k10':
        return !!process.env.K10_API_URL;
      default:
        return false;
    }
  }
}

/**
 * Get all configured servers for a product type
 * In backend mode, returns servers from the database
 * In legacy mode, returns a synthetic server from environment variables
 */
export async function getConfiguredServers(productType: GoBackendServer['productType']): Promise<{
  id: string;
  name: string;
  apiUrl: string;
  isActive: boolean;
}[]> {
  if (isGoBackendEnabled()) {
    try {
      const servers = await goBackendClient.getServersByType(productType);
      return servers.map(s => ({
        id: s.id,
        name: s.name,
        apiUrl: s.apiUrl,
        isActive: s.isActive ?? false,
      }));
    } catch {
      return [];
    }
  } else {
    // Legacy mode - return synthetic server from env vars
    const envMapping: Record<GoBackendServer['productType'], { urlVar: string; defaultName: string }> = {
      vbr: { urlVar: 'VEEAM_API_URL', defaultName: 'VBR (Environment)' },
      vro: { urlVar: 'VRO_API_URL', defaultName: 'VRO (Environment)' },
      vbm: { urlVar: 'VBM_API_URL', defaultName: 'VBM (Environment)' },
      vb365: { urlVar: 'VBM_API_URL', defaultName: 'VB365 (Environment)' },
      k10: { urlVar: 'K10_API_URL', defaultName: 'K10 (Environment)' },
    };

    const config = envMapping[productType];
    const apiUrl = process.env[config.urlVar];

    if (!apiUrl) return [];

    return [{
      id: `legacy-${productType}`,
      name: config.defaultName,
      apiUrl,
      isActive: true,
    }];
  }
}

/**
 * Make a GET request to a Veeam API
 * Automatically routes through Go backend if configured
 */
export async function veeamGet<T>(
  productType: GoBackendServer['productType'],
  apiPath: string,
  options?: {
    serverId?: string;
    fallbackToLegacy?: boolean;
  }
): Promise<T> {
  if (isGoBackendEnabled()) {
    try {
      if (options?.serverId) {
        return await goBackendClient.proxyGet<T>(options.serverId, apiPath);
      } else {
        return await goBackendClient.proxyGetToPrimary<T>(productType, apiPath);
      }
    } catch (error) {
      if (options?.fallbackToLegacy) {
        console.warn('Go backend request failed, falling back to legacy:', error);
        // Fall through to legacy mode
      } else {
        throw error;
      }
    }
  }

  // Legacy mode or fallback - use Next.js API routes directly
  const legacyPrefix = getLegacyApiPrefix(productType);
  const response = await fetch(`${legacyPrefix}${apiPath}`);
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Make a POST request to a Veeam API
 * Automatically routes through Go backend if configured
 */
export async function veeamPost<T>(
  productType: GoBackendServer['productType'],
  apiPath: string,
  body?: unknown,
  options?: {
    serverId?: string;
    fallbackToLegacy?: boolean;
  }
): Promise<T> {
  if (isGoBackendEnabled()) {
    try {
      if (options?.serverId) {
        return await goBackendClient.proxyPost<T>(options.serverId, apiPath, body);
      } else {
        return await goBackendClient.proxyPostToPrimary<T>(productType, apiPath, body);
      }
    } catch (error) {
      if (options?.fallbackToLegacy) {
        console.warn('Go backend request failed, falling back to legacy:', error);
      } else {
        throw error;
      }
    }
  }

  // Legacy mode
  const legacyPrefix = getLegacyApiPrefix(productType);
  const response = await fetch(`${legacyPrefix}${apiPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Make a PUT request to a Veeam API
 */
export async function veeamPut<T>(
  productType: GoBackendServer['productType'],
  apiPath: string,
  body?: unknown,
  options?: {
    serverId?: string;
  }
): Promise<T> {
  if (isGoBackendEnabled()) {
    if (options?.serverId) {
      return await goBackendClient.proxyPut<T>(options.serverId, apiPath, body);
    } else {
      const server = await goBackendClient.getPrimaryServer(productType);
      if (!server) {
        throw new Error(`No active ${productType.toUpperCase()} server configured`);
      }
      return await goBackendClient.proxyPut<T>(server.id, apiPath, body);
    }
  }

  // Legacy mode
  const legacyPrefix = getLegacyApiPrefix(productType);
  const response = await fetch(`${legacyPrefix}${apiPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Make a DELETE request to a Veeam API
 */
export async function veeamDelete<T>(
  productType: GoBackendServer['productType'],
  apiPath: string,
  options?: {
    serverId?: string;
  }
): Promise<T> {
  if (isGoBackendEnabled()) {
    if (options?.serverId) {
      return await goBackendClient.proxyDelete<T>(options.serverId, apiPath);
    } else {
      const server = await goBackendClient.getPrimaryServer(productType);
      if (!server) {
        throw new Error(`No active ${productType.toUpperCase()} server configured`);
      }
      return await goBackendClient.proxyDelete<T>(server.id, apiPath);
    }
  }

  // Legacy mode
  const legacyPrefix = getLegacyApiPrefix(productType);
  const response = await fetch(`${legacyPrefix}${apiPath}`, {
    method: 'DELETE',
  });
  
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Get the legacy API prefix for a product type
 */
function getLegacyApiPrefix(productType: GoBackendServer['productType']): string {
  switch (productType) {
    case 'vbr':
      return '/api/veeam';
    case 'vro':
      return '/api/vro';
    case 'vbm':
    case 'vb365':
      return '/api/vbm';
    default:
      return '/api/veeam';
  }
}

/**
 * Utility to check backend health and availability
 */
export async function checkBackendHealth(): Promise<{
  mode: 'backend' | 'legacy';
  backendAvailable: boolean;
  backendUrl?: string;
  error?: string;
}> {
  const mode = getApiMode();
  
  if (mode === 'legacy') {
    return {
      mode: 'legacy',
      backendAvailable: false,
    };
  }

  try {
    await goBackendClient.checkHealth();
    return {
      mode: 'backend',
      backendAvailable: true,
      backendUrl: goBackendClient.getBackendUrl(),
    };
  } catch (error) {
    return {
      mode: 'backend',
      backendAvailable: false,
      backendUrl: goBackendClient.getBackendUrl(),
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
