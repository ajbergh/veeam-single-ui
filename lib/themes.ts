/**
 * Theme Configuration
 *
 * Defines the available visual themes for the application.
 * Uses oklch color space for perceptually uniform colors.
 *
 * Theme Properties:
 * - preset: Color scheme name (default, underground, rose-garden, etc.)
 * - radius: Border radius multiplier
 * - scale: Font/element scale percentage
 * - contentLayout: "full" or "centered" content width
 *
 * Available Presets:
 * - Default: Neutral grayscale
 * - Underground: Green-tinted
 * - Rose Garden: Pink/rose
 * - Lake View: Teal/cyan
 * - Sunset Glow: Orange/amber
 * - Forest Whisper: Forest green
 * - Ocean Breeze: Blue/purple
 * - Lavender Dream: Purple/violet
 *
 * Color Format:
 * Uses oklch() for consistent perceived brightness across hues.
 *
 * @module lib/themes
 */

export const DEFAULT_THEME = {
    preset: "default",
    radius: "default",
    scale: "none",
    contentLayout: "full"
} as const;

export type ThemeType = typeof DEFAULT_THEME;

export const THEMES = [
    {
        name: "Default",
        value: "default",
        colors: ["oklch(0.33 0 0)"]
    },
    {
        name: "Underground",
        value: "underground",
        colors: ["oklch(0.5315 0.0694 156.19)"]
    },
    {
        name: "Rose Garden",
        value: "rose-garden",
        colors: ["oklch(0.5827 0.2418 12.23)"]
    },
    {
        name: "Lake View",
        value: "lake-view",
        colors: ["oklch(0.765 0.177 163.22)"]
    },
    {
        name: "Sunset Glow",
        value: "sunset-glow",
        colors: ["oklch(0.5827 0.2187 36.98)"]
    },
    {
        name: "Forest Whisper",
        value: "forest-whisper",
        colors: ["oklch(0.5276 0.1072 182.22)"]
    },
    {
        name: "Ocean Breeze",
        value: "ocean-breeze",
        colors: ["oklch(0.59 0.20 277.12)"]
    },
    {
        name: "Lavender Dream",
        value: "lavender-dream",
        colors: ["oklch(0.71 0.16 293.54)"]
    }
];
