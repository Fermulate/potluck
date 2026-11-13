import type * as AuthModule from '@/lib/auth'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, resetDb } from '@/test/supabase'
import { NotificationPrefs, type DevicePush } from './notification-prefs'

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

const summarySwitch = () =>
  screen.findByRole('switch', {
    name: t('settings.notificationPrefs.categories.monthly_summary.label'),
  })

function renderPrefs(push?: DevicePush) {
  return renderWithProviders(
    <>
      <NotificationPrefs push={push} />
      <Toaster label="Notifications" />
    </>,
  )
}

describe('NotificationPrefs', () => {
  beforeEach(() => {
    seed()
  })
  afterEach(() => {
    onlineManager.setOnline(true)
  })

  it('lists push settings with the server values while email is not switched on', async () => {
    renderPrefs()
    const payments = await screen.findByRole('switch', { name: label('payments', 'push') })
    expect(payments).toBeChecked()
    expect(screen.getByRole('switch', { name: label('plans', 'push') })).toBeChecked()
    expect(screen.queryByRole('switch', { name: label('payments', 'email') })).toBeNull()
    expect(screen.getByText(t('settings.notificationPrefs.emailSoon'))).toBeInTheDocument()
    // No push device given: nothing to say about this device.
    expect(screen.queryByText(t('settings.notificationPrefs.pushOffHere'))).toBeNull()
  })

  it('keeps the monthly summary switch with email off: it also stops the inbox card', async () => {
    renderPrefs()
    const summary = await summarySwitch()
    expect(summary).toBeChecked()
    fireEvent.click(summary)
    await waitFor(() =>
      expect(db().calls).toContainEqual({
        kind: 'rpc',
        name: 'set_notification_pref',
        args: { category: 'monthly_summary', email: false },
      }),
    )
  })

  it('dims push while this device is off and offers to turn it on', async () => {
    const enable = vi.fn(async () => true)
    renderPrefs({ state: 'off', busy: false, enable })
    expect(await screen.findByText(t('settings.notificationPrefs.pushOffHere'))).toBeInTheDocument()
    // Still switchable: the setting reaches the person's other devices.
    expect(await screen.findByRole('switch', { name: label('payments', 'push') })).toBeEnabled()
    fireEvent.click(
      screen.getByRole('button', { name: t('settings.notificationPrefs.turnOnPush') }),
    )
    await waitFor(() => expect(enable).toHaveBeenCalledOnce())
  })

  it('says how to unblock push, and says nothing once push is on', async () => {
    const enable = vi.fn(async () => true)
    const { unmount } = renderPrefs({ state: 'blocked', busy: false, enable })
    expect(
      await screen.findByText(t('notifications.pushBlocked'), { exact: false }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: t('settings.notificationPrefs.turnOnPush') }),
    ).toBeNull()
    unmount()
    renderPrefs({ state: 'on', busy: false, enable })
    await screen.findByRole('switch', { name: label('payments', 'push') })
    expect(screen.queryByText(t('settings.notificationPrefs.pushOffHere'))).toBeNull()
  })

  it('says a change made offline waits for the connection', async () => {
    renderPrefs()
    const payments = await screen.findByRole('switch', { name: label('payments', 'push') })
    onlineManager.setOnline(false)
    fireEvent.click(payments)
    expect(await screen.findByText(t('settings.notificationPrefs.offline'))).toBeInTheDocument()
    onlineManager.setOnline(true)
    await waitFor(() =>
      expect(screen.queryByText(t('settings.notificationPrefs.offline'))).toBeNull(),
    )
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
    expect(await summarySwitch()).toBeChecked()
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
