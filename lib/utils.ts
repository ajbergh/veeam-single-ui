/**
 * Utility Functions
 *
 * Common utility functions used throughout the application.
 *
 * Functions:
 * - cn: Tailwind CSS class name merger using clsx + tailwind-merge
 *
 * @module lib/utils
 */

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merge class names with Tailwind CSS conflict resolution.
 * Combines clsx for conditional classes with tailwind-merge for proper
 * Tailwind class precedence (e.g., 'px-2 px-4' → 'px-4').
 *
 * @param inputs - Class values (strings, objects, arrays)
 * @returns Merged class string
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
