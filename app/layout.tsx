/**
 * Root Layout
 *
 * Application root layout providing:
 * - Theme configuration (preset, scale, radius) from cookies
 * - Font loading (Geist Sans and Mono)
 * - Provider hierarchy (Theme, ActiveTheme, Sidebar)
 * - Conditional layout based on route (setup vs main)
 * - Toast notifications via Sonner
 *
 * Server Component Features:
 * - Reads theme settings from cookies for SSR
 * - Checks VB365/VRO configuration status
 * - Applies theme CSS classes to <html> element
 *
 * @module app/layout
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { ActiveThemeProvider } from "@/components/active-theme";
import { ConditionalLayout } from "@/components/conditional-layout";
import { DEFAULT_THEME } from "@/lib/themes";
import { cookies } from "next/headers";
import { cn } from "@/lib/utils";
import { SectionNamesProvider } from "@/lib/context/section-names-context";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Veeam Single-UI",
  description: "Veeam Backup & Replication Management",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeSettings = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    preset: (cookieStore.get("theme_preset")?.value ?? DEFAULT_THEME.preset) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    scale: (cookieStore.get("theme_scale")?.value ?? DEFAULT_THEME.scale) as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    radius: (cookieStore.get("theme_radius")?.value ?? DEFAULT_THEME.radius) as any,
    contentLayout: (cookieStore.get("theme_content_layout")?.value ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      DEFAULT_THEME.contentLayout) as any
  };

  const bodyAttributes = Object.fromEntries(
    Object.entries(themeSettings)
      .filter(([, value]) => value)
      .map(([key, value]) => [`data-theme-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`, value])
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={cn(`${geistSans.variable} ${geistMono.variable} antialiased bg-background group/layout font-sans`)}
        {...bodyAttributes}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ActiveThemeProvider initialTheme={themeSettings}>
            <SectionNamesProvider>
              <ConditionalLayout
                vbrConfigured={!!process.env.VEEAM_API_URL}
                vb365Configured={!!process.env.VBM_API_URL}
                vroConfigured={!!process.env.VRO_API_URL}
                veeamOneConfigured={!!process.env.VEEAM_ONE_API_URL}
              >
                {children}
              </ConditionalLayout>
            </SectionNamesProvider>
            <Toaster />
          </ActiveThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
