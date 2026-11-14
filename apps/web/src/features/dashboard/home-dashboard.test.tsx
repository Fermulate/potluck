import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { viewerProfile } from '@/test/plan-fixtures'
import { renderWithProviders } from '@/test/render'
import { resetDb, rowsOf } from '@/test/supabase'
import { HomeDashboard } from './home-dashboard'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const DAY = 86_400_000
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString()

const timeline = [
  {
    event_id: 'ev-poll',
    group_id: 'g-hike',
    group_name: 'Hike crew',
    group_emoji: '🥾',
    title: 'Taco night',
    emoji: '🌮',
    status: 'polling',
    window_start: '2026-11-10',
    window_end: '2026-11-12',
    availability_submitted: false,
    availability_requested: true,
  },
  {
    event_id: 'ev-hike',
    group_id: 'g-hike',
    group_name: 'Hike crew',
    group_emoji: '🥾',
    title: 'Sunset hike',
    emoji: null,
    status: 'scheduled',
    starts_at: at(2),
    ends_at: at(2.1),
    window_start: '2026-11-10',
    window_end: '2026-11-12',
    my_rsvp: null,
    going_count: 2,
  },
]

const groupRows = [
  {
    id: 'g-hike',
    name: 'Hike crew',
    emoji: '🥾',
    currency: 'USD',
    is_direct: false,
    archived_at: null,
    group_members: [{ count: 4 }],
  },
  {
    id: 'g-flat',
    name: 'Flat 4B',
    emoji: null,
    currency: 'USD',
    is_direct: false,
    archived_at: null,
    group_members: [{ count: 2 }],
  },
  {
    id: 'g-paris',
    name: 'Paris',
    emoji: '🥐',
    currency: 'EUR',
    is_direct: false,
    archived_at: null,
    group_members: [{ count: 3 }],
  },
  {
    id: 'g-london',
    name: 'London',
    emoji: null,
    currency: 'GBP',
    is_direct: false,
    archived_at: null,
    group_members: [{ count: 2 }],
  },
  {
    id: 'g-jules',
    name: 'Direct',
    emoji: null,
    currency: 'USD',
    is_direct: true,
    archived_at: null,
    group_members: [
      { profiles: { id: VIEWER, display_name: 'Ava' } },
      { profiles: { id: 'u-jules', display_name: 'Jules Park' } },
    ],
  },
]

function seed({ items = timeline as object[], balances = true } = {}) {
  const fake = resetDb({
    tables: {
      profiles: [viewerProfile],
      groups: groupRows,
      group_balances: balances
        ? [
            { user_id: VIEWER, group_id: 'g-hike', net_cents: -6051 },
            { user_id: VIEWER, group_id: 'g-flat', net_cents: 2500 },
            { user_id: VIEWER, group_id: 'g-paris', net_cents: 1200 },
            { user_id: VIEWER, group_id: 'g-london', net_cents: -500 },
            { user_id: VIEWER, group_id: 'g-jules', net_cents: 300 },
          ]
        : [],
      event_rsvps: [],
    },
  })
  fake.respond('rpc:my_timeline', { data: items })
}

describe('HomeDashboard', () => {
  beforeEach(() => seed())

  it('greets you and adds up what you owe across groups', async () => {
    renderWithProviders(<HomeDashboard />, { path: '/home' })
    expect(await screen.findByRole('heading', { level: 1, name: /Ava/ })).toBeInTheDocument()
    const hero = await screen.findByRole('region', { name: t('home.balance.title') })
    expect(within(hero).getByText(t('home.balance.headlineOwe'))).toBeInTheDocument()
    expect(within(hero).getByText('You owe $32.51')).toBeInTheDocument()
    expect(within(hero).getByRole('link', { name: /Hike crew/ })).toHaveAttribute(
      'href',
      '/groups/g-hike',
    )
    // A one-on-one tab goes by the friend, never its stored name.
    expect(within(hero).getByRole('link', { name: /Jules Park/ })).toHaveAttribute(
      'href',
      '/groups/g-jules',
    )
    expect(within(hero).queryByText('Direct')).not.toBeInTheDocument()
    // Every other currency with its amounts, never converted.
    expect(
      within(hero).getByText(
        t('home.balance.otherTotals', {
          list: `${t('home.balance.otherOwed', { amount: '€12.00' })} ${t('common.and')} ${t('home.balance.otherOwe', { amount: '£5.00' })}`,
        }),
      ),
    ).toBeInTheDocument()
  })

  it('lists what needs you, with RSVP right there', async () => {
    renderWithProviders(<HomeDashboard />, { path: '/home' })
    expect(await screen.findByText(t('home.summary.some', { count: 2 }))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('home.needsTimes') })).toHaveAttribute(
      'href',
      '/plans/ev-poll',
    )
    const rsvp = screen.getByRole('group', { name: t('home.needsRsvp') })
    fireEvent.click(within(rsvp).getByRole('button', { name: t('rsvp.short.going') }))
    await waitFor(() =>
      expect(rowsOf('event_rsvps')).toEqual([
        { event_id: 'ev-hike', user_id: VIEWER, status: 'going' },
      ]),
    )
  })

  it('shows what is coming up and your groups', async () => {
    renderWithProviders(<HomeDashboard />, { path: '/home' })
    const upcoming = (await screen.findByRole('heading', { name: t('timeline.title') })).closest(
      'section',
    )!
    expect(await within(upcoming).findByRole('link', { name: /Sunset hike/ })).toHaveAttribute(
      'href',
      '/plans/ev-hike',
    )
    const groups = screen.getByRole('heading', { name: t('home.groups') }).closest('section')!
    expect(await within(groups).findByRole('link', { name: /Hike crew/ })).toHaveTextContent(
      t('home.members', { count: 4 }),
    )
    expect(within(groups).getByRole('link', { name: /Flat 4B/ })).toHaveTextContent('F')
    expect(within(groups).getByRole('link', { name: t('home.newGroup') })).toHaveAttribute(
      'href',
      '/groups',
    )
  })

  it('is calm when nothing needs you and everyone is square', async () => {
    seed({ items: [], balances: false })
    renderWithProviders(<HomeDashboard />, { path: '/home' })
    expect(await screen.findByText(t('home.summary.none'))).toBeInTheDocument()
    expect(await screen.findByText(t('home.balance.settledHint'))).toBeInTheDocument()
    expect(screen.getByText(t('timeline.empty.title'))).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: t('home.needsYou') })).not.toBeInTheDocument()
  })

  it('celebrates being owed', async () => {
    resetDb({
      tables: {
        profiles: [viewerProfile],
        groups: groupRows,
        group_balances: [{ user_id: VIEWER, group_id: 'g-flat', net_cents: 2500 }],
      },
    })
    renderWithProviders(<HomeDashboard />, { path: '/home' })
    const hero = await screen.findByRole('region', { name: t('home.balance.title') })
    expect(within(hero).getByText(t('home.balance.headlineOwed'))).toBeInTheDocument()
  })
})
