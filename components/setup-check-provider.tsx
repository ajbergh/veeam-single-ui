/**
 * Setup Check Provider Component
 *
 * Context provider that checks if the application requires initial setup
 * and automatically redirects to the setup wizard when needed.
 *
 * Behavior:
 * 1. On mount, checks Go backend for setup status
 * 2. If no servers configured, redirects to /setup
 * 3. If already on /setup page, skips the check
 * 4. If Go backend not enabled, skips the check
 * 5. Shows loading spinner during the check
 *
 * Usage:
 * Wrap your app layout with this provider to enable auto-redirect:
 *
 * ```tsx
 * <SetupCheckProvider>
 *   <AppContent />
 * </SetupCheckProvider>
 * ```
 *
 * Dependencies:
 * - go-backend-client: For checking setup status
 * - backend config: For checking if Go backend is enabled
 *
 * @module components/setup-check-provider
 */

'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { goBackendClient } from '@/lib/api/go-backend-client';
import { isGoBackendEnabled } from '@/lib/config/backend';
import { Loader2 } from 'lucide-react';

interface SetupCheckProviderProps {
  children: React.ReactNode;
}

export function SetupCheckProvider({ children }: SetupCheckProviderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isChecking, setIsChecking] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    // Skip check if already on setup page
    if (pathname?.startsWith('/setup')) {
      setIsChecking(false);
      return;
    }

    // Skip check if Go backend is not enabled
    if (!isGoBackendEnabled()) {
      setIsChecking(false);
      return;
    }

    const checkSetupStatus = async () => {
      try {
        const status = await goBackendClient.getSetupStatus();
        
        if (!status.setupComplete) {
          setNeedsSetup(true);
          router.push('/setup');
        }
      } catch (error) {
        // If we can't reach the backend, don't block the app
        // The user might be in a legacy environment without the Go backend
        console.warn('Failed to check setup status:', error);
      } finally {
        setIsChecking(false);
      }
    };

    checkSetupStatus();
  }, [pathname, router]);

  // Show loading state while checking
  if (isChecking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  // If needs setup and not on setup page, don't render children
  // (router.push will handle the redirect)
  if (needsSetup && !pathname?.startsWith('/setup')) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Redirecting to setup...</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
