import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VIEWER } from '@/test/fixtures'
import { planEvent, planMemberRows, viewerProfile } from '@/test/plan-fixtures'
import { renderWithProviders } from '@/test/render'
import { db, payloadOf, resetDb, rowsOf } from '@/test/supabase'
import { EventPage } from './event-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => VIEWER,
}))

const slot = {
  starts_at: '2026-11-11T19:00:00+00:00',
  ends_at: '2026-11-11T21:00:00+00:00',
  yes_count: 2,
  maybe_count: 0,
  score: 2,
  missing: ['u-cleo'],
}

function seed(event = planEvent(), extra: Record<string, unknown[]> = {}) {
  const fake = resetDb({
    tables: {
      profiles: [viewerProfile],
      events: [event],
      group_members: planMemberRows(),
      availability: [
        {
          event_id: 'ev-1',
          user_id: 'u-ben',
          slot_start: '2026-11-11T19:00:00+00:00',
          level: 'yes',
        },
        {
          event_id: 'ev-1',
          user_id: VIEWER,
          slot_start: '2026-11-11T19:00:00+00:00',
          level: 'yes',
        },
      ],
      availability_requests: [],
      event_rsvps: [],
      busy_blocks: [],
      comments: [
        {
          id: 'c-1',
          event_id: 'ev-1',
          author_id: 'u-ben',
          body: 'I can bring salsa',
          created_at: '2026-11-02T10:00:00Z',
          deleted_at: null,
        },
      ],
      ...extra,
    },
  })
  fake.respond('rpc:best_slots', { data: [slot] })
  return fake
}

function renderEvent() {
  return renderWithProviders(
    <>
      <EventPage eventId="ev-1" />
      <Toaster label="Notifications" />
    </>,
    { path: '/plans/$eventId', url: '/plans/ev-1' },
  )
}

describe('EventPage while polling', () => {
  beforeEach(() => {
    seed()
  })

  it('shows the plan, its details and the best time so far', async () => {
    renderEvent()
    expect(await screen.findByRole('heading', { name: 'Taco night' })).toBeInTheDocument()
    expect(screen.getByText(t('events.status.polling'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Hike crew/ })).toHaveAttribute(
      'href',
      '/groups/g-hike',
    )
    expect(
      (await screen.findAllByText(t('events.organizer', { name: 'Ava Chen' }))).length,
    ).toBeGreaterThan(0)
    expect(screen.getAllByText('Bring a topping.').length).toBeGreaterThan(0)
    expect(await screen.findByText('Without Cleo')).toBeInTheDocument()
    expect(db().rpcArgs('best_slots')).toEqual([{ event_id: 'ev-1', limit: 5 }])
  })

  it('locks in the best time', async () => {
    db().respond('rpc:schedule_event', {
      data: {
        ...planEvent(),
        status: 'scheduled',
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
      },
    })
    renderEvent()
    fireEvent.click(await screen.findByRole('button', { name: t('events.lock') }))
    const dialog = await screen.findByRole('dialog', { name: t('events.lockTitle') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('events.lock') }))

    expect(await screen.findByText(t('events.locked'))).toBeInTheDocument()
    expect(db().rpcArgs('schedule_event')).toEqual([
      { event_id: 'ev-1', starts_at: slot.starts_at },
    ])
  })

  it('nudges the people who have not answered', async () => {
    db().respond('rpc:request_availability', { data: 1 })
    renderEvent()
    expect(
      await screen.findAllByText(t('events.respondedCount', { count: 2, total: 3 })),
    ).not.toHaveLength(0)
    fireEvent.click(
      (await screen.findAllByRole('button', { name: `${t('events.nudge')} Cleo Park` }))[0]!,
    )
    expect(await screen.findByText(t('events.requestSent', { count: 1 }))).toBeInTheDocument()
    expect(db().rpcArgs('request_availability')).toEqual([
      { event_id: 'ev-1', user_ids: ['u-cleo'] },
    ])
  })

  it('switches between your times and everyone', async () => {
    renderEvent()
    const tabs = await screen.findByRole('radiogroup', { name: t('availability.heatmapTitle') })
    await waitFor(() =>
      expect(within(tabs).getByRole('radio', { name: t('events.tabs.group') })).toBeChecked(),
    )
    fireEvent.click(within(tabs).getByRole('radio', { name: t('events.tabs.mine') }))
    expect(
      await screen.findByRole('heading', { name: t('availability.title') }),
    ).toBeInTheDocument()
  })

  it('starts on your times, with a prompt, when you have not answered', async () => {
    seed(planEvent(), { availability: [] })
    renderEvent()
    expect(
      await screen.findByRole('heading', { name: t('availability.title') }),
    ).toBeInTheDocument()
    const tabs = screen.getByRole('radiogroup', { name: t('availability.heatmapTitle') })
    fireEvent.click(within(tabs).getByRole('radio', { name: t('events.tabs.group') }))
    fireEvent.click(await screen.findByRole('button', { name: t('events.card.addTimes') }))
    expect(
      await screen.findByRole('heading', { name: t('availability.title') }),
    ).toBeInTheDocument()
  })

  it('posts a comment', async () => {
    const posted: object[] = []
    db().respond('from:comments', (call) => {
      const insert = payloadOf(call, 'insert') as { body: string } | undefined
      if (insert) {
        const row = { id: 'c-2', author_id: VIEWER, created_at: '2026-11-05T09:00:00Z', ...insert }
        posted.push(row)
        return { data: row }
      }
      return { data: posted }
    })
    renderEvent()
    const box = await screen.findByRole('textbox', { name: t('events.comments.label') })
    expect(await screen.findByText(t('events.comments.empty'))).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '  Guac is on me ' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(await screen.findByText('Guac is on me')).toBeInTheDocument()
    expect(box).toHaveValue('')
    const insert = db()
      .queries('comments')
      .map((call) => payloadOf(call, 'insert'))
      .find(Boolean)
    expect(insert).toEqual({ event_id: 'ev-1', body: 'Guac is on me' })
  })

  it('does not post the Enter that confirms an input method composition', async () => {
    db().respond('from:comments', { data: [] })
    renderEvent()
    const box = await screen.findByRole('textbox', { name: t('events.comments.label') })
    expect(await screen.findByText(t('events.comments.empty'))).toBeInTheDocument()
    fireEvent.change(box, { target: { value: '你好' } })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(box).toHaveValue('你好')
    expect(db().queries('comments').some((call) => payloadOf(call, 'insert'))).toBe(false)
  })

  it('gives the comment back when posting fails', async () => {
    db().respond('from:comments', (call) =>
      payloadOf(call, 'insert') ? { error: { message: 'Server error' } } : { data: [] },
    )
    renderEvent()
    const box = await screen.findByRole('textbox', { name: t('events.comments.label') })
    expect(await screen.findByText(t('events.comments.empty'))).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'Hello?' } })
    fireEvent.click(screen.getByRole('button', { name: t('events.comments.send') }))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
    await waitFor(() => expect(box).toHaveValue('Hello?'))
  })

  it('calls the plan off after confirming', async () => {
    db().respond('rpc:cancel_event', { data: { ...planEvent(), status: 'cancelled' } })
    renderEvent()
    fireEvent.click((await screen.findAllByRole('button', { name: t('events.cancel') }))[0]!)
    const dialog = await screen.findByRole('dialog', { name: t('events.cancelTitle') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('events.cancel') }))

    expect(await screen.findByText(t('events.cancelledBanner'))).toBeInTheDocument()
    expect(db().rpcArgs('cancel_event')).toEqual([{ event_id: 'ev-1' }])
  })
})

describe('EventPage once decided', () => {
  it('shows the date, RSVPs and a way to add an expense', async () => {
    seed(
      planEvent({
        status: 'scheduled',
        starts_at: '2026-11-11T19:00:00+00:00',
        ends_at: '2026-11-11T21:00:00+00:00',
      }),
      { event_rsvps: [{ event_id: 'ev-1', user_id: 'u-ben', status: 'going' }] },
    )
    const { router } = renderEvent()
    expect(await screen.findByText(t('events.status.scheduled'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('events.addToCalendar') })).toBeInTheDocument()
    expect(await screen.findByRole('radiogroup', { name: t('rsvp.title') })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(t('rsvp.status.going')) }))
    await waitFor(() =>
      expect(rowsOf('event_rsvps')).toContainEqual(
        expect.objectContaining({ user_id: VIEWER, status: 'going' }),
      ),
    )

    fireEvent.click(screen.getByRole('link', { name: new RegExp(t('events.addExpense')) }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/new/expense'))
    expect(router.state.location.search).toEqual({ groupId: 'g-hike', eventId: 'ev-1' })
  })

  it('marks cancelled and finished plans', async () => {
    seed(planEvent({ status: 'cancelled' }))
    const first = renderEvent()
    expect(await screen.findByText(t('events.cancelledBanner'))).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: new RegExp(t('events.addExpense')) }),
    ).not.toBeInTheDocument()
    first.unmount()

    seed(
      planEvent({
        status: 'done',
        starts_at: '2026-11-11T19:00:00+00:00',
        ends_at: '2026-11-11T21:00:00+00:00',
      }),
    )
    renderEvent()
    expect(await screen.findByText(t('events.doneBanner'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('events.cancel') })).not.toBeInTheDocument()
  })

  it('says when the plan does not exist', async () => {
    resetDb({ tables: { profiles: [viewerProfile], events: [] } })
    renderEvent()
    expect(await screen.findByText(t('events.notFound.title'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('events.notFound.action') })).toHaveAttribute(
      'href',
      '/plans',
    )
  })
})
