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
 * - Passes VB365/VRO configuration status to sidebar
 *
 * Props:
 * - children: Page content to render
 * - vb365Configured: Whether VB365 server is configured
 * - vroConfigured: Whether VRO server is configured
 *
 * @module components/conditional-layout
 */

'use client';

import { usePathname } from 'next/navigation';
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AppHeader } from "@/components/app-header";
import { SetupCheckProvider } from '@/components/setup-check-provider';

interface ConditionalLayoutProps {
  children: React.ReactNode;
  vb365Configured: boolean;
  vroConfigured: boolean;
}

export function ConditionalLayout({ children, vb365Configured, vroConfigured }: ConditionalLayoutProps) {
  const pathname = usePathname();
  
  // Check if we're on the setup page
  const isSetupPage = pathname?.startsWith('/setup');

  // For setup page, render without sidebar
  if (isSetupPage) {
    return <>{children}</>;
  }

  // For all other pages, wrap with setup check and sidebar
  return (
    <SetupCheckProvider>
      <SidebarProvider>
        <AppSidebar
          vb365Configured={vb365Configured}
          vroConfigured={vroConfigured}
        />
        <SidebarInset>
          <AppHeader />
          {children}
        </SidebarInset>
      </SidebarProvider>
    </SetupCheckProvider>
  );
}
