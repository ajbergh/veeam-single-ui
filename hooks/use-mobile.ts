/**
 * Mobile Detection Hook
 *
 * React hook for detecting mobile device viewport.
 * Uses CSS media query matching for accurate detection.
 *
 * Features:
 * - Server-side safe (returns undefined during SSR)
 * - Reactive updates on window resize
 * - Configurable breakpoint (768px default)
 * - Cleanup on unmount
 *
 * Usage:
 * ```tsx
 * const isMobile = useIsMobile();
 * if (isMobile) {
 *   return <MobileLayout />;
 * }
 * ```
 *
 * @returns boolean - true if viewport < 768px, false otherwise
 * @module hooks/use-mobile
 */

import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
