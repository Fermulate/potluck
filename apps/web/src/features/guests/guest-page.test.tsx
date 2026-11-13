import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, resetDb } from '@/test/supabase'
import { renderWithProviders } from '@/test/render'
import { GuestPage } from './guest-page'
import { readGuestMemory, writeGuestMemory } from './guest-token'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const slot = (time: string) => `2026-06-12T${time}:00.000Z`

const open = {
  status: 'open',
  title: 'Dumpling night',
  emoji: '🥟',
  group_emoji: '🏮',
  host_name: 'Musa',
  timezone: 'UTC',
  window_start: '2026-06-12',
  window_end: '2026-06-13',
  day_start_minute: 18 * 60,
  day_end_minute: 20 * 60,
  slot_minutes: 30,
  duration_minutes: 60,
  expires_at: '2026-06-19T18:00:00Z',
  max_guests: 10,
  guest_count: 1,
  respondents: 3,
  my_name: null,
  my_slots: null,
  heat: [{ slot_start: '2026-06-12T18:00:00+00:00', yes: 2, maybe: 1 }],
}

const closed = (status: string) =>
  Object.fromEntries(Object.keys(open).map((k) => [k, k === 'status' ? status : null]))

const cell = (s: string) => document.querySelector<HTMLElement>(`[data-slot="${s}"]`)!

function paint(s: string) {
  fireEvent.pointerDown(cell(s), { pointerId: 1 })
  fireEvent.pointerUp(screen.getByRole('grid', { name: /Your times for/ }), { pointerId: 1 })
}

function renderPage(code = 'abc123') {
  return renderWithProviders(<GuestPage code={code} />, { path: `/a/${code}` })
}

describe('GuestPage', () => {
  beforeEach(() => {
    resetDb()
    window.localStorage.clear()
  })

  it('shows the plan, takes a name and times, and keeps the token it gets back', async () => {
    db()
      .respond('rpc:guest_link_preview', { data: [open] })
      .respond('rpc:set_guest_availability', { data: [{ guest_token: 'tok-new', saved: 1 }] })
    renderPage()

    expect(await screen.findByRole('heading', { name: 'Dumpling night' })).toBeInTheDocument()
    expect(screen.getByText(t('guests.page.invitedBy', { name: 'Musa' }))).toBeInTheDocument()

    // Nothing goes out without a name, or without a time for a new guest.
    fireEvent.click(screen.getByRole('button', { name: t('guests.page.submit') }))
    expect(await screen.findByText(t('guests.page.needName'))).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(t('guests.page.nameLabel')), {
      target: { value: '  Ana ' },
    })
    fireEvent.click(screen.getByRole('button', { name: t('guests.page.submit') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('guests.page.needTimes'))
    expect(db().rpcArgs('set_guest_availability')).toEqual([])

    paint(slot('18:00'))
    expect(screen.getByText(t('availability.mySlots', { count: 1 }))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('guests.page.submit') }))

    expect(await screen.findByText(t('guests.page.sentTitle', { name: 'Ana' }))).toBeInTheDocument()
    expect(db().rpcArgs('set_guest_availability')).toEqual([
      {
        code: 'abc123',
        name: 'Ana',
        token: '',
        slots: [{ slot_start: slot('18:00'), level: 'yes' }],
      },
    ])
    expect(readGuestMemory('abc123')).toEqual({ token: 'tok-new', name: 'Ana' })
    // After sending, the page shows how everyone looks, as counts only.
    expect(screen.getByRole('grid', { name: /How everyone looks/ })).toBeInTheDocument()
    await waitFor(() =>
      expect(db().rpcArgs('guest_link_preview')).toContainEqual({
        code: 'abc123',
        token: 'tok-new',
      }),
    )
  })

  it('brings a returning guest back to their answer and lets them change it', async () => {
    writeGuestMemory('abc123', { token: 'tok-ana', name: 'Ana' })
    const mine = {
      ...open,
      my_name: 'Ana',
      my_slots: [{ slot_start: '2026-06-12T18:30:00+00:00', level: 'maybe' }],
    }
    db()
      .respond('rpc:guest_link_preview', { data: [mine] })
      .respond('rpc:set_guest_availability', { data: [{ guest_token: 'tok-ana', saved: 0 }] })
    renderPage()

    expect(await screen.findByText(t('guests.page.sentTitle', { name: 'Ana' }))).toBeInTheDocument()
    expect(db().rpcArgs('guest_link_preview')[0]).toEqual({ code: 'abc123', token: 'tok-ana' })

    fireEvent.click(screen.getByRole('button', { name: t('guests.page.edit') }))
    expect(cell(slot('18:30'))).toHaveAttribute('aria-selected', 'true')
    // The yes brush over their maybe turns it into a yes.
    paint(slot('18:30'))
    fireEvent.click(screen.getByRole('button', { name: t('guests.page.update') }))
    await waitFor(() =>
      expect(db().rpcArgs('set_guest_availability')).toEqual([
        {
          code: 'abc123',
          name: 'Ana',
          token: 'tok-ana',
          slots: [{ slot_start: slot('18:30'), level: 'yes' }],
        },
      ]),
    )
  })

  it('switches to how everyone looks before answering, without names', async () => {
    db().respond('rpc:guest_link_preview', { data: [open] })
    renderPage()
    fireEvent.click(await screen.findByRole('radio', { name: t('guests.page.tabs.everyone') }))
    const grid = screen.getByRole('grid', { name: /How everyone looks/ })
    expect(screen.getByText(t('guests.page.respondents', { count: 3 }))).toBeInTheDocument()
    fireEvent.focus(within(grid).getByLabelText(/2 free, 1 maybe/))
    expect(screen.getByText(t('guests.page.cellCount', { count: 3, total: 3 }))).toBeInTheDocument()
  })

  it('says why a save was refused', async () => {
    db()
      .respond('rpc:guest_link_preview', { data: [open] })
      .respond('rpc:set_guest_availability', { error: { message: 'guest_link_full' } })
    renderPage()
    fireEvent.change(await screen.findByLabelText(t('guests.page.nameLabel')), {
      target: { value: 'Ben' },
    })
    paint(slot('19:00'))
    fireEvent.click(screen.getByRole('button', { name: t('guests.page.submit') }))
    expect(await screen.findByRole('alert')).toHaveTextContent(t('events.errors.guest_link_full'))
  })

  it.each([
    ['expired', 'guests.closed.expired'],
    ['revoked', 'guests.closed.revoked'],
    ['closed', 'guests.closed.closed'],
    ['archived', 'guests.closed.archived'],
  ] as const)('explains a %s link and offers a way out', async (status, body) => {
    db().respond('rpc:guest_link_preview', { data: [closed(status)] })
    renderPage()
    expect(
      await screen.findByRole('heading', { name: t('guests.closed.title') }),
    ).toBeInTheDocument()
    expect(screen.getByText(t(body))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('guests.closed.action') })).toHaveAttribute(
      'href',
      '/',
    )
  })

  it('treats an unknown code as closed', async () => {
    db().respond('rpc:guest_link_preview', { data: [] })
    renderPage('nope')
    expect(await screen.findByText(t('guests.closed.notFound'))).toBeInTheDocument()
  })

  it('tells new guests when the link is full, naming who to ask', async () => {
    db().respond('rpc:guest_link_preview', {
      data: [{ ...open, status: 'full', respondents: null, heat: null }],
    })
    renderPage()
    expect(
      await screen.findByRole('heading', { name: t('guests.closed.fullTitle') }),
    ).toBeInTheDocument()
    expect(screen.getByText(t('guests.closed.full', { name: 'Musa' }))).toBeInTheDocument()
  })

  it('words a full link without a host name too', async () => {
    db().respond('rpc:guest_link_preview', {
      data: [{ ...open, status: 'full', host_name: null, respondents: null, heat: null }],
    })
    renderPage()
    expect(await screen.findByText(t('guests.closed.fullAnon'))).toBeInTheDocument()
  })
})
