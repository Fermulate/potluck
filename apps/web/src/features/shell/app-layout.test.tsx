import type * as AuthModule from '@/lib/auth'
import { moneyKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { QueryClient } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, emitChange, resetDb, subscribedTables } from '@/test/supabase'
import { AppLayout } from './app-layout'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function seed(unread = 0) {
  resetDb({
    tables: {
      profiles: [{ id: VIEWER, display_name: 'Ava Chen', avatar_path: null }],
      notifications: Array.from({ length: unread }, (_, i) => ({
        id: `n-${i}`,
        user_id: VIEWER,
        read_at: null,
      })),
    },
  })
}

function navs() {
  return screen.findAllByRole('navigation', { name: t('nav.main') })
}

describe('AppLayout', () => {
  beforeEach(() => seed())

  it('offers every section in the rail and the tab bar, marking where you are', async () => {
    renderWithProviders(<AppLayout />, { path: '/groups' })
    const [rail, tabs] = await navs()
    expect(within(rail!).getByRole('link', { name: t('nav.notifications') })).toHaveAttribute(
      'href',
      '/notifications',
    )
    expect(within(rail!).getByRole('link', { name: t('nav.groups') })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(tabs!).getByRole('link', { name: t('nav.groups') })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(within(tabs!).getByRole('link', { name: t('nav.home') })).not.toHaveAttribute(
      'aria-current',
    )
    expect(await screen.findByRole('link', { name: /Ava Chen/ })).toHaveAttribute('href', '/me')
  })

  it('counts unread notifications on the inbox, and on Me in the tab bar as notifications', async () => {
    seed(3)
    renderWithProviders(<AppLayout />, { path: '/notifications' })
    const [rail, tabs] = await navs()
    expect(
      await within(rail!).findByRole('link', { name: `${t('nav.notifications')} (3)` }),
    ).toHaveAttribute('aria-current', 'page')
    expect(
      within(tabs!).getByRole('link', {
        name: `${t('nav.me')} (${t('nav.unreadNotifications', { count: 3 })})`,
      }),
    ).toHaveAttribute('aria-current', 'page')
  })

  it('opens quick add for the group on screen', async () => {
    renderWithProviders(<AppLayout />, { path: '/groups/$groupId', url: '/groups/g-hike' })
    await navs()
    const [railAdd, tabAdd] = screen.getAllByRole('button', { name: t('nav.add') })
    expect(tabAdd).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(railAdd!)
    const sheet = await screen.findByRole('dialog', { name: t('nav.quickAdd.title') })
    expect(within(sheet).getByRole('link', { name: /Add expense/ })).toHaveAttribute(
      'href',
      '/new/expense?groupId=g-hike',
    )
  })

  it('opens quick add without an archived group, which takes nothing new', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    })
    client.setQueryData(moneyKeys.groupInfo('g-old'), {
      id: 'g-old',
      archived_at: '2026-11-01T00:00:00Z',
    })
    renderWithProviders(<AppLayout />, { path: '/groups/$groupId', url: '/groups/g-old', client })
    await navs()
    fireEvent.click(screen.getAllByRole('button', { name: t('nav.add') })[0]!)
    const sheet = await screen.findByRole('dialog', { name: t('nav.quickAdd.title') })
    expect(within(sheet).getByRole('link', { name: /Add expense/ })).toHaveAttribute(
      'href',
      '/new/expense',
    )
  })

  it('marks plans and home as you move around', async () => {
    renderWithProviders(<AppLayout />, { path: '/plans' })
    const [, tabs] = await navs()
    expect(within(tabs!).getByRole('link', { name: t('nav.plans') })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('keeps the unread badge live', async () => {
    renderWithProviders(<AppLayout />, { path: '/home' })
    const [rail] = await navs()
    expect(within(rail!).getByRole('link', { name: t('nav.home') })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await waitFor(() => expect(subscribedTables()).toContain('notifications'))
    db().respond('from:notifications', { count: 1 })
    emitChange('notifications')
    expect(
      await within(rail!).findByRole('link', { name: `${t('nav.notifications')} (1)` }),
    ).toBeInTheDocument()
  })
})
