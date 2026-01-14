/**
 * Sidebar Mode Selector Component
 *
 * Toggle for sidebar display mode:
 * - Default: Full sidebar with labels
 * - Icon: Collapsed icon-only sidebar
 *
 * Only visible on large screens (lg:flex).
 * Uses useSidebar hook to toggle state.
 *
 * @module components/theme-customizer/sidebar-mode-selector
 */

"use client";


import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useSidebar } from "@/components/ui/sidebar";

export function SidebarModeSelector() {
    const { toggleSidebar } = useSidebar();

    return (
        <div className="hidden flex-col gap-2 pt-2 lg:flex">
            <ToggleGroup
                type="single"
                onValueChange={() => toggleSidebar()}
                className="gap-2 justify-start">
                <ToggleGroupItem variant="outline" value="full" className="w-[80px]">
                    Default
                </ToggleGroupItem>
                <ToggleGroupItem
                    variant="outline"
                    value="centered"
                    className="w-[80px] data-[variant=outline]:border-l-1">
                    Icon
                </ToggleGroupItem>
            </ToggleGroup>
        </div>
    );
}
