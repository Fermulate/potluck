import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { viewerProfile } from '@/test/plan-fixtures'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { PlansPage } from './plans-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const DAY = 86_400_000
const at = (days: number, hours = 0) => new Date(Date.now() + days * DAY + hours * 3_600_000)

function item(overrides: Record<string, unknown>) {
  return {
    event_id: 'ev',
    group_id: 'g-hike',
    group_name: 'Hike crew',
    group_emoji: '🥾',
    group_color: 'olive',
    title: 'Plan',
    emoji: null,
    status: 'polling',
    starts_at: null,
    ends_at: null,
    window_start: '2026-11-10',
    window_end: '2026-11-12',
    location: null,
    going_count: 0,
    availability_requested: false,
    availability_submitted: false,
    my_rsvp: null,
    rsvp_deadline: null,
    timezone: 'UTC',
    ...overrides,
  }
}

const timeline = [
  item({ event_id: 'ev-poll', title: 'Taco night', emoji: '🌮' }),
  item({
    event_id: 'ev-wait',
    title: 'Board games',
    group_id: 'g-flat',
    group_name: 'Flat 4B',
    group_emoji: '🏠',
    availability_submitted: true,
  }),
  item({
    event_id: 'ev-hike',
    title: 'Sunset hike',
    status: 'scheduled',
    starts_at: at(3).toISOString(),
    ends_at: at(3, 2).toISOString(),
    location: 'Twin Peaks',
  }),
  item({
    event_id: 'ev-brunch',
    title: 'Brunch',
    status: 'scheduled',
    starts_at: at(4).toISOString(),
    ends_at: at(4, 2).toISOString(),
    my_rsvp: 'going',
    going_count: 3,
  }),
  item({
    event_id: 'ev-ended',
    title: 'Pub quiz',
    status: 'scheduled',
    starts_at: at(-1, -3).toISOString(),
    ends_at: at(-1, -1).toISOString(),
    my_rsvp: 'going',
  }),
]

function seed(items = timeline, past = true) {
  const fake = resetDb({
    tables: {
      profiles: [viewerProfile],
      groups: [
        {
          id: 'g-hike',
          name: 'Hike crew',
          emoji: '🥾',
          is_direct: false,
          archived_at: null,
          group_members: [{ count: 4 }],
        },
        {
          id: 'g-flat',
          name: 'Flat 4B',
          emoji: '🏠',
          is_direct: false,
          archived_at: null,
          group_members: [{ count: 2 }],
        },
      ],
      events: past
        ? [
            {
              id: 'ev-old',
              group_id: 'g-hike',
              title: 'Picnic',
              status: 'done',
              starts_at: at(-30).toISOString(),
              ends_at: at(-30, 3).toISOString(),
              window_start: '2026-10-01',
              window_end: '2026-10-03',
              group: { name: 'Hike crew', emoji: '🥾', color: 'olive' },
            },
          ]
        : [],
    },
  })
  fake.respond('rpc:my_timeline', { data: items })
}

function section(name: string) {
  return screen.getByRole('heading', { name: new RegExp(`^${name}`) }).closest('section')!
}

describe('PlansPage', () => {
  beforeEach(() => seed())

  it('sorts plans into polls to answer, coming up, waiting and past', async () => {
    renderWithProviders(<PlansPage />, { path: '/plans' })
    const poll = await screen.findByRole('link', { name: /Taco night/ })
    expect(poll).toHaveAttribute('href', '/plans/ev-poll')
    expect(within(poll).getByText(t('events.card.addTimes'))).toBeInTheDocument()

    const upcoming = section(t('events.sections.upcoming'))
    expect(within(upcoming).getByRole('link', { name: /Sunset hike/ })).toHaveTextContent(
      t('timeline.needsRsvp'),
    )
    expect(within(upcoming).getByRole('link', { name: /Brunch/ })).toHaveTextContent(
      t('events.card.going', { count: 3 }),
    )
    expect(within(upcoming).getByText(/Twin Peaks/)).toBeInTheDocument()

    expect(
      within(section(t('events.sections.waiting'))).getByRole('link', { name: /Board games/ }),
    ).toHaveTextContent(t('timeline.polling'))

    const past = section(t('events.sections.past'))
    await within(past).findByRole('link', { name: /Picnic/ })
    expect(
      within(past)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual([expect.stringContaining('Pub quiz'), expect.stringContaining('Picnic')])
    expect(db().rpcArgs('my_timeline')).toHaveLength(1)
  })

  it('filters by group and starts new plans in it', async () => {
    renderWithProviders(<PlansPage />, { path: '/plans' })
    const filters = await screen.findByRole('group', { name: t('events.filters.label') })
    fireEvent.click(within(filters).getByRole('button', { name: /Flat 4B/ }))

    await waitFor(() =>
      expect(screen.queryByRole('link', { name: /Taco night/ })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('link', { name: /Board games/ })).toBeInTheDocument()
    expect(screen.getByText(t('timeline.empty.body'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('events.new') })).toHaveAttribute(
      'href',
      '/new/plan?groupId=g-flat',
    )

    fireEvent.click(within(filters).getByRole('button', { name: /Flat 4B/ }))
    expect(await screen.findByRole('link', { name: /Taco night/ })).toBeInTheDocument()
  })

  it('invites you to plan something when the calendar is empty', async () => {
    seed([], false)
    renderWithProviders(<PlansPage />, { path: '/plans' })
    expect(await screen.findByText(t('empty.plans.title'))).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: t('events.new') })[0]).toHaveAttribute(
      'href',
      '/new/plan',
    )
  })

  it('says when nothing has happened yet', async () => {
    seed([timeline[0]!], false)
    renderWithProviders(<PlansPage />, { path: '/plans' })
    expect(await screen.findByText(t('events.emptyPast'))).toBeInTheDocument()
  })
})
