import { onTestFinished } from 'vitest'

/** Makes `(prefers-reduced-motion: reduce)` match for the rest of the current test. */
export function preferReducedMotion() {
  const original = window.matchMedia
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion: reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia
  onTestFinished(() => {
    window.matchMedia = original
  })
}
