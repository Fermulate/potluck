import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from '@tanstack/react-router'
import { render } from '@testing-library/react'
import { createElement, type ReactElement } from 'react'
import { seededClient } from './test-utils'

/** Renders `ui` as the only route of a memory router, for components that use `Link`. */
export function renderInRouter(ui: ReactElement, client: QueryClient = seededClient()) {
  const rootRoute = createRootRoute({ component: () => ui })
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return {
    client,
    router,
    ...render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(RouterProvider, { router: router as never }),
      ),
    ),
  }
}
