/**
 * Go Backend Configuration
 * 
 * In standalone mode (Go backend serving frontend), the backend is always enabled.
 * In development mode, we check environment variables or do runtime detection.
 * 
 * The frontend always assumes Go backend is available at localhost:8080 in production.
 * A health check determines actual availability at runtime.
 */

export interface BackendConfig {
  enabled: boolean;
  url: string;
  apiKey: string | null;
}

// Cache for backend availability check
let backendAvailable: boolean | null = null;
let backendCheckPromise: Promise<boolean> | null = null;

/**
 * Get the Go backend URL
 * In production/standalone mode, always use localhost:8080
 * In development, can be overridden via NEXT_PUBLIC_GO_BACKEND_URL
 */
export function getGoBackendUrl(): string {
  // Check for explicit override first
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_GO_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_GO_BACKEND_URL;
  }
  // Default to localhost:8080 (standalone mode)
  return 'http://localhost:8080';
}

/**
 * Get the current backend configuration
 */
export function getBackendConfig(): BackendConfig {
  const url = getGoBackendUrl();
  const apiKey = (typeof process !== 'undefined' && process.env?.GO_BACKEND_API_KEY) || null;

  return {
    // In standalone mode, always enable - actual availability checked at runtime
    enabled: true,
    url,
    apiKey,
  };
}

/**
 * Check if the Go backend is enabled (synchronous check)
 * 
 * This returns true by default in production mode.
 * Use checkGoBackendAvailable() for async runtime verification.
 */
export function isGoBackendEnabled(): boolean {
  // If we've already checked and backend is not available, return false
  if (backendAvailable === false) {
    return false;
  }
  // Otherwise assume it's available (will be verified at runtime)
  return true;
}

/**
 * Check if Go backend is actually available (async runtime check)
 * Results are cached for the session.
 */
export async function checkGoBackendAvailable(): Promise<boolean> {
  // Return cached result if available
  if (backendAvailable !== null) {
    return backendAvailable;
  }

  // If a check is already in progress, wait for it
  if (backendCheckPromise) {
    return backendCheckPromise;
  }

  // Perform health check
  backendCheckPromise = (async () => {
    try {
      const url = getGoBackendUrl();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000); // 2 second timeout

      const response = await fetch(`${url}/api/v1/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.ok) {
        backendAvailable = true;
        console.log('[Backend] Go backend available at', url);
        return true;
      }
    } catch {
      // Backend not reachable
      console.warn('[Backend] Go backend not available, using legacy mode');
    }

    backendAvailable = false;
    return false;
  })();

  return backendCheckPromise;
}

/**
 * Reset the backend availability cache
 * Call this if the backend might have come online
 */
export function resetBackendCache(): void {
  backendAvailable = null;
  backendCheckPromise = null;
}
