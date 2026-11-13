import type { PlanMember } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db, resetDb } from '@/test/supabase'
import { renderWithProviders } from '@/test/render'
import { GuestLinksPanel } from './guest-links-panel'
import { parseGuestCap, shareGuestLink } from './share'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const event = { id: 'e1', title: 'Dumpling night', created_by: 'u-org' }
const member = (userId: string, role: PlanMember['role'] = 'member'): PlanMember => ({
  userId,
  role,
  displayName: userId,
  avatarPath: null,
  deleted: false,
})

const later = new Date(Date.now() + 3 * 86_400_000).toISOString()
const link = (id: string, created_by: string, max_guests = 2) => ({
  id,
  event_id: 'e1',
  group_id: 'g1',
  code: `code-${id}`,
  created_by,
  max_guests,
  expires_at: later,
  revoked_at: null,
  created_at: '2026-06-01T00:00:00Z',
})
const guest = (id: string, link_id: string, display_name: string) => ({
  id,
  link_id,
  event_id: 'e1',
  display_name,
  created_at: `2026-06-01T00:00:0${id.length}Z`,
})

function renderPanel(viewer: PlanMember) {
  return renderWithProviders(
    <>
      <GuestLinksPanel event={event} viewer={viewer} timeZone="UTC" />
      <Toaster label="Notifications" />
    </>,
  )
}

describe('GuestLinksPanel', () => {
  const writeText = vi.fn(async () => {})

  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    writeText.mockClear()
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  })

  it('creates a link with the chosen expiry and a custom guest cap', async () => {
    resetDb({ tables: { event_guest_links: [], event_guests: [] } })
    db().respond('rpc:create_guest_link', { data: link('l-new', 'u-me', 40) })
    renderPanel(member('u-me'))

    fireEvent.click(await screen.findByRole('button', { name: t('guests.panel.share') }))
    const sheet = await screen.findByRole('dialog', { name: t('guests.create.title') })
    fireEvent.click(within(sheet).getByRole('radio', { name: t('guests.create.expiry.day') }))
    fireEvent.click(within(sheet).getByRole('radio', { name: t('guests.create.capCustom') }))
    const input = within(sheet).getByLabelText(t('guests.create.capCustomLabel'))
    fireEvent.change(input, { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: t('guests.create.submit') }))
    expect(await screen.findByText(t('guests.create.capInvalid'))).toBeInTheDocument()
    expect(db().rpcArgs('create_guest_link')).toEqual([])

    fireEvent.change(input, { target: { value: '4x0' } })
    expect(input).toHaveValue('40')
    expect(
      within(sheet).getByText(
        t('guests.create.summary', { max: 40, expiry: t('guests.create.expiry.day') }),
      ),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('guests.create.submit') }))

    await waitFor(() =>
      expect(db().rpcArgs('create_guest_link')).toEqual([
        { event_id: 'e1', ttl: '24h', max_guests: 40 },
      ]),
    )
    const list = await screen.findByRole('list', { name: t('guests.panel.links') })
    expect(
      within(list).getByText(t('guests.panel.usage', { used: 0, max: 40 })),
    ).toBeInTheDocument()
  })

  it('shows usage per link and lets members revoke only their own', async () => {
    resetDb({
      tables: {
        event_guest_links: [link('l-mine', 'u-me'), link('l-theirs', 'u-other')],
        event_guests: [guest('g1', 'l-mine', 'Ana'), guest('g22', 'l-mine', 'Ben')],
      },
    })
    renderPanel(member('u-me'))

    const list = await screen.findByRole('list', { name: t('guests.panel.links') })
    expect(within(list).getAllByText(t('guests.panel.full'))).toHaveLength(1)
    expect(within(list).getByText(t('guests.panel.usage', { used: 2, max: 2 }))).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t('guests.panel.revoke', { code: 'code-l-theirs' }) }),
    ).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: t('guests.panel.revoke', { code: 'code-l-mine' }) }),
    )
    const confirm = await screen.findByRole('dialog', { name: t('guests.panel.revokeTitle') })
    expect(db().rpcArgs('revoke_guest_link')).toEqual([])
    fireEvent.click(within(confirm).getByRole('button', { name: t('guests.panel.turnOff') }))
    await waitFor(() => expect(db().rpcArgs('revoke_guest_link')).toEqual([{ link_id: 'l-mine' }]))
    await waitFor(() =>
      expect(within(list).queryByText(t('guests.panel.usage', { used: 2, max: 2 }))).toBeNull(),
    )
    // Members do not get to remove guests on a plan they did not organize.
    expect(
      screen.queryByRole('button', { name: t('guests.panel.remove', { name: 'Ana' }) }),
    ).not.toBeInTheDocument()
  })

  it('copies and shares a link', async () => {
    resetDb({ tables: { event_guest_links: [link('l1', 'u-me')], event_guests: [] } })
    renderPanel(member('u-me'))

    fireEvent.click(await screen.findByRole('button', { name: t('guests.panel.copy') }))
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/a\/code-l1$/)),
    )
    expect(await screen.findByRole('button', { name: t('common.copied') })).toBeInTheDocument()

    const share = vi.fn(async () => {})
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    fireEvent.click(screen.getByRole('button', { name: t('guests.panel.shareLink') }))
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({ title: t('guests.shareTitle', { event: 'Dumpling night' }) }),
      ),
    )
  })

  it('lets the organizer remove a guest after confirming', async () => {
    resetDb({
      tables: {
        event_guest_links: [link('l1', 'u-other')],
        event_guests: [guest('g1', 'l1', 'Ana')],
      },
    })
    renderPanel(member('u-org'))

    expect(await screen.findByText(t('guests.panel.answered', { count: 1 }))).toBeInTheDocument()
    expect(screen.getByText(t('guests.tag'))).toBeInTheDocument()
    // The organizer may turn off anyone's link on their plan.
    expect(
      screen.getByRole('button', { name: t('guests.panel.revoke', { code: 'code-l1' }) }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('guests.panel.remove', { name: 'Ana' }) }))
    const dialog = await screen.findByRole('dialog', { name: t('guests.panel.removeTitle') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.remove') }))
    await waitFor(() => expect(db().rpcArgs('remove_guest_answer')).toEqual([{ guest_id: 'g1' }]))
  })

  it('offers a retry when the links do not load', async () => {
    resetDb({ tables: { event_guests: [] } })
    db().respond('from:event_guest_links', { error: { message: 'boom' } }, { data: [] })
    renderPanel(member('u-me'))
    expect(await screen.findByText(t('guests.panel.loadFailed'))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('button', { name: t('guests.panel.share') })).toBeVisible()
  })

  it('shows the server reason when a link cannot be made', async () => {
    resetDb({ tables: { event_guest_links: [], event_guests: [] } })
    db().respond('rpc:create_guest_link', { error: { message: 'guest_link_limit' } })
    renderPanel(member('u-me', 'admin'))
    fireEvent.click(await screen.findByRole('button', { name: t('guests.panel.share') }))
    fireEvent.click(await screen.findByRole('button', { name: t('guests.create.submit') }))
    expect(await screen.findByText(t('events.errors.guest_link_limit'))).toBeInTheDocument()
  })
})

describe('guest link helpers', () => {
  it('parses a guest cap from 1 to 100', () => {
    expect(parseGuestCap('1')).toBe(1)
    expect(parseGuestCap(' 100 ')).toBe(100)
    expect(parseGuestCap('0')).toBeNull()
    expect(parseGuestCap('101')).toBeNull()
    expect(parseGuestCap('2.5')).toBeNull()
    expect(parseGuestCap('')).toBeNull()
  })

  it('falls back to the clipboard without a share sheet, and ignores a cancelled share', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
    await shareGuestLink('Picnic', 'xyz')
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/a\/xyz$/))

    writeText.mockClear()
    const share = vi.fn(async () => {
      throw new DOMException('cancelled', 'AbortError')
    })
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    await shareGuestLink('Picnic', 'xyz')
    expect(writeText).not.toHaveBeenCalled()
  })
})
