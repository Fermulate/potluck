import type * as AuthModule from '@/lib/auth'
import type { ProfileRow } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setThemePreference } from '@/styles/theme-preference'
import { renderWithProviders } from '@/test/render'
import { argsOf, authCallsTo, db, payloadOf, resetDb } from '@/test/supabase'
import { MePage } from './me-page'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => 'u-ava',
  useSession: () => ({ user: { id: 'u-ava', email: 'ava@example.test' } }),
}))

let profile: ProfileRow
let rejectUpdates = false

function seed({ calendarImport = false, unread = 0 } = {}) {
  profile = {
    id: 'u-ava',
    display_name: 'Ava Chen',
    avatar_path: null,
    timezone: 'Pacific/Chatham',
    default_currency: 'USD',
    locale: 'en',
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    deleted_at: null,
  } as ProfileRow
  const fake = resetDb({
    tables: {
      app_config: [{ key: 'calendar_import', value: calendarImport }],
      notifications: Array.from({ length: unread }, (_, i) => ({
        id: `n${i}`,
        user_id: 'u-ava',
        read_at: null,
      })),
    },
  })
  // Reads return the stored row, updates merge into it like PostgREST would.
  fake.respond('from:profiles', (call) => {
    const patch = payloadOf(call, 'update') as Partial<ProfileRow> | undefined
    if (patch && rejectUpdates) return { error: { message: 'Server error' } }
    if (patch) profile = { ...profile, ...patch, updated_at: new Date().toISOString() }
    return { data: profile }
  })
  fake.respond('rpc:calendar_feed_token', { data: 'tok-1' }, { data: 'tok-2' })
  return fake
}

function updates() {
  return db()
    .queries('profiles')
    .flatMap((call) => argsOf(call, 'update').map((args) => args[0]))
}

function renderPage() {
  return renderWithProviders(
    <>
      <MePage />
      <Toaster label="Notifications" />
    </>,
    { path: '/me' },
  )
}

describe('MePage', () => {
  beforeEach(() => {
    rejectUpdates = false
    seed()
  })
  afterEach(() => {
    setThemePreference('system')
  })

  it('shows the profile with the account email', async () => {
    renderPage()
    expect(await screen.findByRole('textbox', { name: t('settings.profile.name') })).toHaveValue(
      'Ava Chen',
    )
    expect(screen.getByText('ava@example.test')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: t('settings.title') })).toBeInTheDocument()
  })

  it('saves a new display name, trimmed', async () => {
    renderPage()
    const name = await screen.findByRole('textbox', { name: t('settings.profile.name') })
    const save = screen.getByRole('button', { name: t('common.save') })
    expect(save).toBeDisabled()

    fireEvent.change(name, { target: { value: '  Ava C.  ' } })
    fireEvent.click(save)

    expect(await screen.findByText(t('settings.profile.saved'))).toBeInTheDocument()
    expect(updates()).toEqual([{ display_name: 'Ava C.' }])
  })

  it('refuses an empty name without saving', async () => {
    renderPage()
    const name = await screen.findByRole('textbox', { name: t('settings.profile.name') })
    fireEvent.change(name, { target: { value: '   ' } })
    fireEvent.submit(name.closest('form')!)
    expect(await screen.findByText(t('settings.profile.nameRequired'))).toBeInTheDocument()
    expect(updates()).toEqual([])
  })

  it('rolls back and explains when a save fails', async () => {
    renderPage()
    const name = await screen.findByRole('textbox', { name: t('settings.profile.name') })
    rejectUpdates = true
    fireEvent.change(name, { target: { value: 'Ava B' } })
    fireEvent.click(screen.getByRole('button', { name: t('common.save') }))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
    expect(name).toHaveValue('Ava B')
    expect(screen.getByRole('button', { name: t('common.save') })).toBeEnabled()
  })

  it('changes time zone and currency preferences', async () => {
    renderPage()
    const zone = await screen.findByRole('combobox', { name: t('settings.preferences.timezone') })
    expect(zone).toHaveValue('Pacific/Chatham')
    fireEvent.change(zone, { target: { value: 'Europe/Paris' } })
    await screen.findByText(t('settings.preferences.saved'))

    fireEvent.change(screen.getByRole('combobox', { name: t('settings.preferences.currency') }), {
      target: { value: 'EUR' },
    })
    await waitFor(() =>
      expect(updates()).toEqual([{ timezone: 'Europe/Paris' }, { default_currency: 'EUR' }]),
    )
  })

  it('offers the device time zone when the profile uses another one', async () => {
    renderPage()
    fireEvent.click(
      await screen.findByRole('button', { name: t('settings.preferences.detectTimezone') }),
    )
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone
    await waitFor(() => expect(updates()).toEqual([{ timezone: device }]))
  })

  it('switches the theme', async () => {
    renderPage()
    const group = await screen.findByRole('radiogroup', { name: t('settings.preferences.theme') })
    fireEvent.click(within(group).getByRole('radio', { name: t('settings.preferences.themeDark') }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    expect(
      within(group).getByRole('radio', { name: t('settings.preferences.themeDark') }),
    ).toBeChecked()
  })

  it('links to the inbox with the unread count and explains missing push support', async () => {
    seed({ unread: 3 })
    renderPage()
    expect(await screen.findByText(t('notifications.unread', { count: 3 }))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open inbox/ })).toHaveAttribute(
      'href',
      '/notifications',
    )
    expect(screen.getByRole('switch', { name: t('settings.notifications.push') })).toBeDisabled()
    expect(screen.getByText(t('settings.notifications.pushUnsupported'))).toBeInTheDocument()
  })

  it('shows the calendar feed, copies it and resets the link', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderPage()
    const feed = await screen.findByRole('textbox', { name: t('settings.calendar.feed') })
    expect(feed).toHaveValue('https://db.test/functions/v1/ics-feed?token=tok-1')
    expect(screen.getByRole('link', { name: t('settings.calendar.subscribe') })).toHaveAttribute(
      'href',
      'webcal://db.test/functions/v1/ics-feed?token=tok-1',
    )
    expect(screen.getByText(t('settings.calendar.comingSoon'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: t('settings.calendar.copyFeed') }))
    await screen.findByText(t('common.copied'))
    expect(writeText).toHaveBeenCalledWith('https://db.test/functions/v1/ics-feed?token=tok-1')

    fireEvent.click(screen.getByRole('button', { name: t('settings.calendar.resetFeed') }))
    const dialog = await screen.findByRole('dialog', { name: t('settings.calendar.resetFeed') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('settings.calendar.resetFeed') }))
    await waitFor(() =>
      expect(feed).toHaveValue('https://db.test/functions/v1/ics-feed?token=tok-2'),
    )
    expect(db().rpcArgs('calendar_feed_token')).toEqual([{ rotate: false }, { rotate: true }])
  })

  it('hides the coming soon badge once calendar import is on', async () => {
    seed({ calendarImport: true })
    renderPage()
    await screen.findByRole('textbox', { name: t('settings.calendar.feed') })
    expect(screen.queryByText(t('settings.calendar.comingSoon'))).not.toBeInTheDocument()
  })

  it('signs out and goes back to the landing page', async () => {
    const { router } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('auth.signOut') }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(authCallsTo('signOut')).toHaveLength(1)
  })

  it('deletes the account only after typing the confirm word', async () => {
    const { router } = renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('account.delete.title') }))
    const dialog = await screen.findByRole('dialog', { name: t('account.delete.title') })
    const submit = within(dialog).getByRole('button', { name: t('account.delete.submit') })
    expect(submit).toBeDisabled()

    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE' } })
    fireEvent.click(submit)

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
    expect(db().calls).toContainEqual(
      expect.objectContaining({ kind: 'functions', name: 'delete-account' }),
    )
    expect(authCallsTo('signOut')).toHaveLength(1)
  })

  it('keeps the account and reports when deletion fails', async () => {
    db().respond('functions:delete-account', { error: { message: 'owner_must_transfer' } })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: t('account.delete.title') }))
    const dialog = await screen.findByRole('dialog', { name: t('account.delete.title') })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'DELETE' } })
    fireEvent.click(within(dialog).getByRole('button', { name: t('account.delete.submit') }))
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: t('account.delete.submit') }),
      ).toBeEnabled(),
    )
    expect(authCallsTo('signOut')).toHaveLength(0)
  })
})
