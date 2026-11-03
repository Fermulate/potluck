import { describe, expect, it } from 'vitest'
import {
  addEventComment,
  cancelEvent,
  createPlanEvent,
  fetchAvailabilityRequests,
  fetchBestSlots,
  fetchBusyBlocks,
  fetchEventAvailability,
  fetchEventComments,
  fetchEventRsvps,
  fetchGroupEvents,
  fetchHomeBalances,
  fetchMyTimeline,
  fetchPastEvents,
  fetchPlanEvent,
  fetchPlanGroups,
  fetchPlanMembers,
  fetchPlanProfile,
  planAvatarUrl,
  PlanError,
  planQueries,
  plansKeys,
  requestAvailability,
  scheduleEvent,
  setAvailability,
  setRsvp,
  type CreatePlanInput,
} from './plans'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

const dbError = { message: 'event_not_polling', details: 'status is scheduled' }

describe('PlanError', () => {
  it('carries the database code and optional details', () => {
    const plain = new PlanError('not_allowed')
    expect(plain).toBeInstanceOf(Error)
    expect(plain.name).toBe('PlanError')
    expect(plain.code).toBe('not_allowed')
    expect(plain.message).toBe('not_allowed')
    expect(new PlanError('x', 'why').message).toBe('x: why')
  })

  it('wraps query errors, falling back to unknown', async () => {
    const fake = fakeSupabase().respond('rpc:cancel_event', { error: dbError })
    await expect(cancelEvent(fake.client, 'e1')).rejects.toMatchObject({
      name: 'PlanError',
      code: 'event_not_polling',
      message: 'event_not_polling: status is scheduled',
    })

    const blank = fakeSupabase().respond('rpc:cancel_event', { error: { message: '' } })
    await expect(cancelEvent(blank.client, 'e1')).rejects.toMatchObject({ code: 'unknown' })
  })
})

describe('fetchPlanProfile', () => {
  it('maps the profile to camelCase', async () => {
    const fake = fakeSupabase().respond('from:profiles', {
      data: {
        id: 'u1',
        display_name: 'Ada',
        timezone: 'Europe/Berlin',
        default_currency: 'EUR',
        locale: 'de',
        avatar_path: null,
      },
    })

    expect(await fetchPlanProfile(fake.client, 'u1')).toEqual({
      id: 'u1',
      displayName: 'Ada',
      timezone: 'Europe/Berlin',
      defaultCurrency: 'EUR',
      locale: 'de',
      avatarPath: null,
    })
    expect(argsOf(fake.queries('profiles')[0]!, 'eq')).toEqual([['id', 'u1']])
  })

  it('throws a PlanError', async () => {
    const fake = fakeSupabase().respond('from:profiles', { error: { message: 'not_allowed' } })
    await expect(fetchPlanProfile(fake.client, 'u1')).rejects.toBeInstanceOf(PlanError)
  })
})

describe('timeline and past events', () => {
  it('reads the timeline for a range', async () => {
    const fake = fakeSupabase().respond('rpc:my_timeline', { data: [{ event_id: 'e1' }] })
    const range = { from: '2026-01-01', to: '2026-02-01' }
    expect(await fetchMyTimeline(fake.client, range)).toEqual([{ event_id: 'e1' }])
    expect(fake.rpcArgs('my_timeline')).toEqual([range])
  })

  it('reads ended events, newest first, 20 by default', async () => {
    const fake = fakeSupabase().respond('from:events', { data: [{ id: 'e1' }] })

    expect(await fetchPastEvents(fake.client, { before: '2026-01-01' })).toEqual([{ id: 'e1' }])
    await fetchPastEvents(fake.client, { before: '2026-01-01', limit: 5 })

    const [first, second] = fake.queries('events')
    expect(argsOf(first!, 'in')).toEqual([['status', ['scheduled', 'done']]])
    expect(argsOf(first!, 'lt')).toEqual([['ends_at', '2026-01-01']])
    expect(argsOf(first!, 'order')).toEqual([['starts_at', { ascending: false }]])
    expect(argsOf(first!, 'limit')).toEqual([[20]])
    expect(argsOf(second!, 'limit')).toEqual([[5]])
  })
})

describe('fetchPlanGroups', () => {
  it('maps groups with their member counts', async () => {
    const fake = fakeSupabase().respond('from:groups', {
      data: [
        {
          id: 'g1',
          name: 'Flat',
          emoji: null,
          color: 'red',
          currency: 'EUR',
          group_members: [{ count: 3 }],
        },
        { id: 'g2', name: 'Trip', emoji: 'x', color: null, currency: 'USD', group_members: [] },
      ],
    })

    expect(await fetchPlanGroups(fake.client)).toEqual([
      { id: 'g1', name: 'Flat', emoji: null, color: 'red', currency: 'EUR', memberCount: 3 },
      { id: 'g2', name: 'Trip', emoji: 'x', color: null, currency: 'USD', memberCount: 0 },
    ])
    const [query] = fake.queries('groups')
    expect(argsOf(query!, 'eq')).toEqual([['is_direct', false]])
    expect(argsOf(query!, 'is')).toEqual([['archived_at', null]])
  })
})

describe('fetchHomeBalances', () => {
  it('joins the viewer balances to their groups', async () => {
    const fake = fakeSupabase()
      .respond('from:group_balances', {
        data: [
          { group_id: 'g1', net_cents: 250 },
          { group_id: 'g2', net_cents: null },
          { group_id: 'gone', net_cents: 9 },
          { group_id: null, net_cents: 9 },
        ],
      })
      .respond('from:groups', {
        data: [
          { id: 'g1', name: 'Flat', emoji: null, currency: 'EUR' },
          { id: 'g2', name: 'Trip', emoji: 'x', currency: 'USD' },
        ],
      })

    expect(await fetchHomeBalances(fake.client, 'u1')).toEqual([
      { groupId: 'g1', groupName: 'Flat', groupEmoji: null, currency: 'EUR', netCents: 250 },
      { groupId: 'g2', groupName: 'Trip', groupEmoji: 'x', currency: 'USD', netCents: 0 },
    ])
    expect(argsOf(fake.queries('group_balances')[0]!, 'eq')).toEqual([['user_id', 'u1']])
  })

  it('throws when either read fails', async () => {
    const balances = fakeSupabase()
      .respond('from:group_balances', { error: { message: 'a' } })
      .respond('from:groups', { data: [] })
    await expect(fetchHomeBalances(balances.client, 'u1')).rejects.toMatchObject({ code: 'a' })

    const groups = fakeSupabase()
      .respond('from:group_balances', { data: [] })
      .respond('from:groups', { error: { message: 'b' } })
    await expect(fetchHomeBalances(groups.client, 'u1')).rejects.toMatchObject({ code: 'b' })
  })
})

describe('fetchPlanMembers', () => {
  it('flattens profiles and flags closed accounts', async () => {
    const fake = fakeSupabase().respond('from:group_members', {
      data: [
        {
          user_id: 'u1',
          role: 'owner',
          profile: { display_name: 'Ada', avatar_path: 'u1/a.jpg', deleted_at: null },
        },
        {
          user_id: 'u2',
          role: 'member',
          profile: { display_name: 'Bo', avatar_path: null, deleted_at: '2026-01-01' },
        },
        { user_id: 'u3', role: 'member', profile: null },
      ],
    })

    expect(await fetchPlanMembers(fake.client, 'g1')).toEqual([
      { userId: 'u1', role: 'owner', displayName: 'Ada', avatarPath: 'u1/a.jpg', deleted: false },
      { userId: 'u2', role: 'member', displayName: 'Bo', avatarPath: null, deleted: true },
      { userId: 'u3', role: 'member', displayName: '', avatarPath: null, deleted: false },
    ])
    const [query] = fake.queries('group_members')
    expect(argsOf(query!, 'eq')).toEqual([['group_id', 'g1']])
    expect(argsOf(query!, 'order')).toEqual([['joined_at']])
  })
})

describe('fetchPlanEvent', () => {
  it('returns the event with its group', async () => {
    const fake = fakeSupabase({
      tables: { events: [{ id: 'e1', group: { name: 'Flat' } }] },
    })
    expect(await fetchPlanEvent(fake.client, 'e1')).toEqual({ id: 'e1', group: { name: 'Flat' } })
  })

  it('throws event_not_found when it is not visible', async () => {
    const fake = fakeSupabase({ tables: { events: [] } })
    await expect(fetchPlanEvent(fake.client, 'e1')).rejects.toMatchObject({
      code: 'event_not_found',
    })
  })
})

describe('event reads', () => {
  const tables = {
    events: [
      { id: 'e1', group_id: 'g1', created_at: '2026-01-01' },
      { id: 'e2', group_id: 'g1', created_at: '2026-02-01' },
      { id: 'e3', group_id: 'g2', created_at: '2026-03-01' },
    ],
    availability: [
      { event_id: 'e1', user_id: 'u1', slot_start: 's1', level: 'yes' },
      { event_id: 'e2', user_id: 'u1', slot_start: 's1', level: 'no' },
    ],
    availability_requests: [{ event_id: 'e1', user_id: 'u2' }],
    event_rsvps: [{ event_id: 'e1', user_id: 'u1', status: 'going' }],
    busy_blocks: [
      { id: 'b1', starts_at: '2026-01-01T09', ends_at: '2026-01-01T10' },
      { id: 'b2', starts_at: '2026-01-01T11', ends_at: '2026-01-01T12' },
      { id: 'b3', starts_at: '2026-01-02T09', ends_at: '2026-01-02T10' },
    ],
    comments: [
      { id: 'c2', event_id: 'e1', deleted_at: null, created_at: '2026-01-02' },
      { id: 'c1', event_id: 'e1', deleted_at: null, created_at: '2026-01-01' },
      { id: 'c3', event_id: 'e1', deleted_at: '2026-01-03', created_at: '2026-01-03' },
    ],
  }
  const { client } = fakeSupabase({ tables })

  it('lists group events newest first', async () => {
    const rows = await fetchGroupEvents(client, 'g1')
    expect(rows.map((r) => r.id)).toEqual(['e2', 'e1'])
  })

  it('filters availability, requests and rsvps by event', async () => {
    expect(await fetchEventAvailability(client, 'e1')).toEqual([tables.availability[0]])
    expect(await fetchAvailabilityRequests(client, 'e1')).toEqual(tables.availability_requests)
    expect(await fetchEventRsvps(client, 'e2')).toEqual([])
  })

  it('reads busy blocks overlapping the range', async () => {
    const rows = await fetchBusyBlocks(client, { from: '2026-01-01T09:30', to: '2026-01-01T11' })
    expect(rows.map((r) => r.id)).toEqual(['b1'])
  })

  it('reads live comments oldest first', async () => {
    const rows = await fetchEventComments(client, 'e1')
    expect(rows.map((r) => r.id)).toEqual(['c1', 'c2'])
  })

  it('asks for five best slots unless told otherwise', async () => {
    const fake = fakeSupabase().respond('rpc:best_slots', { data: [{ slot_start: 's1' }] })
    expect(await fetchBestSlots(fake.client, 'e1')).toEqual([{ slot_start: 's1' }])
    await fetchBestSlots(fake.client, 'e1', 2)
    expect(fake.rpcArgs('best_slots')).toEqual([
      { event_id: 'e1', limit: 5 },
      { event_id: 'e1', limit: 2 },
    ])
  })

  it('returns empty lists when there is no data', async () => {
    const fake = fakeSupabase()
    const range = { from: 'a', to: 'b' }
    expect(await fetchMyTimeline(fake.client, range)).toEqual([])
    expect(await fetchPastEvents(fake.client, { before: 'x' })).toEqual([])
    expect(await fetchPlanGroups(fake.client)).toEqual([])
    expect(await fetchGroupEvents(fake.client, 'g1')).toEqual([])
    expect(await fetchPlanMembers(fake.client, 'g1')).toEqual([])
    expect(await fetchEventAvailability(fake.client, 'e1')).toEqual([])
    expect(await fetchAvailabilityRequests(fake.client, 'e1')).toEqual([])
    expect(await fetchEventRsvps(fake.client, 'e1')).toEqual([])
    expect(await fetchBestSlots(fake.client, 'e1')).toEqual([])
    expect(await fetchBusyBlocks(fake.client, range)).toEqual([])
    expect(await fetchEventComments(fake.client, 'e1')).toEqual([])
  })

  it('throws a PlanError from every read', async () => {
    const error = { message: 'not_allowed' }
    const fake = fakeSupabase()
      .respond('rpc:my_timeline', { error })
      .respond('rpc:best_slots', { error })
      .respond('from:events', { error })
      .respond('from:groups', { error })
      .respond('from:group_members', { error })
      .respond('from:availability', { error })
      .respond('from:availability_requests', { error })
      .respond('from:event_rsvps', { error })
      .respond('from:busy_blocks', { error })
      .respond('from:comments', { error })
    const c = fake.client
    const range = { from: 'a', to: 'b' }
    const reads = [
      () => fetchMyTimeline(c, range),
      () => fetchPastEvents(c, { before: 'x' }),
      () => fetchPlanGroups(c),
      () => fetchGroupEvents(c, 'g1'),
      () => fetchPlanMembers(c, 'g1'),
      () => fetchPlanEvent(c, 'e1'),
      () => fetchEventAvailability(c, 'e1'),
      () => fetchAvailabilityRequests(c, 'e1'),
      () => fetchEventRsvps(c, 'e1'),
      () => fetchBestSlots(c, 'e1'),
      () => fetchBusyBlocks(c, range),
      () => fetchEventComments(c, 'e1'),
    ]
    for (const read of reads) {
      await expect(read()).rejects.toMatchObject({ name: 'PlanError', code: 'not_allowed' })
    }
  })
})

describe('planAvatarUrl', () => {
  it('builds a public avatar URL only when there is a path', () => {
    const { client } = fakeSupabase()
    expect(planAvatarUrl(client, 'u1/a.jpg')).toBe('https://storage.test/avatars/u1/a.jpg')
    expect(planAvatarUrl(client, null)).toBeNull()
  })
})

describe('planQueries', () => {
  it('keys queries per event, group and range', () => {
    const { client } = fakeSupabase()
    const range = { from: 'a', to: 'b' }
    expect(planQueries.timeline(client, range).queryKey).toEqual(plansKeys.timeline('a', 'b'))
    expect(plansKeys.timeline('a', 'b').slice(0, 3)).toEqual(plansKeys.timelineAll())
    expect(planQueries.availability(client, 'e1').queryKey.slice(0, 4)).toEqual(
      plansKeys.event('e1'),
    )
    expect(planQueries.busy(client, 'u1', range).queryKey).toEqual([
      'potluck',
      'plans',
      'busy',
      'u1',
      'a',
      'b',
    ])
    expect(planQueries.members(client, 'g1').staleTime).toBe(60_000)
  })

  it('runs the matching fetcher', async () => {
    const fake = fakeSupabase()
      .respond('from:profiles', {
        data: { id: 'u1', display_name: 'A', timezone: 'UTC', default_currency: 'EUR' },
      })
      .respond('from:events', { data: [] }, { data: [] }, { data: { id: 'e1' } })
      .respond('from:groups', { data: [] })
      .respond('from:group_balances', { data: [] })
    const { client } = fake
    const run = (o: { queryFn?: unknown }) => (o.queryFn as () => Promise<unknown>)()
    const range = { from: 'a', to: 'b' }

    expect(await run(planQueries.profile(client, 'u1'))).toMatchObject({ displayName: 'A' })
    expect(await run(planQueries.timeline(client, range))).toEqual([])
    expect(await run(planQueries.past(client, '2026-01-01'))).toEqual([])
    expect(await run(planQueries.groups(client))).toEqual([])
    expect(await run(planQueries.homeBalances(client, 'u1'))).toEqual([])
    expect(await run(planQueries.groupEvents(client, 'g1'))).toEqual([])
    expect(await run(planQueries.members(client, 'g1'))).toEqual([])
    expect(await run(planQueries.event(client, 'e1'))).toEqual({ id: 'e1' })
    expect(await run(planQueries.availability(client, 'e1'))).toEqual([])
    expect(await run(planQueries.requests(client, 'e1'))).toEqual([])
    expect(await run(planQueries.rsvps(client, 'e1'))).toEqual([])
    expect(await run(planQueries.bestSlots(client, 'e1'))).toEqual([])
    expect(await run(planQueries.comments(client, 'e1'))).toEqual([])
    expect(await run(planQueries.busy(client, 'u1', range))).toEqual([])

    expect(fake.rpcArgs('my_timeline')).toEqual([range])
    expect(argsOf(fake.queries('events')[0]!, 'lt')).toEqual([['ends_at', '2026-01-01']])
  })
})

describe('mutations', () => {
  const input: CreatePlanInput = {
    group_id: 'g1',
    title: 'Dinner',
    description: null,
    location: null,
    emoji: null,
    window_start: '2026-01-01',
    window_end: '2026-01-07',
    day_start_minute: 540,
    day_end_minute: 1320,
    slot_minutes: 30,
    duration_minutes: 120,
    min_attendees: 2,
    rsvp_deadline: null,
    timezone: 'Europe/Berlin',
  }

  it('creates an event from the input as is', async () => {
    const fake = fakeSupabase().respond('from:events', { data: { id: 'e1', ...input } })
    expect(await createPlanEvent(fake.client, input)).toMatchObject({ id: 'e1' })
    expect(argsOf(fake.queries('events')[0]!, 'insert')).toEqual([[input]])
  })

  it('requests availability from everyone or from chosen people', async () => {
    const fake = fakeSupabase().respond('rpc:request_availability', { data: 3 }, { data: null })

    expect(await requestAvailability(fake.client, 'e1', null)).toBe(3)
    expect(await requestAvailability(fake.client, 'e1', [])).toBe(0)
    await requestAvailability(fake.client, 'e1', ['u2'])

    expect(fake.rpcArgs('request_availability')).toEqual([
      { event_id: 'e1' },
      { event_id: 'e1' },
      { event_id: 'e1', user_ids: ['u2'] },
    ])
  })

  it('replaces availability and reports the count', async () => {
    const fake = fakeSupabase().respond('rpc:set_availability', { data: 2 }, { data: null })
    const slots = [{ slot_start: 's1', level: 'yes' as const }]

    expect(await setAvailability(fake.client, 'e1', slots)).toBe(2)
    expect(await setAvailability(fake.client, 'e1', [])).toBe(0)
    expect(fake.rpcArgs('set_availability')[0]).toEqual({ event_id: 'e1', slots })
  })

  it('schedules and cancels events', async () => {
    const fake = fakeSupabase()
      .respond('rpc:schedule_event', { data: { id: 'e1', status: 'scheduled' } })
      .respond('rpc:cancel_event', { data: { id: 'e1', status: 'cancelled' } })

    expect(await scheduleEvent(fake.client, 'e1', '2026-01-02T18:00')).toMatchObject({
      status: 'scheduled',
    })
    expect(await cancelEvent(fake.client, 'e1')).toMatchObject({ status: 'cancelled' })
    expect(fake.rpcArgs('schedule_event')).toEqual([
      { event_id: 'e1', starts_at: '2026-01-02T18:00' },
    ])
    expect(fake.rpcArgs('cancel_event')).toEqual([{ event_id: 'e1' }])
  })

  it('updates an existing rsvp without inserting', async () => {
    const fake = fakeSupabase().respond('from:event_rsvps', { data: [{ event_id: 'e1' }] })

    await setRsvp(fake.client, 'e1', 'u1', 'going')

    const queries = fake.queries('event_rsvps')
    expect(queries).toHaveLength(1)
    expect(argsOf(queries[0]!, 'update')).toEqual([[{ status: 'going' }]])
    expect(argsOf(queries[0]!, 'eq')).toEqual([
      ['event_id', 'e1'],
      ['user_id', 'u1'],
    ])
  })

  it('inserts an rsvp when there was none to update', async () => {
    const fake = fakeSupabase().respond('from:event_rsvps', { data: [] }, { data: null })

    await setRsvp(fake.client, 'e1', 'u1', 'maybe')

    const [, insert] = fake.queries('event_rsvps')
    expect(argsOf(insert!, 'insert')).toEqual([
      [{ event_id: 'e1', user_id: 'u1', status: 'maybe' }],
    ])
  })

  it('adds a comment sending only the event and body', async () => {
    const fake = fakeSupabase().respond('from:comments', { data: { id: 'c1', body: 'hi' } })
    expect(await addEventComment(fake.client, { eventId: 'e1', body: 'hi' })).toEqual({
      id: 'c1',
      body: 'hi',
    })
    expect(argsOf(fake.queries('comments')[0]!, 'insert')).toEqual([
      [{ event_id: 'e1', body: 'hi' }],
    ])
  })

  it('throws a PlanError from every write', async () => {
    const error = { message: 'not_allowed' }
    const fake = fakeSupabase()
      .respond('from:events', { error })
      .respond('rpc:request_availability', { error })
      .respond('rpc:set_availability', { error })
      .respond('rpc:schedule_event', { error })
      .respond('from:comments', { error })
    const c = fake.client
    const writes = [
      () => createPlanEvent(c, input),
      () => requestAvailability(c, 'e1', null),
      () => setAvailability(c, 'e1', []),
      () => scheduleEvent(c, 'e1', 'x'),
      () => addEventComment(c, { eventId: 'e1', body: 'x' }),
    ]
    for (const write of writes) {
      await expect(write()).rejects.toMatchObject({ code: 'not_allowed' })
    }

    const update = fakeSupabase().respond('from:event_rsvps', { error })
    await expect(setRsvp(update.client, 'e1', 'u1', 'going')).rejects.toMatchObject({
      code: 'not_allowed',
    })
    const insert = fakeSupabase().respond('from:event_rsvps', { data: [] }, { error })
    await expect(setRsvp(insert.client, 'e1', 'u1', 'going')).rejects.toMatchObject({
      code: 'not_allowed',
    })
  })
})
