import { t } from '@potluck/i18n'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RouteError } from './route-error'
import { routerFallbacks } from './router-options'

// The router restores scroll on navigation; jsdom has no layout to scroll.
window.scrollTo = () => {}

let broken = true

function renderBrokenScreen() {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <nav aria-label="Main">frame</nav>
        <Outlet />
      </>
    ),
    errorComponent: RouteError,
  })
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/search',
    component: function Search() {
      if (broken) throw new TypeError('e.query?.trim is not a function')
      return <p>Results</p>
    },
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([screenRoute]),
    history: createMemoryHistory({ initialEntries: ['/search'] }),
    ...routerFallbacks,
  })
  return render(<RouterProvider router={router as never} />)
}

describe('RouteError', () => {
  beforeEach(() => {
    broken = true
    // React and the router report the caught error; the test expects it.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows our own page inside the app frame instead of the bare router screen', async () => {
    renderBrokenScreen()
    expect(
      await screen.findByRole('heading', { level: 1, name: t('errors.screen.title') }),
    ).toBeInTheDocument()
    expect(screen.getByText(t('errors.screen.body'))).toBeInTheDocument()
    expect(screen.queryByText('Something went wrong!')).toBeNull()
    // The rest of the app is still there.
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('errors.screen.home') })).toHaveAttribute(
      'href',
      '/home',
    )
  })

  it('tries the screen again', async () => {
    renderBrokenScreen()
    const retry = await screen.findByRole('button', { name: t('common.retry') })
    broken = false
    fireEvent.click(retry)
    expect(await screen.findByText('Results')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t('errors.screen.title') })).toBeNull()
  })
})

describe('RouteNotFound', () => {
  it('gives an unknown address a page with a way home', async () => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const homeRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/home',
      component: () => <p>Home</p>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([homeRoute]),
      history: createMemoryHistory({ initialEntries: ['/nowhere'] }),
      ...routerFallbacks,
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<RouterProvider router={router as never} />)
    expect(
      await screen.findByRole('heading', { level: 1, name: t('errors.notFound') }),
    ).toBeInTheDocument()
    expect(screen.getByText(t('errors.notFoundBody'))).toBeInTheDocument()
    expect(screen.queryByText('Not Found')).toBeNull()
    fireEvent.click(screen.getByRole('link', { name: t('errors.screen.home') }))
    expect(await screen.findByText('Home')).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('takes the whole page for a miss under a layout, as the app sets the router up', async () => {
    const rootRoute = createRootRoute({ component: () => <Outlet /> })
    const groupRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/groups/$groupId',
      component: () => (
        <main id="main">
          <nav aria-label="Group">tabs</nav>
          <Outlet />
        </main>
      ),
    })
    const expensesRoute = createRoute({
      getParentRoute: () => groupRoute,
      path: '/',
      component: () => <p>Expenses</p>,
    })
    const router = createRouter({
      routeTree: rootRoute.addChildren([groupRoute.addChildren([expensesRoute])]),
      history: createMemoryHistory({ initialEntries: ['/groups/g-hike/bogus'] }),
      ...routerFallbacks,
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    render(<RouterProvider router={router as never} />)
    expect(
      await screen.findByRole('heading', { level: 1, name: t('errors.notFound') }),
    ).toBeInTheDocument()
    // One main landmark, and none of the group's frame around the page.
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: 'Group' })).toBeNull()
    vi.restoreAllMocks()
  })
})
