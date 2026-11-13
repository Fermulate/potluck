import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { group, groupTables, VIEWER } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'
import { db, payloadOf, resetDb, rowsOf } from '@/test/supabase'
import { NotificationsPage } from './notifications-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

function notification(id: string, type: string, data: object, read_at: string | null = null) {
  return { id, user_id: VIEWER, type, data, read_at, created_at: '2026-11-04T12:00:00Z' }
}

const expenseAdded = notification('n-1', 'expense.created', {
  actor_id: 'u-ben',
  group_id: 'g-hike',
  expense_id: 'e-9',
  description: 'Trail snacks',
  amount_cents: 2450,
  currency: 'USD',
})
const joined = notification('n-2', 'member.joined', { actor_id: 'u-cleo', group_id: 'g-hike' })
const oldPlan = notification(
  'n-3',
  'event.cancelled',
  { event_id: 'ev-1', event_title: 'Taco night' },
  '2026-11-03T00:00:00Z',
)

function seed(notifications = [expenseAdded, joined, oldPlan]) {
  resetDb({
    tables: {
      ...groupTables(group()),
      notifications,
      profiles: [
        { id: 'u-ben', display_name: 'Ben Ortiz', avatar_path: null, deleted_at: null },
        { id: 'u-cleo', display_name: 'Cleo Park', avatar_path: null, deleted_at: null },
      ],
    },
  })
}

function readUpdates() {
  return db()
    .queries('notifications')
    .filter((call) => payloadOf(call, 'update'))
}

describe('NotificationsPage', () => {
  beforeEach(() => seed())

  it('splits new from earlier and names who did what where', async () => {
    renderWithProviders(<NotificationsPage />, { path: '/notifications' })
    const fresh = await screen.findByRole('region', { name: t('notifications.new') })
    expect(await within(fresh).findByText('Ben added Trail snacks: $24.50')).toBeInTheDocument()
    expect(within(fresh).getByText('New expense in Hike crew')).toBeInTheDocument()
    expect(within(fresh).getByText('New face in Hike crew')).toBeInTheDocument()
    expect(within(fresh).getAllByText(t('notifications.unreadLabel'))).toHaveLength(2)

    const earlier = screen.getByRole('region', { name: t('notifications.earlier') })
    expect(within(earlier).getByText('Taco night was called off')).toBeInTheDocument()
    expect(screen.getByText(t('notifications.unread', { count: 2 }))).toBeInTheDocument()
  })

  it('marks a notification read when opened and follows its link', async () => {
    const { router } = renderWithProviders(<NotificationsPage />, { path: '/notifications' })
    fireEvent.click(await screen.findByRole('button', { name: /New expense in Hike crew/ }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/expenses/e-9'))
    const [update] = readUpdates()
    expect(update?.ops).toContainEqual({ method: 'in', args: ['id', ['n-1']] })
    expect(rowsOf('notifications').find((n) => n.id === 'n-1')?.read_at).toEqual(expect.any(String))
  })

  it('opens read notifications without marking them again', async () => {
    const { router } = renderWithProviders(<NotificationsPage />, { path: '/notifications' })
    fireEvent.click(await screen.findByRole('button', { name: /Plans changed/ }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/plans/ev-1'))
    expect(readUpdates()).toEqual([])
  })

  it('marks everything read at once', async () => {
    renderWithProviders(<NotificationsPage />, { path: '/notifications' })
    fireEvent.click(await screen.findByRole('button', { name: t('notifications.markAllRead') }))

    expect(await screen.findByText(t('notifications.allCaughtUp'))).toBeInTheDocument()
    const [update] = readUpdates()
    expect(update?.ops).toContainEqual({ method: 'eq', args: ['user_id', VIEWER] })
    expect(
      screen.queryByRole('button', { name: t('notifications.markAllRead') }),
    ).not.toBeInTheDocument()
  })

  it('brings the unread dot back if marking read fails', async () => {
    renderWithProviders(<NotificationsPage />, { path: '/notifications' })
    await screen.findByRole('button', { name: t('notifications.markAllRead') })
    db().respond('from:notifications', (call) =>
      payloadOf(call, 'update')
        ? { error: { message: 'Server error' } }
        : { data: [expenseAdded, joined, oldPlan] },
    )
    fireEvent.click(screen.getByRole('button', { name: t('notifications.markAllRead') }))
    await waitFor(() =>
      expect(screen.getByText(t('notifications.unread', { count: 2 }))).toBeInTheDocument(),
    )
    expect(readUpdates()).toHaveLength(1)
  })

  it('names the seat whose invite someone else sent to a new address', async () => {
    resetDb({
      tables: {
        ...groupTables(group()),
        notifications: [
          notification('n-4', 'member.invite_changed', {
            actor_id: 'u-ben',
            group_id: 'g-hike',
            user_id: 'p-sam',
          }),
        ],
        profiles: [
          { id: 'u-ben', display_name: 'Ben Ortiz', avatar_path: null, deleted_at: null },
          { id: 'p-sam', display_name: 'Sam Lee', avatar_path: null, deleted_at: null },
        ],
      },
    })
    renderWithProviders(<NotificationsPage />, { path: '/notifications' })
    expect(await screen.findByText("Ben sent Sam's invite to a new address")).toBeInTheDocument()
  })

  it('has a friendly empty state', async () => {
    seed([])
    renderWithProviders(<NotificationsPage />, { path: '/notifications' })
    expect(await screen.findByText(t('empty.notifications.title'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('empty.notifications.action') })).toHaveAttribute(
      'href',
      '/home',
    )
    expect(screen.getByText(t('notifications.allCaughtUp'))).toBeInTheDocument()
  })
})
