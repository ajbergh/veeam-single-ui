/**
 * Application Header Component
 *
 * Sticky header bar displayed at the top of every page containing:
 * - Global search: Command palette for finding resources
 * - Mode toggle: Dark/light theme switcher
 *
 * Features:
 * - Sticky positioning (stays visible on scroll)
 * - Border separator from content
 * - Responsive layout
 * - Z-index management for overlays
 *
 * Layout:
 * - Left: Global search input (expands to max-w-md)
 * - Right: Dark/light mode toggle button
 *
 * @module components/app-header
 */

"use client"

import { GlobalSearch } from "@/components/global-search"
import { ModeToggle } from "@/components/mode-toggle"

export function AppHeader() {
  return (
    <div className="sticky top-0 z-40 bg-background border-b">
      <div className="flex items-center gap-4 px-6 py-3">
        <div className="flex-1 max-w-md">
          <GlobalSearch />
        </div>
        <ModeToggle />
      </div>
    </div>
  )
}
