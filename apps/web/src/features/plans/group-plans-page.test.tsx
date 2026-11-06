import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { planEvent, viewerProfile } from '@/test/plan-fixtures'
import { renderWithProviders } from '@/test/render'
import { db, emitChange, resetDb } from '@/test/supabase'
import { GroupPlansPage } from './group-plans-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const DAY = 86_400_000
const at = (days: number) => new Date(Date.now() + days * DAY).toISOString()

const events = [
  planEvent({ id: 'ev-poll', title: 'Taco night' }),
  planEvent({ id: 'ev-quiz', title: 'Quiz night' }),
  planEvent({
    id: 'ev-hike',
    title: 'Sunset hike',
    status: 'scheduled',
    starts_at: at(0.5),
    ends_at: at(0.6),
    location: 'Twin Peaks',
  }),
  planEvent({
    id: 'ev-ski',
    title: 'Ski trip',
    status: 'scheduled',
    starts_at: at(10),
    ends_at: at(12),
  }),
  planEvent({ id: 'ev-off', title: 'Karaoke', status: 'cancelled' }),
  planEvent({
    id: 'ev-done',
    title: 'Picnic',
    status: 'done',
    starts_at: at(-20),
    ends_at: at(-19.9),
  }),
]

function seed(rows = events) {
  const fake = resetDb({ tables: { profiles: [viewerProfile], events: rows } })
  // The viewer's timeline knows they still owe times on the taco poll.
  fake.respond('rpc:my_timeline', {
    data: [
      {
        event_id: 'ev-poll',
        group_id: 'g-hike',
        title: 'Taco night',
        status: 'polling',
        window_start: '2026-11-10',
        window_end: '2026-11-12',
        availability_submitted: false,
      },
    ],
  })
}

function section(name: string) {
  return screen.getByRole('heading', { name }).closest('section')!
}

describe('GroupPlansPage', () => {
  beforeEach(() => seed())

  it("lays out the group's polls, calendar and past plans", async () => {
    renderWithProviders(<GroupPlansPage groupId="g-hike" />, { path: '/groups/g-hike/plans' })
    const polls = await screen.findByRole('heading', { name: t('events.sections.groupPolls') })
    const pollSection = polls.closest('section')!
    expect(await within(pollSection).findByText(t('events.card.addTimes'))).toBeInTheDocument()
    expect(within(pollSection).getByRole('link', { name: /Quiz night/ })).toHaveTextContent(
      t('timeline.polling'),
    )

    const calendar = section(t('events.sections.groupTimeline'))
    const hike = within(calendar).getByRole('link', { name: /Sunset hike/ })
    expect(hike).toHaveTextContent(/Twin Peaks/)
    expect(within(calendar).getByRole('link', { name: /Ski trip/ })).toBeInTheDocument()

    const past = section(t('events.sections.past'))
    expect(within(past).getByRole('link', { name: /Karaoke/ })).toHaveTextContent(
      t('events.status.cancelled'),
    )
    expect(within(past).getByRole('link', { name: /Picnic/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('events.new') })).toHaveAttribute(
      'href',
      '/new/plan?groupId=g-hike',
    )
  })

  it('suggests planning something when the group has nothing', async () => {
    seed([])
    renderWithProviders(<GroupPlansPage groupId="g-hike" />, { path: '/groups/g-hike/plans' })
    expect(await screen.findByText(t('events.emptyGroup.title'))).toBeInTheDocument()
  })

  it('shows an empty calendar line when nothing is scheduled', async () => {
    seed([events[1]!])
    renderWithProviders(<GroupPlansPage groupId="g-hike" />, { path: '/groups/g-hike/plans' })
    expect(await screen.findByText(t('timeline.empty.body'))).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: t('events.sections.past') }),
    ).not.toBeInTheDocument()
  })

  it('refetches when a plan in the group changes', async () => {
    renderWithProviders(<GroupPlansPage groupId="g-hike" />, { path: '/groups/g-hike/plans' })
    await screen.findByRole('link', { name: /Quiz night/ })
    const before = db().queries('events').length
    emitChange('events', 'UPDATE')
    await waitFor(() => expect(db().queries('events').length).toBeGreaterThan(before))
  })

  it('keeps refetching after another copy of the page on the same group closes', async () => {
    const first = renderWithProviders(<GroupPlansPage groupId="g-hike" />, {
      path: '/groups/g-hike/plans',
    })
    renderWithProviders(<GroupPlansPage groupId="g-hike" />, { path: '/groups/g-hike/plans' })
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Quiz night/ })).toHaveLength(2))
    first.unmount()
    const before = db().queries('events').length
    emitChange('events', 'UPDATE')
    await waitFor(() => expect(db().queries('events').length).toBeGreaterThan(before))
  })
})
