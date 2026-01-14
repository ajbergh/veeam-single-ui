/**
 * Theme Provider Component
 *
 * Wraps the application with next-themes ThemeProvider for dark/light mode support.
 * This is a thin wrapper around next-themes that handles:
 * - System preference detection
 * - Theme persistence in localStorage
 * - Flash-free theme loading with server-side support
 *
 * Usage:
 * Wrap the root layout with this provider:
 * ```tsx
 * <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
 *   <App />
 * </ThemeProvider>
 * ```
 *
 * @module components/theme-provider
 */

"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
