import { QueryClientProvider } from '@tanstack/react-query'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouteError } from '@/features/shell/route-error'
import { startLanguage } from '@/lib/language'
import { queryClient } from '@/lib/query-client'
import { initTheme } from '@/styles/theme-preference'
import { installTokens } from '@/styles/tokens'
import { routeTree } from './routeTree.gen'
import '@/styles/fonts'
import './index.css'

installTokens()
initTheme()

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // A screen that throws shows our own page, with a retry and a way home, in place of the
  // router's unstyled default.
  defaultErrorComponent: RouteError,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element #root not found')

if (document.getElementById('prerender') && document.documentElement.dataset.boot !== 'app') {
  // A signed-out visit to /: the landing page is already in the HTML (prerender-landing.ts).
  // Rendering it again would replace every node and repaint the page, so it stays as delivered;
  // only the animated demo needs React. Its links are plain links into the app.
  void import('@/features/shell/hero-island').then((m) => m.mountHeroDemo())
} else {
  // A language other than English downloads its strings before the first paint.
  void startLanguage().then(() =>
    createRoot(rootElement).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    ),
  )
}
