import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appConfigQueryOptions,
  avatarUrl,
  calendarFeedTokenQueryOptions,
  calendarFeedUrl,
  deleteMyAccount,
  deletePushToken,
  fetchAppConfig,
  fetchCalendarFeedToken,
  fetchMyProfile,
  fetchNotifications,
  fetchProfilesByIds,
  fetchPushTokens,
  fetchUnreadCount,
  isFlagOn,
  markAllNotificationsRead,
  markNotificationsRead,
  meKeys,
  myProfileQueryOptions,
  notificationsQueryOptions,
  profilesByIdsQueryOptions,
  removeAvatarFile,
  savePushToken,
  unreadCountQueryOptions,
  updateMyProfile,
  uploadAvatar,
} from './me'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

const boom = { message: 'not_allowed' }
const now = new Date('2026-03-04T05:06:07Z')

afterEach(() => {
  vi.useRealTimers()
})

describe('profile', () => {
  it('reads and updates the viewer profile by id', async () => {
    const fake = fakeSupabase().respond('from:profiles', { data: { id: 'u1', locale: 'de' } })

    expect(await fetchMyProfile(fake.client, 'u1')).toEqual({ id: 'u1', locale: 'de' })
    expect(await updateMyProfile(fake.client, 'u1', { locale: 'de' })).toEqual({
      id: 'u1',
      locale: 'de',
    })

    const [read, write] = fake.queries('profiles')
    expect(argsOf(read!, 'eq')).toEqual([['id', 'u1']])
    expect(argsOf(write!, 'update')).toEqual([[{ locale: 'de' }]])
    expect(argsOf(write!, 'eq')).toEqual([['id', 'u1']])
  })

  it('throws profile errors', async () => {
    const fake = fakeSupabase().respond('from:profiles', { error: boom })
    await expect(fetchMyProfile(fake.client, 'u1')).rejects.toBe(boom)
    await expect(updateMyProfile(fake.client, 'u1', {})).rejects.toBe(boom)
  })
})

describe('fetchProfilesByIds', () => {
  it('asks once for each distinct id, sorted', async () => {
    const fake = fakeSupabase({
      tables: { profiles: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    })

    const rows = await fetchProfilesByIds(fake.client, ['c', 'a', '', 'c'])

    expect(rows).toEqual([{ id: 'a' }, { id: 'c' }])
    expect(argsOf(fake.queries('profiles')[0]!, 'in')).toEqual([['id', ['a', 'c']]])
  })

  it('skips the request when there is nobody to look up', async () => {
    const fake = fakeSupabase()
    expect(await fetchProfilesByIds(fake.client, ['', ''])).toEqual([])
    expect(fake.calls).toHaveLength(0)
  })

  it('handles empty and failed reads', async () => {
    const empty = fakeSupabase().respond('from:profiles', { data: null })
    expect(await fetchProfilesByIds(empty.client, ['a'])).toEqual([])

    const failing = fakeSupabase().respond('from:profiles', { error: boom })
    await expect(fetchProfilesByIds(failing.client, ['a'])).rejects.toBe(boom)
  })

  it('shares one cache entry for the same set of people in any order', () => {
    const { client } = fakeSupabase()
    const a = profilesByIdsQueryOptions(client, ['b', 'a', 'b'])
    const b = profilesByIdsQueryOptions(client, ['a', 'b'])
    expect(a.queryKey).toEqual(['potluck', 'me', 'people', 'a', 'b'])
    expect(b.queryKey).toEqual(a.queryKey)
  })
})

describe('avatars', () => {
  it('builds a public URL only when there is a path', () => {
    const { client } = fakeSupabase()
    expect(avatarUrl(client, 'u1/a.jpg')).toBe('https://storage.test/avatars/u1/a.jpg')
    expect(avatarUrl(client, null)).toBeNull()
    expect(avatarUrl(client, undefined)).toBeNull()
  })

  it('uploads under the user folder with a fresh name and long cache', async () => {
    vi.useFakeTimers({ now })
    const fake = fakeSupabase()

    const path = await uploadAvatar(fake.client, 'u1', new Uint8Array([1]), 'image/jpeg')

    expect(path).toBe(`u1/${now.getTime().toString(36)}.jpg`)
    const [upload] = fake.storageCalls('avatars')
    expect(upload!.method).toBe('upload')
    expect(upload!.args[0]).toBe(path)
    expect(upload!.args[2]).toEqual({
      contentType: 'image/jpeg',
      upsert: false,
      cacheControl: '31536000',
    })
  })

  it('keeps other image types and falls back to img', async () => {
    const fake = fakeSupabase()
    expect(await uploadAvatar(fake.client, 'u1', new Uint8Array(), 'image/png')).toMatch(/\.png$/)
    expect(await uploadAvatar(fake.client, 'u1', new Uint8Array(), 'binary')).toMatch(/\.img$/)
  })

  it('removes a file and throws storage errors', async () => {
    const fake = fakeSupabase()
    await removeAvatarFile(fake.client, 'u1/a.jpg')
    expect(fake.storageCalls('avatars')[0]).toMatchObject({
      method: 'remove',
      args: [['u1/a.jpg']],
    })

    const failing = fakeSupabase()
      .respond('storage:avatars.upload', { error: boom })
      .respond('storage:avatars.remove', { error: boom })
    await expect(uploadAvatar(failing.client, 'u1', new Uint8Array(), 'image/png')).rejects.toBe(
      boom,
    )
    await expect(removeAvatarFile(failing.client, 'u1/a.jpg')).rejects.toBe(boom)
  })
})

describe('notifications', () => {
  it('reads the latest page for the user', async () => {
    const fake = fakeSupabase().respond('from:notifications', { data: [{ id: 'n1' }] })

    expect(await fetchNotifications(fake.client, 'u1')).toEqual([{ id: 'n1' }])
    const [query] = fake.queries('notifications')
    expect(argsOf(query!, 'eq')).toEqual([['user_id', 'u1']])
    expect(argsOf(query!, 'order')).toEqual([['created_at', { ascending: false }]])
    expect(argsOf(query!, 'limit')).toEqual([[50]])
  })

  it('counts unread notifications with a head request', async () => {
    const fake = fakeSupabase().respond('from:notifications', { count: 7 })

    expect(await fetchUnreadCount(fake.client, 'u1')).toBe(7)
    const [query] = fake.queries('notifications')
    expect(argsOf(query!, 'select')).toEqual([['id', { count: 'exact', head: true }]])
    expect(argsOf(query!, 'is')).toEqual([['read_at', null]])
  })

  it('treats missing data and counts as empty', async () => {
    const fake = fakeSupabase().respond('from:notifications', { data: null, count: null })
    expect(await fetchNotifications(fake.client, 'u1')).toEqual([])
    expect(await fetchUnreadCount(fake.client, 'u1')).toBe(0)
  })

  it('marks only the given unread notifications as read', async () => {
    vi.useFakeTimers({ now })
    const fake = fakeSupabase()

    await markNotificationsRead(fake.client, [])
    expect(fake.calls).toHaveLength(0)

    await markNotificationsRead(fake.client, ['n1', 'n2'])
    await markAllNotificationsRead(fake.client, 'u1')

    const [some, all] = fake.queries('notifications')
    expect(argsOf(some!, 'update')).toEqual([[{ read_at: now.toISOString() }]])
    expect(argsOf(some!, 'in')).toEqual([['id', ['n1', 'n2']]])
    expect(argsOf(some!, 'is')).toEqual([['read_at', null]])
    expect(argsOf(all!, 'eq')).toEqual([['user_id', 'u1']])
    expect(argsOf(all!, 'is')).toEqual([['read_at', null]])
  })

  it('throws notification errors', async () => {
    const fake = fakeSupabase().respond('from:notifications', { error: boom })
    await expect(fetchNotifications(fake.client, 'u1')).rejects.toBe(boom)
    await expect(fetchUnreadCount(fake.client, 'u1')).rejects.toBe(boom)
    await expect(markNotificationsRead(fake.client, ['n1'])).rejects.toBe(boom)
    await expect(markAllNotificationsRead(fake.client, 'u1')).rejects.toBe(boom)
  })
})

describe('push tokens', () => {
  it('lists the user tokens', async () => {
    const fake = fakeSupabase({
      tables: {
        push_tokens: [
          { user_id: 'u1', token: 't1' },
          { user_id: 'u2', token: 't2' },
        ],
      },
    })
    expect(await fetchPushTokens(fake.client, 'u1')).toEqual([{ user_id: 'u1', token: 't1' }])
  })

  it('upserts a registration keyed on user and token', async () => {
    vi.useFakeTimers({ now })
    const fake = fakeSupabase()

    await savePushToken(fake.client, 'u1', { token: 't1', platform: 'web' })
    await savePushToken(fake.client, 'u1', {
      token: 't2',
      platform: 'web',
      subscription: { endpoint: 'e' },
    })

    const [first, second] = fake.queries('push_tokens')
    expect(argsOf(first!, 'upsert')).toEqual([
      [
        {
          user_id: 'u1',
          token: 't1',
          platform: 'web',
          subscription: null,
          last_seen_at: now.toISOString(),
        },
        { onConflict: 'user_id,token' },
      ],
    ])
    expect(argsOf(second!, 'upsert')[0]![0]).toMatchObject({ subscription: { endpoint: 'e' } })
  })

  it('deletes one token for the user', async () => {
    const fake = fakeSupabase()
    await deletePushToken(fake.client, 'u1', 't1')
    const [query] = fake.queries('push_tokens')
    expect(argsOf(query!, 'delete')).toHaveLength(1)
    expect(argsOf(query!, 'eq')).toEqual([
      ['user_id', 'u1'],
      ['token', 't1'],
    ])
  })

  it('handles empty and failed requests', async () => {
    const empty = fakeSupabase().respond('from:push_tokens', { data: null })
    expect(await fetchPushTokens(empty.client, 'u1')).toEqual([])

    const fake = fakeSupabase().respond('from:push_tokens', { error: boom })
    await expect(fetchPushTokens(fake.client, 'u1')).rejects.toBe(boom)
    await expect(savePushToken(fake.client, 'u1', { token: 't', platform: 'web' })).rejects.toBe(
      boom,
    )
    await expect(deletePushToken(fake.client, 'u1', 't')).rejects.toBe(boom)
  })
})

describe('app config', () => {
  it('turns key/value rows into an object', async () => {
    const fake = fakeSupabase().respond('from:app_config', {
      data: [
        { key: 'plans', value: true },
        { key: 'min_version', value: '1.2.0' },
      ],
    })
    expect(await fetchAppConfig(fake.client)).toEqual({ plans: true, min_version: '1.2.0' })
  })

  it('handles empty and failed reads', async () => {
    const empty = fakeSupabase().respond('from:app_config', { data: null })
    expect(await fetchAppConfig(empty.client)).toEqual({})

    const failing = fakeSupabase().respond('from:app_config', { error: boom })
    await expect(fetchAppConfig(failing.client)).rejects.toBe(boom)
  })

  it('treats only literal true as a flag that is on', () => {
    const config = { a: true, b: 'true', c: 1, d: false }
    expect(isFlagOn(config, 'a')).toBe(true)
    expect(isFlagOn(config, 'b')).toBe(false)
    expect(isFlagOn(config, 'c')).toBe(false)
    expect(isFlagOn(config, 'd')).toBe(false)
    expect(isFlagOn(config, 'missing')).toBe(false)
    expect(isFlagOn(undefined, 'a')).toBe(false)
  })
})

describe('account', () => {
  it('closes the account through the delete-account function', async () => {
    const fake = fakeSupabase()
    await deleteMyAccount(fake.client)
    expect(fake.calls).toEqual([
      { kind: 'functions', name: 'delete-account', args: [{ method: 'POST' }] },
    ])

    const failing = fakeSupabase().respond('functions:delete-account', { error: boom })
    await expect(deleteMyAccount(failing.client)).rejects.toBe(boom)
  })
})

describe('calendar feed', () => {
  it('reads the token and rotates it on request', async () => {
    const fake = fakeSupabase().respond('rpc:calendar_feed_token', { data: 'tok' })

    expect(await fetchCalendarFeedToken(fake.client)).toBe('tok')
    await fetchCalendarFeedToken(fake.client, true)

    expect(fake.rpcArgs('calendar_feed_token')).toEqual([{ rotate: false }, { rotate: true }])

    const failing = fakeSupabase().respond('rpc:calendar_feed_token', { error: boom })
    await expect(fetchCalendarFeedToken(failing.client)).rejects.toBe(boom)
  })

  it('builds the subscribe URL with or without a trailing slash', () => {
    expect(calendarFeedUrl('https://x.supabase.co/', 'a b')).toBe(
      'https://x.supabase.co/functions/v1/ics-feed?token=a%20b',
    )
    expect(calendarFeedUrl('https://x.supabase.co', 't')).toBe(
      'https://x.supabase.co/functions/v1/ics-feed?token=t',
    )
  })
})

describe('query options', () => {
  it('uses the me keys and runs the fetchers', async () => {
    const fake = fakeSupabase()
      .respond('from:profiles', { data: [] })
      .respond('from:notifications', { data: [], count: 2 })
      .respond('from:app_config', { data: [] })
      .respond('rpc:calendar_feed_token', { data: 'tok' })
    const { client } = fake
    const run = (o: { queryFn?: unknown }) => (o.queryFn as () => Promise<unknown>)()

    const profile = myProfileQueryOptions(client, 'u1')
    const people = profilesByIdsQueryOptions(client, ['u2'])
    const notifications = notificationsQueryOptions(client, 'u1')
    const unread = unreadCountQueryOptions(client, 'u1')
    const config = appConfigQueryOptions(client)
    const feed = calendarFeedTokenQueryOptions(client, 'u1')

    expect(profile.queryKey).toEqual(meKeys.profile('u1'))
    expect(notifications.queryKey).toEqual(meKeys.notifications('u1'))
    expect(unread.queryKey).toEqual(['potluck', 'me', 'notifications', 'u1', 'unread'])
    expect(config.queryKey).toEqual(meKeys.appConfig)
    expect(feed.queryKey).toEqual(['potluck', 'me', 'calendar-feed', 'u1'])
    expect(feed.staleTime).toBe(Infinity)

    expect(await run(profile)).toEqual([])
    expect(await run(people)).toEqual([])
    expect(await run(notifications)).toEqual([])
    expect(await run(unread)).toBe(2)
    expect(await run(config)).toEqual({})
    expect(await run(feed)).toBe('tok')
    expect(fake.rpcArgs('calendar_feed_token')).toEqual([{ rotate: false }])
  })
})
