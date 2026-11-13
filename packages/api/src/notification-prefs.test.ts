import { describe, expect, it } from 'vitest'
import {
  emailUnsubscribe,
  fetchNotificationPrefs,
  isNotificationCategory,
  notificationPrefKeys,
  notificationPrefsQueryOptions,
  setNotificationPref,
  unsubscribePreviewQueryOptions,
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

  it('previews, applies and undoes an unsubscribe link', async () => {
    const fake = fakeSupabase()
      .respond('rpc:email_unsubscribe', {
        data: { category: 'payments', email: 'a***@x.y', subscribed: true },
      })
      .respond('rpc:email_unsubscribe', {
        data: { category: 'all', email: null, subscribed: false },
      })
      .respond('rpc:email_unsubscribe', { data: { category: 'something_new' } })
    expect(await emailUnsubscribe(fake.client, 'tok', 'preview')).toEqual({
      category: 'payments',
      email: 'a***@x.y',
      subscribed: true,
    })
    expect(await emailUnsubscribe(fake.client, 'tok', 'unsubscribe')).toEqual({
      category: 'all',
      email: null,
      subscribed: false,
    })
    expect(await emailUnsubscribe(fake.client, 'tok', 'undo')).toEqual({
      category: null,
      email: null,
      subscribed: false,
    })
    expect(fake.calls.map((c) => (c as { args: unknown }).args)).toEqual([
      { token: 'tok', action: 'preview' },
      { token: 'tok', action: 'unsubscribe' },
      { token: 'tok', action: 'undo' },
    ])

    const empty = fakeSupabase()
    expect(await emailUnsubscribe(empty.client, 'tok', 'preview')).toEqual({
      category: null,
      email: null,
      subscribed: false,
    })
    const bad = fakeSupabase().respond('rpc:email_unsubscribe', {
      error: { message: 'invalid_unsubscribe_link' },
    })
    await expect(emailUnsubscribe(bad.client, 'nope', 'preview')).rejects.toEqual({
      message: 'invalid_unsubscribe_link',
    })
  })

  it('previews a link through query options keyed by token', async () => {
    const fake = fakeSupabase().respond('rpc:email_unsubscribe', {
      data: { category: 'comments', email: 'b***@x.y', subscribed: true },
    })
    const options = unsubscribePreviewQueryOptions(fake.client, 'tok')
    expect(options.queryKey).toEqual(['potluck', 'unsubscribe', 'tok'])
    expect(await options.queryFn!({} as never)).toMatchObject({ category: 'comments' })
    expect(fake.calls[0]).toMatchObject({ args: { token: 'tok', action: 'preview' } })
  })

  it('knows its categories', () => {
    expect(isNotificationCategory('reminders')).toBe(true)
    expect(isNotificationCategory('fax')).toBe(false)
  })
})
