import { describe, expect, it } from 'vitest'
import {
  createGuestLink,
  fetchEventGuests,
  fetchGuestLinkPreview,
  fetchGuestLinks,
  fetchGuestSlots,
  guestKeys,
  guestQueries,
  PlanError,
  plansKeys,
  removeGuestAnswer,
  revokeGuestLink,
  setGuestAvailability,
} from './plans'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

const openRow = {
  status: 'open',
  title: 'Picnic',
  emoji: '🧺',
  group_emoji: '🌳',
  host_name: 'Musa',
  timezone: 'Europe/Berlin',
  window_start: '2026-06-01',
  window_end: '2026-06-03',
  day_start_minute: 600,
  day_end_minute: 720,
  slot_minutes: 30,
  duration_minutes: 60,
  expires_at: '2026-06-08T10:00:00Z',
  max_guests: 10,
  guest_count: 2,
  respondents: 4,
  my_name: 'Ana',
  my_slots: [
    { slot_start: '2026-06-01T08:00:00+00:00', level: 'yes' },
    { slot_start: '2026-06-01T08:30:00+00:00', level: 'maybe' },
  ],
  heat: [{ slot_start: '2026-06-01T08:00:00+00:00', yes: 3, maybe: 1 }],
}

const closedRow = Object.fromEntries(
  Object.keys(openRow).map((key) => [key, key === 'status' ? 'expired' : null]),
)

describe('guest link reads', () => {
  it('lists the plan links that still work, newest first', async () => {
    const fake = fakeSupabase().respond('from:event_guest_links', { data: [{ id: 'l1' }] })
    const now = new Date('2026-06-01T00:00:00Z')

    expect(await fetchGuestLinks(fake.client, 'e1', now)).toEqual([{ id: 'l1' }])

    const [query] = fake.queries('event_guest_links')
    expect(argsOf(query!, 'eq')).toEqual([['event_id', 'e1']])
    expect(argsOf(query!, 'is')).toEqual([['revoked_at', null]])
    expect(argsOf(query!, 'gt')).toEqual([['expires_at', now.toISOString()]])
    expect(argsOf(query!, 'order')).toEqual([['created_at', { ascending: false }]])
  })

  it('reads guests without their token and their slots in pages', async () => {
    const fake = fakeSupabase({
      tables: {
        event_guests: [
          { id: 'g2', event_id: 'e1', link_id: 'l1', display_name: 'Ben', created_at: '2' },
          { id: 'g1', event_id: 'e1', link_id: 'l1', display_name: 'Ana', created_at: '1' },
          { id: 'g3', event_id: 'e2', link_id: 'l2', display_name: 'Cy', created_at: '0' },
        ],
        event_guest_availability: [
          { guest_id: 'g1', event_id: 'e1', slot_start: 's1', level: 'yes' },
          { guest_id: 'g3', event_id: 'e2', slot_start: 's1', level: 'yes' },
        ],
      },
    })

    const guests = await fetchEventGuests(fake.client, 'e1')
    expect(guests.map((g) => g.display_name)).toEqual(['Ana', 'Ben'])
    const [query] = fake.queries('event_guests')
    expect(argsOf(query!, 'select')).toEqual([['id, link_id, display_name, created_at']])

    expect(await fetchGuestSlots(fake.client, 'e1')).toEqual([
      { guest_id: 'g1', event_id: 'e1', slot_start: 's1', level: 'yes' },
    ])
  })

  it('returns empty lists when there is nothing, and PlanErrors on failure', async () => {
    const empty = fakeSupabase()
    expect(await fetchGuestLinks(empty.client, 'e1')).toEqual([])
    expect(await fetchEventGuests(empty.client, 'e1')).toEqual([])
    expect(await fetchGuestSlots(empty.client, 'e1')).toEqual([])

    const error = { message: 'not_a_member' }
    const failing = fakeSupabase()
      .respond('from:event_guest_links', { error })
      .respond('from:event_guests', { error })
      .respond('from:event_guest_availability', { error })
      .respond('rpc:guest_link_preview', { error })
    for (const read of [
      () => fetchGuestLinks(failing.client, 'e1'),
      () => fetchEventGuests(failing.client, 'e1'),
      () => fetchGuestSlots(failing.client, 'e1'),
      () => fetchGuestLinkPreview(failing.client, 'c', null),
    ]) {
      await expect(read()).rejects.toMatchObject({ name: 'PlanError', code: 'not_a_member' })
    }
  })
})

describe('fetchGuestLinkPreview', () => {
  it('maps an open link with the plan, the visitor answer and the heat', async () => {
    const fake = fakeSupabase().respond('rpc:guest_link_preview', { data: [openRow] })

    expect(await fetchGuestLinkPreview(fake.client, 'abc', 'tok')).toEqual({
      status: 'open',
      plan: {
        title: 'Picnic',
        emoji: '🧺',
        groupEmoji: '🌳',
        hostName: 'Musa',
        timezone: 'Europe/Berlin',
        window_start: '2026-06-01',
        window_end: '2026-06-03',
        day_start_minute: 600,
        day_end_minute: 720,
        slot_minutes: 30,
        duration_minutes: 60,
        expiresAt: '2026-06-08T10:00:00Z',
        maxGuests: 10,
        guestCount: 2,
      },
      respondents: 4,
      mine: { name: 'Ana', slots: openRow.my_slots },
      heat: openRow.heat,
      scheduled: null,
    })
    expect(fake.rpcArgs('guest_link_preview')).toEqual([{ code: 'abc', token: 'tok' }])
  })

  it('leaves out the token when there is none, and nulls what a full link hides', async () => {
    const full = {
      ...openRow,
      status: 'full',
      emoji: null,
      group_emoji: null,
      host_name: null,
      respondents: null,
      my_name: null,
      my_slots: null,
      heat: null,
    }
    const fake = fakeSupabase().respond('rpc:guest_link_preview', { data: [full] })

    const preview = await fetchGuestLinkPreview(fake.client, 'abc', null)

    expect(fake.rpcArgs('guest_link_preview')).toEqual([{ code: 'abc' }])
    expect(preview).toMatchObject({ status: 'full', respondents: null, mine: null, heat: null })
    expect(preview.plan).toMatchObject({ emoji: null, groupEmoji: null, hostName: null })
    expect(preview.scheduled).toBeNull()
  })

  it('has no plan for a closed link', async () => {
    const fake = fakeSupabase().respond('rpc:guest_link_preview', { data: [closedRow] })
    expect(await fetchGuestLinkPreview(fake.client, 'abc', null)).toEqual({
      status: 'expired',
      plan: null,
      respondents: null,
      mine: null,
      heat: null,
      scheduled: null,
    })
  })

  it('shows the picked time for a scheduled plan', async () => {
    const row = {
      ...closedRow,
      status: 'scheduled',
      title: 'Picnic',
      emoji: null,
      group_emoji: null,
      host_name: 'Musa',
      timezone: 'UTC',
      my_name: 'Ana',
      starts_at: '2026-06-01T10:00:00+00:00',
      ends_at: '2026-06-01T11:00:00+00:00',
    }
    const fake = fakeSupabase().respond('rpc:guest_link_preview', { data: [row] })
    const preview = await fetchGuestLinkPreview(fake.client, 'abc', 'tok')
    expect(preview).toMatchObject({ status: 'scheduled', plan: null, mine: null })
    expect(preview.scheduled).toEqual({
      title: 'Picnic',
      emoji: null,
      groupEmoji: null,
      hostName: 'Musa',
      timezone: 'UTC',
      startsAt: '2026-06-01T10:00:00+00:00',
      endsAt: '2026-06-01T11:00:00+00:00',
      myName: 'Ana',
    })
    const anon = fakeSupabase().respond('rpc:guest_link_preview', {
      data: [{ ...row, emoji: '🧺', group_emoji: '🌳', host_name: null, my_name: null }],
    })
    expect((await fetchGuestLinkPreview(anon.client, 'abc', null)).scheduled).toMatchObject({
      emoji: '🧺',
      groupEmoji: '🌳',
      hostName: null,
      myName: null,
    })
  })

  it('reads a removed answer as its own status', async () => {
    const fake = fakeSupabase().respond('rpc:guest_link_preview', {
      data: [{ ...closedRow, status: 'removed' }],
    })
    expect(await fetchGuestLinkPreview(fake.client, 'abc', 'tok')).toMatchObject({
      status: 'removed',
      scheduled: null,
    })
  })

  it('reads odd payloads defensively', async () => {
    const odd = {
      ...openRow,
      status: 'something-new',
      my_slots: 'nope',
      heat: [null, { slot_start: 's', yes: 'x' }],
    }
    const fake = fakeSupabase().respond('rpc:guest_link_preview', { data: [odd] })
    const preview = await fetchGuestLinkPreview(fake.client, 'abc', 'tok')
    expect(preview.status).toBe('closed')
    expect(preview.plan).toBeNull()
    expect(preview.mine).toBeNull()
    expect(preview.heat).toEqual([
      { slot_start: 'undefined', yes: 0, maybe: 0 },
      { slot_start: 's', yes: 0, maybe: 0 },
    ])
  })

  it('throws guest_link_not_found when nothing comes back', async () => {
    const fake = fakeSupabase().respond('rpc:guest_link_preview', { data: [] })
    await expect(fetchGuestLinkPreview(fake.client, 'abc', null)).rejects.toMatchObject({
      code: 'guest_link_not_found',
    })
    const none = fakeSupabase()
    await expect(fetchGuestLinkPreview(none.client, 'abc', null)).rejects.toMatchObject({
      code: 'guest_link_not_found',
    })
  })
})

describe('guest link writes', () => {
  it('creates a link with an expiry and a cap', async () => {
    const fake = fakeSupabase().respond('rpc:create_guest_link', { data: { id: 'l1' } })
    expect(await createGuestLink(fake.client, { eventId: 'e1', ttl: '7d', maxGuests: 25 })).toEqual(
      { id: 'l1' },
    )
    expect(fake.rpcArgs('create_guest_link')).toEqual([
      { event_id: 'e1', ttl: '7d', max_guests: 25 },
    ])
  })

  it('revokes links and removes guest answers', async () => {
    const fake = fakeSupabase()
    await revokeGuestLink(fake.client, 'l1')
    await removeGuestAnswer(fake.client, 'g1')
    expect(fake.rpcArgs('revoke_guest_link')).toEqual([{ link_id: 'l1' }])
    expect(fake.rpcArgs('remove_guest_answer')).toEqual([{ guest_id: 'g1' }])
  })

  it('saves a guest answer, sending an empty token for a new guest', async () => {
    const fake = fakeSupabase().respond('rpc:set_guest_availability', {
      data: [{ guest_token: 'fresh', saved: 2 }],
    })
    const slots = [{ slot_start: 's1', level: 'yes' as const }]

    expect(
      await setGuestAvailability(fake.client, { code: 'c', name: 'Ana', token: null, slots }),
    ).toEqual({ token: 'fresh', saved: 2 })
    await setGuestAvailability(fake.client, { code: 'c', name: 'Ana', token: 'old', slots })

    expect(fake.rpcArgs('set_guest_availability')).toEqual([
      { code: 'c', name: 'Ana', token: '', slots },
      { code: 'c', name: 'Ana', token: 'old', slots },
    ])
  })

  it('throws PlanErrors from every write', async () => {
    const error = { message: 'guest_link_full' }
    const fake = fakeSupabase()
      .respond('rpc:create_guest_link', { error })
      .respond('rpc:revoke_guest_link', { error })
      .respond('rpc:remove_guest_answer', { error })
      .respond('rpc:set_guest_availability', { error })
    const input = { code: 'c', name: 'A', token: null, slots: [] }
    for (const write of [
      () => createGuestLink(fake.client, { eventId: 'e1', ttl: '24h', maxGuests: 1 }),
      () => revokeGuestLink(fake.client, 'l1'),
      () => removeGuestAnswer(fake.client, 'g1'),
      () => setGuestAvailability(fake.client, input),
    ]) {
      await expect(write()).rejects.toMatchObject({ code: 'guest_link_full' })
    }
    const blank = fakeSupabase().respond('rpc:set_guest_availability', { data: [] })
    await expect(setGuestAvailability(blank.client, input)).rejects.toMatchObject({
      code: 'unknown',
    })
  })
})

describe('guestQueries', () => {
  it('keys member reads under the event so event invalidation covers them', async () => {
    const fake = fakeSupabase()
    const { client } = fake
    const run = (o: { queryFn?: unknown }) => (o.queryFn as () => Promise<unknown>)()

    for (const key of [guestKeys.links('e1'), guestKeys.guests('e1'), guestKeys.slots('e1')]) {
      expect(key.slice(0, 4)).toEqual(plansKeys.event('e1'))
    }
    expect(guestQueries.links(client, 'e1').queryKey).toEqual(guestKeys.links('e1'))
    expect(await run(guestQueries.links(client, 'e1'))).toEqual([])
    expect(await run(guestQueries.guests(client, 'e1'))).toEqual([])
    expect(await run(guestQueries.slots(client, 'e1'))).toEqual([])

    fake.respond('rpc:guest_link_preview', { data: [closedRow] })
    const preview = guestQueries.preview(client, 'abc', null)
    expect(preview.queryKey).toEqual(['potluck', 'guest-link', 'abc', ''])
    expect(guestQueries.preview(client, 'abc', 't').queryKey.at(-1)).toBe('t')
    expect(await run(preview)).toMatchObject({ status: 'expired' })
  })

  it('does not retry an unknown code, but retries a dropped request twice', () => {
    const { client } = fakeSupabase()
    const retry = guestQueries.preview(client, 'abc', null).retry as (
      count: number,
      error: unknown,
    ) => boolean
    expect(retry(0, new PlanError('guest_link_not_found'))).toBe(false)
    expect(retry(0, new Error('Failed to fetch'))).toBe(true)
    expect(retry(2, new Error('Failed to fetch'))).toBe(false)
  })
})
