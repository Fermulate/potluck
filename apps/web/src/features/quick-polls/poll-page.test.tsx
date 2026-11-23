import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, resetDb } from '@/test/supabase'
import { renderWithProviders } from '@/test/render'
import { PollPage } from './poll-page'
import { pollMemory } from './poll-memory'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const auth = vi.hoisted(() => ({ session: null as null | { user: { id: string } } }))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useSession: () => auth.session,
}))

const slot = (time: string) => `2026-06-12T${time}:00.000Z`
// A token the browser made: long enough for the server and safe in a URL.
const madeToken = expect.stringMatching(/^[\w-]{24,200}$/)
const at = (time: string) => `2026-06-12T${time}:00+00:00`

const ana = {
  seat: 1,
  name: 'Ana',
  mine: false,
  slots: [
    { slot_start: at('18:00'), level: 'yes' },
    { slot_start: at('18:30'), level: 'yes' },
  ],
}

const open = {
  status: 'open',
  title: 'Board games',
  timezone: 'UTC',
  window_start: '2026-06-12',
  window_end: '2026-06-13',
  day_start_minute: 18 * 60,
  day_end_minute: 20 * 60,
  slot_minutes: 30,
  duration_minutes: 60,
  names_required: true,
  max_people: 10,
  expires_at: '2026-06-19T18:00:00Z',
  is_creator: false,
  answers: [ana],
}

const cell = (s: string) =>
  screen
    .getByRole('grid', { name: /^Your times for/ })
    .querySelector<HTMLElement>(`[data-slot="${s}"]`)!

function paint(s: string) {
  fireEvent.pointerDown(cell(s), { pointerId: 1 })
  fireEvent.pointerUp(screen.getByRole('grid', { name: /^Your times for/ }), { pointerId: 1 })
}

function renderPage(code = 'poll123') {
  return renderWithProviders(
    <>
      <PollPage code={code} />
      <Toaster label="Notifications" />
    </>,
    { path: '/p/$code', url: `/p/${code}` },
  )
}

describe('PollPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetDb()
    window.localStorage.clear()
    auth.session = null
  })

  it('takes a name and times from a new visitor, keeps the token and shows everyone', async () => {
    const mine = {
      seat: 2,
      name: 'Ben',
      mine: true,
      slots: [{ slot_start: at('18:00'), level: 'yes' }],
    }
    db()
      .respond(
        'rpc:quick_poll_preview',
        { data: [open] },
        { data: [{ ...open, answers: [ana, mine] }] },
      )
      .respond('rpc:set_quick_poll_availability', { data: [{ answer_token: 'tok-ben', saved: 1 }] })
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: 'Board games' })).toBeVisible()
    expect(screen.getByText(t('quickPolls.page.answered', { count: 1, max: 10 }))).toBeVisible()
    // Everyone's answers show by name before this visitor answers.
    expect(
      screen.getByRole('grid', {
        name: t('quickPolls.page.heatGridLabel', { title: 'Board games' }),
      }),
    ).toBeVisible()
    expect(screen.queryByText(t('quickPolls.page.readyTitle'))).not.toBeInTheDocument()

    // Nothing goes out without a name, or without a time.
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.submit') }))
    expect(await screen.findByText(t('quickPolls.page.needName'))).toBeVisible()
    fireEvent.change(screen.getByLabelText(t('quickPolls.page.nameLabel')), {
      target: { value: ' Ben ' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.submit') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('quickPolls.page.needTimes'))
    expect(db().rpcArgs('set_quick_poll_availability')).toEqual([])

    paint(slot('18:00'))
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.submit') }))

    expect(await screen.findByText(t('quickPolls.page.sentTitle', { name: 'Ben' }))).toBeVisible()
    expect(db().rpcArgs('set_quick_poll_availability')).toEqual([
      {
        code: 'poll123',
        name: 'Ben',
        token: madeToken,
        slots: [{ slot_start: slot('18:00'), level: 'yes' }],
      },
    ])
    const { token } = db().rpcArgs('set_quick_poll_availability')[0] as { token: string }
    expect(pollMemory.read('poll123')).toEqual({ token, name: 'Ben' })
    expect(db().rpcArgs('quick_poll_preview')).toContainEqual({ code: 'poll123', token })
    expect(screen.getByText(t('quickPolls.page.answered', { count: 2, max: 10 }))).toBeVisible()
  })

  it('brings a returning visitor back to their answer and lets them change it', async () => {
    pollMemory.write('poll123', { token: 'tok-ana', name: 'Ana' })
    db()
      .respond('rpc:quick_poll_preview', { data: [{ ...open, answers: [{ ...ana, mine: true }] }] })
      .respond('rpc:set_quick_poll_availability', { data: [{ answer_token: 'tok-ana', saved: 2 }] })
    renderPage()

    expect(await screen.findByText(t('quickPolls.page.sentTitle', { name: 'Ana' }))).toBeVisible()
    expect(db().rpcArgs('quick_poll_preview')[0]).toEqual({ code: 'poll123', token: 'tok-ana' })

    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.edit') }))
    expect(cell(slot('18:30'))).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText(t('quickPolls.page.nameLabel'))).toHaveValue('Ana')
    // Changing your mind about editing leaves the answer as it was.
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.cancel') }))
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.edit') }))
    paint(slot('19:00'))
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.update') }))
    await waitFor(() =>
      expect(db().rpcArgs('set_quick_poll_availability')).toEqual([
        {
          code: 'poll123',
          name: 'Ana',
          token: 'tok-ana',
          slots: [
            { slot_start: slot('18:00'), level: 'yes' },
            { slot_start: slot('18:30'), level: 'yes' },
            { slot_start: slot('19:00'), level: 'yes' },
          ],
        },
      ]),
    )
  })

  it('ranks the best times from everyone who answered', async () => {
    const ben = {
      seat: 2,
      name: 'Ben',
      mine: false,
      slots: [{ slot_start: at('18:30'), level: 'yes' }],
    }
    db().respond('rpc:quick_poll_preview', { data: [{ ...open, answers: [ana, ben] }] })
    renderPage()
    const best = await screen.findByRole('region', { name: t('bestTime.title') })
    // 18:00 for an hour suits Ana only; Ben's half hour is too short for anyone else.
    expect(within(best).getByText(t('bestTime.score', { yes: 1, maybe: 0 }))).toBeVisible()
    expect(within(best).getByText(t('bestTime.missing', { names: 'Ben' }))).toBeVisible()
  })

  it('asks for no name on an anonymous poll and numbers the answers', async () => {
    const anon = { ...open, names_required: false, answers: [{ ...ana, name: null }] }
    const mine = {
      seat: 2,
      name: null,
      mine: true,
      slots: [{ slot_start: at('19:00'), level: 'yes' }],
    }
    db()
      .respond(
        'rpc:quick_poll_preview',
        { data: [anon] },
        { data: [{ ...anon, answers: [...anon.answers, mine] }] },
      )
      .respond('rpc:set_quick_poll_availability', { data: [{ answer_token: 'tok-2', saved: 1 }] })
    renderPage()

    expect(await screen.findByText(t('quickPolls.page.anonymousNote'))).toBeVisible()
    expect(screen.queryByLabelText(t('quickPolls.page.nameLabel'))).not.toBeInTheDocument()
    paint(slot('19:00'))
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.submit') }))
    expect(
      await screen.findByText(
        t('quickPolls.page.sentTitleAnon', { name: t('quickPolls.anonymous', { seat: 2 }) }),
      ),
    ).toBeVisible()
    expect(db().rpcArgs('set_quick_poll_availability')[0]).toMatchObject({
      name: '',
      token: madeToken,
    })
    // The first answer suits seat 1 only, so the best time goes without seat 2.
    expect(
      screen.getByText(t('bestTime.missing', { names: t('quickPolls.anonymous', { seat: 2 }) })),
    ).toBeVisible()
  })

  it('shows a poll without a title by its default name', async () => {
    db().respond('rpc:quick_poll_preview', { data: [{ ...open, title: null }] })
    renderPage()
    expect(
      await screen.findByRole('heading', { level: 1, name: t('quickPolls.defaultTitle') }),
    ).toBeVisible()
  })

  it('puts sharing first for the creator of a new poll, then lets them close it', async () => {
    pollMemory.write('poll123', { token: 'tok-creator', name: '' })
    const created = { ...open, is_creator: true, answers: [] }
    db()
      .respond(
        'rpc:quick_poll_preview',
        { data: [created] },
        { data: [{ ...created, status: 'closed' }] },
      )
      .respond('rpc:close_quick_poll', { data: null })
    const copied = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: copied },
      configurable: true,
    })
    renderPage()

    expect(await screen.findByText(t('quickPolls.page.readyTitle'))).toBeVisible()
    expect(screen.getByText(t('quickPolls.page.noAnswersTitle'))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.copy') }))
    await waitFor(() => expect(copied).toHaveBeenCalledWith(expect.stringMatching(/\/p\/poll123$/)))
    expect(await screen.findByText(t('quickPolls.page.copied'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.close') }))
    const dialog = await screen.findByRole('dialog', { name: t('quickPolls.page.closeTitle') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('quickPolls.page.close') }))
    expect(
      await screen.findByRole('heading', { name: t('quickPolls.page.closedTitle') }),
    ).toBeVisible()
    expect(db().rpcArgs('close_quick_poll')).toEqual([{ code: 'poll123', token: 'tok-creator' }])
    expect(screen.getByText(t('quickPolls.page.closedByYou'))).toBeVisible()
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: t('quickPolls.page.close') }),
      ).not.toBeInTheDocument(),
    )
  })

  it('deletes the poll for its creator after asking, and forgets it', async () => {
    pollMemory.write('poll123', { token: 'tok-creator', name: 'Ava' })
    db()
      .respond('rpc:quick_poll_preview', { data: [{ ...open, is_creator: true }] })
      .respond('rpc:delete_quick_poll', { data: null })
    const { router } = renderPage()

    fireEvent.click(await screen.findByRole('button', { name: t('quickPolls.page.delete') }))
    const dialog = await screen.findByRole('dialog', { name: t('quickPolls.page.deleteTitle') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('quickPolls.page.delete') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/poll'))
    expect(db().rpcArgs('delete_quick_poll')).toEqual([{ code: 'poll123', token: 'tok-creator' }])
    expect(pollMemory.read('poll123')).toBeNull()
  })

  it('shows nobody else creator controls', async () => {
    db().respond('rpc:quick_poll_preview', { data: [open] })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Board games' })
    expect(
      screen.queryByRole('button', { name: t('quickPolls.page.delete') }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t('quickPolls.page.close') }),
    ).not.toBeInTheDocument()
  })

  it('turns new answers away from a full poll but shows the results', async () => {
    db().respond('rpc:quick_poll_preview', { data: [{ ...open, status: 'full', max_people: 1 }] })
    renderPage()
    expect(
      await screen.findByRole('heading', { name: t('quickPolls.page.fullTitle') }),
    ).toBeVisible()
    expect(screen.getByText(t('quickPolls.page.fullBody', { max: 1 }))).toBeVisible()
    expect(screen.queryByRole('grid', { name: /^Your times for/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(t('quickPolls.page.nameLabel'))).not.toBeInTheDocument()
    expect(screen.getByRole('grid', { name: /^Everyone's times/ })).toBeVisible()
  })

  it('shows a closed poll read only and says who closed it', async () => {
    db().respond('rpc:quick_poll_preview', { data: [{ ...open, status: 'closed' }] })
    renderPage()
    expect(
      await screen.findByRole('heading', { name: t('quickPolls.page.closedTitle') }),
    ).toBeVisible()
    expect(screen.getByText(t('quickPolls.page.closedBody'))).toBeVisible()
    expect(screen.queryByRole('grid', { name: /^Your times for/ })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t('quickPolls.page.edit') }),
    ).not.toBeInTheDocument()
  })

  it('says why a save was refused and shows the poll as it is now', async () => {
    db()
      .respond('rpc:quick_poll_preview', { data: [open] }, { data: [{ ...open, status: 'full' }] })
      .respond('rpc:set_quick_poll_availability', { error: { message: 'quick_poll_full' } })
    renderPage()
    fireEvent.change(await screen.findByLabelText(t('quickPolls.page.nameLabel')), {
      target: { value: 'Cy' },
    })
    paint(slot('19:00'))
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.submit') }))
    expect(
      await screen.findByRole('heading', { name: t('quickPolls.page.fullTitle') }),
    ).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(t('quickPolls.page.unsaved'))
  })

  it.each([
    ['kept in storage', false],
    ['with storage blocked', true],
  ])('sends a failed first save again under the same token, %s', async (_, blocked) => {
    if (blocked) {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('blocked', 'SecurityError')
      })
    }
    const offline = { error: { message: 'TypeError: Failed to fetch' } }
    db()
      .respond('rpc:quick_poll_preview', { data: [open] })
      .respond('rpc:set_quick_poll_availability', offline, {
        data: [{ answer_token: 'ignored', saved: 1 }],
      })
    renderPage()
    fireEvent.change(await screen.findByLabelText(t('quickPolls.page.nameLabel')), {
      target: { value: 'Cy' },
    })
    paint(slot('19:00'))

    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.submit') }))
    expect(await screen.findByRole('alert')).toBeVisible()
    const first = db().rpcArgs('set_quick_poll_availability')[0] as { token: string }
    expect(first).toMatchObject({ token: madeToken })
    // Kept before the reply came, so a reload after a lost reply sends it too.
    expect(pollMemory.read('poll123')?.token).toBe(blocked ? undefined : first.token)

    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.submit') }))
    await waitFor(() => expect(db().rpcArgs('set_quick_poll_availability')).toHaveLength(2))
    expect(db().rpcArgs('set_quick_poll_availability')[1]).toEqual(first)
  })

  it('words other save errors in place', async () => {
    db()
      .respond('rpc:quick_poll_preview', { data: [open] })
      .respond('rpc:set_quick_poll_availability', { error: { message: 'invalid_quick_poll_name' } })
    renderPage()
    fireEvent.change(await screen.findByLabelText(t('quickPolls.page.nameLabel')), {
      target: { value: 'Cy' },
    })
    paint(slot('19:00'))
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.submit') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      t('quickPolls.errors.invalid_quick_poll_name'),
    )
  })

  it.each([
    ['an expired poll', { data: [{ status: 'expired' }] }, 'quickPolls.ended.title'],
    [
      'an unknown code',
      { error: { message: 'quick_poll_not_found' } },
      'quickPolls.ended.notFoundTitle',
    ],
  ] as const)('closes %s with a way out', async (_, answer, title) => {
    db().respond('rpc:quick_poll_preview', answer)
    renderPage()
    expect(await screen.findByRole('heading', { name: t(title) })).toBeVisible()
    expect(screen.getByRole('link', { name: t('quickPolls.ended.newPoll') })).toHaveAttribute(
      'href',
      '/poll',
    )
    expect(screen.getByRole('link', { name: t('guests.closed.action') })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('offers a retry when the poll does not load', async () => {
    // The query tries three times before it gives up.
    const offline = { error: { message: 'TypeError: Failed to fetch' } }
    db().respond('rpc:quick_poll_preview', offline, offline, offline, { data: [open] })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Board games' })).toBeVisible()
  })

  it('closes a poll that is deleted while it is open on the page', async () => {
    db().respond(
      'rpc:quick_poll_preview',
      { data: [open] },
      { error: { message: 'quick_poll_not_found' } },
    )
    const { queryClient } = renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Board games' })).toBeVisible()

    await queryClient.invalidateQueries()

    expect(
      await screen.findByRole('heading', { name: t('quickPolls.ended.notFoundTitle') }),
    ).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Board games' })).not.toBeInTheDocument()
  })

  it('keeps the poll and the times being painted when a refresh fails', async () => {
    const offline = { error: { message: 'TypeError: Failed to fetch' } }
    db().respond('rpc:quick_poll_preview', { data: [open] }, offline)
    const { queryClient } = renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Board games' })
    paint(slot('19:00'))

    // The refresh tries three times before it gives up.
    await queryClient.invalidateQueries()

    expect(db().rpcArgs('quick_poll_preview')).toHaveLength(4)
    expect(screen.getByRole('heading', { level: 1, name: 'Board games' })).toBeVisible()
    expect(cell(slot('19:00'))).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByText(t('quickPolls.page.loadFailedTitle'))).not.toBeInTheDocument()
  }, 15_000)

  it('does not call times unsaved after the visitor backs out of editing', async () => {
    pollMemory.write('poll123', { token: 'tok-ana', name: 'Ana' })
    const mine = { ...open, answers: [{ ...ana, mine: true }] }
    db().respond(
      'rpc:quick_poll_preview',
      { data: [mine] },
      { data: [{ ...mine, status: 'closed' }] },
    )
    const { queryClient } = renderPage()

    fireEvent.click(await screen.findByRole('button', { name: t('quickPolls.page.edit') }))
    paint(slot('19:00'))
    fireEvent.click(screen.getByRole('button', { name: t('quickPolls.page.cancel') }))
    await queryClient.invalidateQueries()

    expect(
      await screen.findByRole('heading', { name: t('quickPolls.page.closedTitle') }),
    ).toBeVisible()
    expect(screen.queryByText(t('quickPolls.page.unsaved'))).not.toBeInTheDocument()
  })

  it('pitches an account to visitors without one, and not to people signed in', async () => {
    db().respond('rpc:quick_poll_preview', { data: [open] })
    const first = renderPage()
    expect(await screen.findByText(t('quickPolls.page.pitchTitle'))).toBeVisible()
    first.unmount()

    auth.session = { user: { id: 'u-1' } }
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Board games' })
    expect(screen.queryByText(t('quickPolls.page.pitchTitle'))).not.toBeInTheDocument()
  })

  it('keeps the poll out of search engines', async () => {
    db().respond('rpc:quick_poll_preview', { data: [open] })
    renderPage()
    await screen.findByRole('heading', { level: 1, name: 'Board games' })
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  })
})
