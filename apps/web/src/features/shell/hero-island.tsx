import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HeroDemo } from './hero-demo'

/**
 * Brings the demo to life inside the prerendered landing page, which is otherwise left exactly
 * as the HTML delivered it (see main.tsx). The demo replaces its empty placeholder, which has
 * the same frame, so nothing moves.
 */
export function mountHeroDemo() {
  const slot = document.querySelector('[data-hero-slot]')?.parentElement
  if (!slot) return
  createRoot(slot).render(
    <StrictMode>
      <HeroDemo />
    </StrictMode>,
  )
}
