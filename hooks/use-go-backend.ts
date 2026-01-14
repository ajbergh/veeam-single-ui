/**
 * Go Backend React Hooks
 *
 * Custom React hooks for interacting with the Go backend service.
 * These hooks provide reactive state management for:
 * - Backend availability checking
 * - Server CRUD operations
 * - Token authentication status
 * - Cache management
 *
 * Available Hooks:
 * - useGoBackendStatus: Check if backend is available
 * - useServers: List and manage Veeam server connections
 * - useServerAuthentication: Monitor and trigger authentication
 * - useCacheStats: Monitor cache performance
 *
 * All hooks handle loading states, errors, and automatic refetching.
 * They integrate with the goBackendClient for API calls.
 *
 * @module hooks/use-go-backend
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  goBackendClient,
  GoBackendServer,
  CreateServerRequest,
  UpdateServerRequest,
  AuthenticateResponse,
  TokenStatus,
  CacheStats,
} from '@/lib/api/go-backend-client';
import { isGoBackendEnabled } from '@/lib/config/backend';

/**
 * Hook for checking if the Go backend is available
 */
export function useGoBackendStatus() {
  const [isAvailable, setIsAvailable] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    if (!isGoBackendEnabled()) {
      setIsAvailable(false);
      setIsChecking(false);
      return;
    }

    setIsChecking(true);
    setError(null);

    try {
      await goBackendClient.checkHealth();
      setIsAvailable(true);
    } catch (err) {
      setIsAvailable(false);
      setError(err instanceof Error ? err.message : 'Backend unavailable');
    } finally {
      setIsChecking(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  return { isAvailable, isChecking, error, refresh: checkStatus };
}

/**
 * Hook for managing Veeam servers
 */
export function useVeeamServers() {
  const [servers, setServers] = useState<GoBackendServer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchServers = useCallback(async () => {
    if (!isGoBackendEnabled()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await goBackendClient.listServers();
      setServers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch servers');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const createServer = async (data: CreateServerRequest): Promise<GoBackendServer> => {
    const server = await goBackendClient.createServer(data);
    setServers(prev => [...prev, server]);
    return server;
  };

  const updateServer = async (id: string, data: UpdateServerRequest): Promise<GoBackendServer> => {
    const updated = await goBackendClient.updateServer(id, data);
    setServers(prev => prev.map(s => s.id === id ? updated : s));
    return updated;
  };

  const deleteServer = async (id: string): Promise<void> => {
    await goBackendClient.deleteServer(id);
    setServers(prev => prev.filter(s => s.id !== id));
  };

  return {
    servers,
    isLoading,
    error,
    refresh: fetchServers,
    createServer,
    updateServer,
    deleteServer,
  };
}

/**
 * Hook for authenticating with a specific server
 */
export function useServerAuth(serverId: string | null) {
  const [status, setStatus] = useState<TokenStatus | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    if (!serverId || !isGoBackendEnabled()) return;

    try {
      const result = await goBackendClient.getTokenStatus(serverId);
      setStatus(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check token status');
    }
  }, [serverId]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const authenticate = async (): Promise<AuthenticateResponse | null> => {
    if (!serverId) return null;

    setIsAuthenticating(true);
    setError(null);

    try {
      const result = await goBackendClient.authenticateServer(serverId);
      if (result.success) {
        await checkStatus();
      } else {
        setError(result.error || 'Authentication failed');
      }
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  };

  const logout = async (): Promise<void> => {
    if (!serverId) return;

    try {
      await goBackendClient.logoutServer(serverId);
      setStatus({ hasToken: false, isExpired: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed');
      throw err;
    }
  };

  return {
    status,
    isAuthenticating,
    error,
    authenticate,
    logout,
    refresh: checkStatus,
  };
}

/**
 * Hook for batch authentication of multiple servers
 */
export function useBatchAuth() {
  const [results, setResults] = useState<AuthenticateResponse[]>([]);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authenticateAll = async (): Promise<AuthenticateResponse[]> => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const result = await goBackendClient.authenticateAll();
      setResults(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch authentication failed';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  };

  const authenticateServers = async (serverIds: string[]): Promise<AuthenticateResponse[]> => {
    setIsAuthenticating(true);
    setError(null);

    try {
      const result = await goBackendClient.authenticateMultiple(serverIds);
      setResults(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch authentication failed';
      setError(message);
      throw err;
    } finally {
      setIsAuthenticating(false);
    }
  };

  return {
    results,
    isAuthenticating,
    error,
    authenticateAll,
    authenticateServers,
  };
}

/**
 * Hook for cache management
 */
export function useCacheManagement() {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!isGoBackendEnabled()) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await goBackendClient.getCacheStats();
      setStats(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch cache stats');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const invalidateAll = async (): Promise<number> => {
    try {
      const result = await goBackendClient.invalidateAllCache();
      await fetchStats();
      return result.deletedEntries;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invalidate cache');
      throw err;
    }
  };

  const invalidateServer = async (serverId: string): Promise<number> => {
    try {
      const result = await goBackendClient.invalidateServerCache(serverId);
      await fetchStats();
      return result.deletedEntries;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invalidate server cache');
      throw err;
    }
  };

  return {
    stats,
    isLoading,
    error,
    refresh: fetchStats,
    invalidateAll,
    invalidateServer,
  };
}

/**
 * Hook for making proxied API requests through the Go backend
 */
export function useProxyRequest<T>(
  productType: GoBackendServer['productType'],
  apiPath: string,
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
  }
) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (options?.enabled === false || !isGoBackendEnabled()) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await goBackendClient.proxyGetToPrimary<T>(productType, apiPath);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setIsLoading(false);
    }
  }, [productType, apiPath, options?.enabled]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Set up refetch interval if specified
  useEffect(() => {
    if (!options?.refetchInterval) return;

    const interval = setInterval(fetchData, options.refetchInterval);
    return () => clearInterval(interval);
  }, [fetchData, options?.refetchInterval]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchData,
  };
}

/**
 * Hook for setup wizard functionality
 */
export function useSetupWizard() {
  const [setupStatus, setSetupStatus] = useState<{
    setupComplete: boolean;
    hasVbrServer: boolean;
    hasVroServer: boolean;
    hasVbmServer: boolean;
    totalServers: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!isGoBackendEnabled()) {
      setIsLoading(false);
      setSetupStatus({
        setupComplete: true, // Assume complete if Go backend not enabled
        hasVbrServer: false,
        hasVroServer: false,
        hasVbmServer: false,
        totalServers: 0,
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const status = await goBackendClient.getSetupStatus();
      setSetupStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check setup status');
      // If we can't reach the backend, assume setup is needed
      setSetupStatus({
        setupComplete: false,
        hasVbrServer: false,
        hasVroServer: false,
        hasVbmServer: false,
        totalServers: 0,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const testConnection = async (
    productType: string,
    apiUrl: string,
    username: string,
    password: string,
    verifySSL: boolean
  ) => {
    return goBackendClient.testConnection(productType, apiUrl, username, password, verifySSL);
  };

  const processStep = async (input: {
    step: number;
    vbrServer?: {
      name: string;
      apiUrl: string;
      username: string;
      password: string;
      verifySSL: boolean;
      testConnect?: boolean;
    };
    vroServer?: {
      name: string;
      apiUrl: string;
      username: string;
      password: string;
      verifySSL: boolean;
      testConnect?: boolean;
    };
    vbmServer?: {
      name: string;
      apiUrl: string;
      username: string;
      password: string;
      verifySSL: boolean;
      testConnect?: boolean;
    };
    k10Server?: {
      name: string;
      apiUrl: string;
      username: string;
      password: string;
      verifySSL: boolean;
      testConnect?: boolean;
    };
  }) => {
    return goBackendClient.processWizardStep(input);
  };

  const completeSetup = async () => {
    const result = await goBackendClient.completeSetup();
    if (result.success) {
      await fetchStatus();
    }
    return result;
  };

  return {
    setupStatus,
    isLoading,
    error,
    refresh: fetchStatus,
    testConnection,
    processStep,
    completeSetup,
    needsSetup: !isLoading && setupStatus && !setupStatus.setupComplete,
  };
}
