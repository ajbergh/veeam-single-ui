/**
 * Reset Theme Button Component
 *
 * Destructive button to reset all theme settings to defaults:
 * - Restores DEFAULT_THEME preset
 * - Clears all customizations
 *
 * @module components/theme-customizer/reset-theme-button
 */

"use client";

import { useThemeConfig } from "@/components/active-theme";
import { Button } from "@/components/ui/button";
import { DEFAULT_THEME } from "@/lib/themes";

export function ResetThemeButton() {
    const { setTheme } = useThemeConfig();

    const resetThemeHandle = () => {
        setTheme(DEFAULT_THEME);
    };

    return (
        <Button variant="destructive" className="mt-4 w-full" onClick={resetThemeHandle}>
            Reset to Default
        </Button>
    );
}
