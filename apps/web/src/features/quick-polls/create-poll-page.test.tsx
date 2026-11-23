import { QUICK_POLL_MAX_PEOPLE, QUICK_POLL_MIN_PEOPLE } from '@potluck/core'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, resetDb } from '@/test/supabase'
import { renderWithProviders } from '@/test/render'
import { CreatePollPage } from './create-poll-page'
import { pollMemory } from './poll-memory'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const created = {
  data: [{ code: 'newpoll', creator_token: 'tok-creator', expires_at: '2026-06-08T09:00:00Z' }],
}

async function renderPage() {
  const view = renderWithProviders(<CreatePollPage />, { path: '/poll' })
  await screen.findByRole('heading', { level: 1, name: t('quickPolls.create.title') })
  return view
}

const submit = () =>
  fireEvent.click(screen.getByRole('button', { name: t('quickPolls.create.submit') }))

describe('CreatePollPage', () => {
  beforeEach(() => {
    resetDb()
    window.localStorage.clear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-06-01T09:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('makes a poll from the defaults, keeps the creator token and opens it', async () => {
    db().respond('rpc:create_quick_poll', created)
    const { router } = await renderPage()

    // The rarer settings wait folded away, summed up in one line.
    expect(
      screen.getByText(
        t('quickPolls.create.summary', {
          names: t('quickPolls.create.namesOn'),
          max: 10,
          expiry: t('quickPolls.create.expiry.week'),
        }),
      ),
    ).toBeInTheDocument()
    submit()

    await waitFor(() => expect(router.state.location.pathname).toBe('/p/newpoll'))
    const [args] = db().rpcArgs('create_quick_poll') as [{ payload: Record<string, unknown> }]
    expect(args.payload).toEqual({
      title: null,
      timezone: expect.any(String),
      window_start: '2026-06-02',
      window_end: '2026-06-08',
      day_start_minute: 600,
      day_end_minute: 1320,
      duration_minutes: 60,
      slot_minutes: 30,
      ttl: '7d',
      names_required: true,
      max_people: 10,
    })
    expect(pollMemory.read('newpoll')).toEqual({ token: 'tok-creator', name: '' })
  })

  it('sends a title, anonymous answers, a smaller cap and a 24 hour expiry', async () => {
    db().respond('rpc:create_quick_poll', created)
    await renderPage()

    fireEvent.change(screen.getByLabelText(t('quickPolls.create.titleLabel')), {
      target: { value: '  Team lunch ' },
    })
    fireEvent.click(screen.getByText(t('quickPolls.create.more')))
    fireEvent.click(screen.getByRole('switch', { name: t('quickPolls.create.namesLabel') }))
    const fewer = screen.getByRole('button', { name: t('quickPolls.create.fewer') })
    for (let i = 0; i < 20; i++) fireEvent.click(fewer)
    // The cap stops at the smallest poll.
    expect(fewer).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: t('quickPolls.create.expiry.day') }))
    expect(
      screen.getByText(
        t('quickPolls.create.summary', {
          names: t('quickPolls.create.namesOff'),
          max: QUICK_POLL_MIN_PEOPLE,
          expiry: t('quickPolls.create.expiry.day'),
        }),
      ),
    ).toBeInTheDocument()
    submit()

    await waitFor(() =>
      expect(db().rpcArgs('create_quick_poll')[0]).toMatchObject({
        payload: {
          title: 'Team lunch',
          names_required: false,
          max_people: QUICK_POLL_MIN_PEOPLE,
          ttl: '24h',
        },
      }),
    )
  })

  it('caps the people at the largest poll', async () => {
    await renderPage()
    fireEvent.click(screen.getByText(t('quickPolls.create.more')))
    const more = screen.getByRole('button', { name: t('quickPolls.create.morePeople') })
    for (let i = 0; i < 20; i++) fireEvent.click(more)
    expect(more).toBeDisabled()
    expect(screen.getByText(String(QUICK_POLL_MAX_PEOPLE))).toBeInTheDocument()
  })

  it('keeps the window to two weeks and moves the last day along with the first', async () => {
    await renderPage()
    const first = screen.getByLabelText(t('events.create.windowFrom'))
    const last = screen.getByLabelText(t('events.create.windowTo'))
    expect(last).toHaveAttribute('max', '2026-06-15')
    fireEvent.change(first, { target: { value: '2026-06-20' } })
    expect(last).toHaveValue('2026-06-20')
    expect(last).toHaveAttribute('max', '2026-07-03')
  })

  it('stops a window longer than two weeks before sending it', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText(t('events.create.windowTo')), {
      target: { value: '2026-06-30' },
    })
    submit()
    expect(await screen.findByText(t('quickPolls.errors.invalid_quick_poll_window'))).toBeVisible()
    expect(db().rpcArgs('create_quick_poll')).toEqual([])
  })

  it('says when someone has made too many polls', async () => {
    db().respond('rpc:create_quick_poll', { error: { message: 'quick_poll_rate_limited' } })
    const { router } = await renderPage()
    submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('quickPolls.errors.quick_poll_rate_limited'),
    )
    expect(router.state.location.pathname).toBe('/poll')
  })
})
