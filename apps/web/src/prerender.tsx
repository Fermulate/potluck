/**
 * Build-time render of the landing page (see prerender-landing.ts). Runs in Node, never in the
 * browser bundle. The client still renders the page itself; this HTML only lets the headline
 * paint before the scripts arrive.
 */
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { LandingPage } from '@/features/shell/landing-page'
import { tokensStylesheet } from '@/styles/tokens'

/** The token variables main.tsx installs at startup, so the first paint already has them. */
export const tokensCss = tokensStylesheet

export async function renderLanding(): Promise<string> {
  const router = createRouter({
    routeTree: createRootRoute({ component: LandingPage }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
