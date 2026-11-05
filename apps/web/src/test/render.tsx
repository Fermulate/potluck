import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'

// The router restores scroll on navigation; jsdom has no layout to scroll.
window.scrollTo = () => {}

/**
 * Renders `ui` at `path` inside a throwaway router and query client, so components that use
 * `Link`, `useNavigate` or `useQuery` work. Navigations land on a catch-all route whose
 * pathname is exposed through `router.state.location`.
 */
export function renderWithProviders(ui: ReactNode, { path = '/' }: { path?: string } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
  const rootRoute = createRootRoute({ component: () => <Outlet /> })
  const start = createRoute({ getParentRoute: () => rootRoute, path, component: () => <>{ui}</> })
  const elsewhere = createRoute({
    getParentRoute: () => rootRoute,
    path: '$',
    component: () => <p>elsewhere</p>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([start, elsewhere]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  )
  return { ...result, router, queryClient }
}
