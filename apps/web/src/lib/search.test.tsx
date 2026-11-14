import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { validateNewExpenseSearch } from '@/features/expenses/search-params'
import { validateGroupListSearch, validateMoneySearch } from '@/features/insights/search-params'
import { booleanParam, stringParam, textValue } from './search'

// The router restores scroll on navigation; jsdom has no layout to scroll.
window.scrollTo = () => {}

/** Opens `url` on a route validated by `validate` and shows what `useSearch()` hands the screen. */
async function searchAt(url: string, validate: (search: Record<string, unknown>) => object) {
  const rootRoute = createRootRoute()
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/page',
    validateSearch: validate,
    component: function Page() {
      const search = page.useSearch() as Record<string, unknown>
      const shown = Object.entries(search)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => `${key}:${typeof value}:${String(value)}`)
      return <output aria-label="search">{shown.join(' ')}</output>
    },
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  cleanup()
  render(<RouterProvider router={router as never} />)
  return (await screen.findByRole('status', { name: 'search' })).textContent
}

describe('search params', () => {
  it('reads numbers and booleans the address parsed back as text', () => {
    expect(textValue('pizza')).toBe('pizza')
    expect(textValue(30)).toBe('30')
    expect(textValue(42.35)).toBe('42.35')
    expect(textValue(true)).toBe('true')
    expect(textValue(Number.NaN)).toBeUndefined()
    expect(textValue({ a: 1 })).toBeUndefined()
    expect(textValue(null)).toBeUndefined()
  })

  it('gives a search for a number to the screen as text', async () => {
    expect(await searchAt('/page?q=30', validateMoneySearch)).toBe('q:string:30')
    expect(await searchAt('/page?q=42.35', validateMoneySearch)).toBe('q:string:42.35')
  })

  it('never lets a dropped value through from the address', async () => {
    // The router lays validated params over the raw ones: a key left out would show the raw value.
    expect(
      await searchAt('/page?q=%7B%22a%22%3A1%7D&kind=7&groupId=12&cats=3', validateMoneySearch),
    ).toBe('')
    expect(await searchAt('/page?person=5&from=20260101', validateGroupListSearch)).toBe('')
    expect(await searchAt('/page?preset=5', validateNewExpenseSearch)).toBe('')
    expect(await searchAt('/page?new=1', booleanParam('new'))).toBe('')
    expect(await searchAt('/page?token=%5B1%5D', stringParam('token'))).toBe('')
  })

  it('keeps good values', async () => {
    expect(await searchAt('/page?new=true', booleanParam('new'))).toBe('new:boolean:true')
    expect(await searchAt('/page?redirect=%2Fhome', stringParam('redirect'))).toBe(
      'redirect:string:/home',
    )
  })
})
