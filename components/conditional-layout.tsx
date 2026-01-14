/**
 * Conditional Layout Component
 *
 * Root layout wrapper that conditionally renders sidebar and header:
 * - Setup page: Minimal layout without sidebar
 * - All other pages: Full layout with sidebar and header
 *
 * Features:
 * - Path-based layout switching (/setup vs other routes)
 * - Sidebar with product navigation
 * - Header with search and user actions
 * - SetupCheckProvider for server configuration validation
 * - ServerConfigProvider for dynamic server status
 * - Passes configuration status to sidebar from Go backend or env vars
 *
 * Props:
 * - children: Page content to render
 * - legacy*Configured: Fallback values from environment variables
 *
 * @module components/conditional-layout
 */

'use client';

import { usePathname } from 'next/navigation';
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { SetupCheckProvider } from '@/components/setup-check-provider';
import { ServerConfigProvider, useServerConfig } from '@/lib/context/server-config-context';

interface ConditionalLayoutProps {
  children: React.ReactNode;
  vbrConfigured: boolean;
  vb365Configured: boolean;
  vroConfigured: boolean;
  veeamOneConfigured: boolean;
}

function SidebarWithConfig({ children }: { children: React.ReactNode }) {
  const { vbrConfigured, vbmConfigured, vroConfigured, voneConfigured } = useServerConfig();

  return (
    <SidebarProvider>
      <AppSidebar
        vbrConfigured={vbrConfigured}
        vb365Configured={vbmConfigured}
        vroConfigured={vroConfigured}
        veeamOneConfigured={voneConfigured}
      />
      <SidebarInset>
        <AppHeader />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}

export function ConditionalLayout({ 
  children, 
  vbrConfigured, 
  vb365Configured, 
  vroConfigured, 
  veeamOneConfigured 
}: ConditionalLayoutProps) {
  const pathname = usePathname();
  
  // Check if we're on the setup page
  const isSetupPage = pathname?.startsWith('/setup');

  // For setup page, render without sidebar
  if (isSetupPage) {
    return <>{children}</>;
  }

  // For all other pages, wrap with setup check and sidebar
  return (
    <ServerConfigProvider
      legacyVbrConfigured={vbrConfigured}
      legacyVroConfigured={vroConfigured}
      legacyVbmConfigured={vb365Configured}
      legacyVoneConfigured={veeamOneConfigured}
    >
      <SetupCheckProvider>
        <SidebarWithConfig>
          {children}
        </SidebarWithConfig>
      </SetupCheckProvider>
    </ServerConfigProvider>
  );
}
