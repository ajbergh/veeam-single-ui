/**
 * Server Configuration Context
 *
 * Provides server configuration status to the application.
 * When Go backend is enabled, fetches actual server configuration.
 * Falls back to environment variables in legacy mode.
 *
 * @module lib/context/server-config-context
 */

'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { goBackendClient, SetupStatusResponse } from '@/lib/api/go-backend-client';
import { isGoBackendEnabled } from '@/lib/config/backend';

export interface ServerConfigStatus {
  vbrConfigured: boolean;
  vroConfigured: boolean;
  vbmConfigured: boolean;
  vb365Configured: boolean;
  voneConfigured: boolean;
  k10Configured: boolean;
  isLoading: boolean;
  isGoBackendMode: boolean;
}

interface ServerConfigContextValue extends ServerConfigStatus {
  refresh: () => Promise<void>;
}

const defaultStatus: ServerConfigStatus = {
  vbrConfigured: false,
  vroConfigured: false,
  vbmConfigured: false,
  vb365Configured: false,
  voneConfigured: false,
  k10Configured: false,
  isLoading: true,
  isGoBackendMode: false,
};

const ServerConfigContext = createContext<ServerConfigContextValue>({
  ...defaultStatus,
  refresh: async () => {},
});

interface ServerConfigProviderProps {
  children: React.ReactNode;
  // Legacy fallback values from environment variables (passed from server component)
  legacyVbrConfigured?: boolean;
  legacyVroConfigured?: boolean;
  legacyVbmConfigured?: boolean;
  legacyVoneConfigured?: boolean;
}

export function ServerConfigProvider({
  children,
  legacyVbrConfigured = false,
  legacyVroConfigured = false,
  legacyVbmConfigured = false,
  legacyVoneConfigured = false,
}: ServerConfigProviderProps) {
  const [status, setStatus] = useState<ServerConfigStatus>(() => ({
    // Start with legacy values while loading
    vbrConfigured: legacyVbrConfigured,
    vroConfigured: legacyVroConfigured,
    vbmConfigured: legacyVbmConfigured,
    vb365Configured: legacyVbmConfigured, // VB365 uses same URL as VBM
    voneConfigured: legacyVoneConfigured,
    k10Configured: false,
    isLoading: true,
    isGoBackendMode: false,
  }));

  const fetchStatus = async () => {
    // Check if Go backend is enabled
    if (!isGoBackendEnabled()) {
      // Use legacy environment variable values
      setStatus({
        vbrConfigured: legacyVbrConfigured,
        vroConfigured: legacyVroConfigured,
        vbmConfigured: legacyVbmConfigured,
        vb365Configured: legacyVbmConfigured,
        voneConfigured: legacyVoneConfigured,
        k10Configured: false,
        isLoading: false,
        isGoBackendMode: false,
      });
      return;
    }

    try {
      const setupStatus: SetupStatusResponse = await goBackendClient.getSetupStatus();
      
      setStatus({
        vbrConfigured: setupStatus.hasVbrServer,
        vroConfigured: setupStatus.hasVroServer,
        vbmConfigured: setupStatus.hasVbmServer,
        vb365Configured: setupStatus.hasVb365Server,
        voneConfigured: setupStatus.hasVoneServer,
        k10Configured: setupStatus.hasK10Server,
        isLoading: false,
        isGoBackendMode: true,
      });
    } catch (error) {
      console.warn('Failed to fetch server config status:', error);
      // Fall back to legacy values on error
      setStatus({
        vbrConfigured: legacyVbrConfigured,
        vroConfigured: legacyVroConfigured,
        vbmConfigured: legacyVbmConfigured,
        vb365Configured: legacyVbmConfigured,
        voneConfigured: legacyVoneConfigured,
        k10Configured: false,
        isLoading: false,
        isGoBackendMode: false,
      });
    }
  };

  useEffect(() => {
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ServerConfigContext.Provider value={{ ...status, refresh: fetchStatus }}>
      {children}
    </ServerConfigContext.Provider>
  );
}

export function useServerConfig() {
  return useContext(ServerConfigContext);
}
