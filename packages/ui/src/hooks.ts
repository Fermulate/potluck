import { useEffect, useState, useSyncExternalStore } from 'react'

/** Subscribes to a media query. Returns false during SSR and in old browsers. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      const mql = window.matchMedia(query)
      mql.addEventListener?.('change', onChange)
      return () => mql.removeEventListener?.('change', onChange)
    },
    () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(query).matches,
    () => false,
  )
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)')
}

/** True when the viewport is wide enough for desktop layouts (md and up). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 48rem)')
}

/** Becomes true only after `active` has stayed true for `delayMs`. */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!active) return
    const id = window.setTimeout(() => setShown(true), delayMs)
    return () => {
      window.clearTimeout(id)
      setShown(false)
    }
  }, [active, delayMs])
  return active && shown
}
