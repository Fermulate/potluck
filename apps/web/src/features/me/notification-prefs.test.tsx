import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { NotificationPrefs } from './notification-prefs'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => 'u-ava',
}))

const row = (category: string, push: boolean, email: boolean, pushAllowed = true) => ({
  category,
  push,
  email,
  push_allowed: pushAllowed,
  email_allowed: true,
})

const PREFS = [
  row('expense_added', true, true),
  row('payments', true, true),
  row('plans', true, false),
  row('monthly_summary', false, true, false),
]

function seed({ email = false, prefs = PREFS } = {}) {
  let stored = prefs.map((p) => ({ ...p }))
  const fake = resetDb({ tables: { app_config: [{ key: 'email_notifications', value: email }] } })
  // Reads return what was saved, like the server would.
  fake.respond('rpc:my_notification_prefs', () => ({ data: stored }))
  fake.respond('rpc:set_notification_pref', (call) => {
    const { category, ...change } = (call as { args: { category: string } }).args
    stored = stored.map((p) => (p.category === category ? { ...p, ...change } : p))
    return { data: null }
  })
  return fake
}

const label = (category: string, channel: 'push' | 'email') =>
  t('settings.notificationPrefs.channel', {
    category: t(`settings.notificationPrefs.categories.${category}.label` as never),
    channel: t(`settings.notificationPrefs.${channel}`),
  })

function renderPrefs() {
  return renderWithProviders(
    <>
      <NotificationPrefs />
      <Toaster label="Notifications" />
    </>,
  )
}

describe('NotificationPrefs', () => {
  beforeEach(() => {
    seed()
  })

  it('lists push settings with the server values while email is not switched on', async () => {
    renderPrefs()
    const payments = await screen.findByRole('switch', { name: label('payments', 'push') })
    expect(payments).toBeChecked()
    expect(screen.getByRole('switch', { name: label('plans', 'push') })).toBeChecked()
    expect(screen.queryByRole('switch', { name: label('payments', 'email') })).toBeNull()
    // The summary only emails, so with email off there is nothing to switch.
    expect(
      screen.queryByText(t('settings.notificationPrefs.categories.monthly_summary.label')),
    ).toBeNull()
    expect(screen.getByText(t('settings.notificationPrefs.emailSoon'))).toBeInTheDocument()
  })

  it('turns one channel of one setting off, right away', async () => {
    renderPrefs()
    const payments = await screen.findByRole('switch', { name: label('payments', 'push') })
    fireEvent.click(payments)
    await waitFor(() => expect(payments).not.toBeChecked())
    await waitFor(() =>
      expect(db().calls).toContainEqual({
        kind: 'rpc',
        name: 'set_notification_pref',
        args: { category: 'payments', push: false },
      }),
    )
  })

  it('shows an email column, the summary row and no "soon" note once email is on', async () => {
    seed({ email: true })
    renderPrefs()
    const summary = await screen.findByRole('switch', {
      name: label('monthly_summary', 'email'),
    })
    expect(summary).toBeChecked()
    expect(screen.queryByRole('switch', { name: label('monthly_summary', 'push') })).toBeNull()
    expect(screen.getByRole('switch', { name: label('plans', 'email') })).not.toBeChecked()
    expect(screen.queryByText(t('settings.notificationPrefs.emailSoon'))).toBeNull()

    fireEvent.click(screen.getByRole('switch', { name: label('plans', 'email') }))
    await waitFor(() =>
      expect(db().calls).toContainEqual({
        kind: 'rpc',
        name: 'set_notification_pref',
        args: { category: 'plans', email: true },
      }),
    )
  })

  it('puts the switch back and says so when saving fails', async () => {
    resetDb()
      .respond('rpc:my_notification_prefs', { data: PREFS })
      .respond('rpc:set_notification_pref', { error: { message: 'Server error' } })
    renderPrefs()
    const payments = await screen.findByRole('switch', { name: label('payments', 'push') })
    fireEvent.click(payments)
    expect(await screen.findByText(t('settings.notificationPrefs.failed'))).toBeInTheDocument()
    await waitFor(() => expect(payments).toBeChecked())
  })

  it('explains when the settings cannot load', async () => {
    resetDb().respond('rpc:my_notification_prefs', { error: { message: 'not_authenticated' } })
    renderPrefs()
    expect(await screen.findByText(t('errors.codes.not_authenticated'))).toBeInTheDocument()
  })
})
