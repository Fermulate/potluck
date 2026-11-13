import { describe, expect, it } from 'vitest'
import {
  emailUnsubscribe,
  fetchNotificationPrefs,
  isNotificationCategory,
  notificationPrefKeys,
  notificationPrefsQueryOptions,
  setNotificationPref,
} from './notification-prefs'
import { fakeSupabase } from './testing/fake-supabase'

const boom = { message: 'not_authenticated' }
const pref = (category: string, push = true, email = true) => ({
  category,
  push,
  email,
  push_allowed: true,
  email_allowed: true,
})

describe('notification settings', () => {
  it('reads every setting it can label, in server order', async () => {
    const fake = fakeSupabase().respond('rpc:my_notification_prefs', {
      data: [pref('payments', false), pref('carrier_pigeon'), pref('plans', true, false)],
    })
    expect(await fetchNotificationPrefs(fake.client)).toEqual([
      pref('payments', false),
      pref('plans', true, false),
    ])
    expect(fake.calls).toEqual([{ kind: 'rpc', name: 'my_notification_prefs', args: undefined }])
  })

  it('treats no rows as no settings and throws errors as they come', async () => {
    expect(await fetchNotificationPrefs(fakeSupabase().client)).toEqual([])
    const fake = fakeSupabase().respond('rpc:my_notification_prefs', { error: boom })
    await expect(fetchNotificationPrefs(fake.client)).rejects.toBe(boom)
  })

  it('has query options keyed by user under the me prefix', async () => {
    const fake = fakeSupabase().respond('rpc:my_notification_prefs', { data: [pref('groups')] })
    const options = notificationPrefsQueryOptions(fake.client, 'u1')
    expect(options.queryKey).toEqual(notificationPrefKeys.mine('u1'))
    expect(options.queryKey.slice(0, 2)).toEqual(['potluck', 'me'])
    expect(await options.queryFn!({} as never)).toEqual([pref('groups')])
  })

  it('changes only the channel it is given', async () => {
    const fake = fakeSupabase()
    await setNotificationPref(fake.client, 'payments', { push: false })
    await setNotificationPref(fake.client, 'monthly_summary', { email: true })
    expect(fake.calls).toEqual([
      { kind: 'rpc', name: 'set_notification_pref', args: { category: 'payments', push: false } },
      {
        kind: 'rpc',
        name: 'set_notification_pref',
        args: { category: 'monthly_summary', email: true },
      },
    ])
    const failing = fakeSupabase().respond('rpc:set_notification_pref', { error: boom })
    await expect(setNotificationPref(failing.client, 'plans', { push: true })).rejects.toBe(boom)
  })

  it('applies and undoes an unsubscribe link', async () => {
    const fake = fakeSupabase()
      .respond('rpc:email_unsubscribe', { data: 'payments' })
      .respond('rpc:email_unsubscribe', { data: 'all' })
      .respond('rpc:email_unsubscribe', { data: 'something_new' })
    expect(await emailUnsubscribe(fake.client, 'tok')).toBe('payments')
    expect(await emailUnsubscribe(fake.client, 'tok', true)).toBe('all')
    expect(await emailUnsubscribe(fake.client, 'tok')).toBeNull()
    expect(fake.calls[0]).toEqual({
      kind: 'rpc',
      name: 'email_unsubscribe',
      args: { token: 'tok', subscribe: false },
    })
    expect(fake.calls[1]).toMatchObject({ args: { token: 'tok', subscribe: true } })

    const bad = fakeSupabase().respond('rpc:email_unsubscribe', {
      error: { message: 'invalid_unsubscribe_link' },
    })
    await expect(emailUnsubscribe(bad.client, 'nope')).rejects.toEqual({
      message: 'invalid_unsubscribe_link',
    })
  })

  it('knows its categories', () => {
    expect(isNotificationCategory('reminders')).toBe(true)
    expect(isNotificationCategory('fax')).toBe(false)
  })
})
