import { describe, expect, it } from 'vitest'
import { PlanError } from './plans'
import {
  closeQuickPoll,
  createQuickPoll,
  deleteQuickPoll,
  fetchQuickPollPreview,
  quickPollKeys,
  quickPollQueries,
  setQuickPollAvailability,
} from './quick-polls'
import { fakeSupabase } from './testing/fake-supabase'

const answers = [
  {
    seat: 1,
    name: 'Ana',
    mine: true,
    slots: [
      { slot_start: '2026-06-01T08:00:00+00:00', level: 'yes' },
      { slot_start: '2026-06-01T08:30:00+00:00', level: 'maybe' },
    ],
  },
  { seat: 2, name: 'Ben', mine: false, slots: [] },
]

const openRow = {
  status: 'open',
  title: 'Board games',
  timezone: 'Europe/Berlin',
  window_start: '2026-06-01',
  window_end: '2026-06-03',
  day_start_minute: 600,
  day_end_minute: 720,
  slot_minutes: 30,
  duration_minutes: 60,
  names_required: true,
  max_people: 10,
  expires_at: '2026-06-08T10:00:00+00:00',
  is_creator: false,
  answers,
}

const expiredRow = Object.fromEntries(
  Object.keys(openRow).map((key) => [key, key === 'status' ? 'expired' : null]),
)

describe('fetchQuickPollPreview', () => {
  it('reads an open poll with its grid and every answer', async () => {
    const fake = fakeSupabase().respond('rpc:quick_poll_preview', { data: [openRow] })

    expect(await fetchQuickPollPreview(fake.client, 'abc', 'tok')).toEqual({
      status: 'open',
      poll: {
        title: 'Board games',
        grid: {
          windowStart: '2026-06-01',
          windowEnd: '2026-06-03',
          dayStartMinute: 600,
          dayEndMinute: 720,
          slotMinutes: 30,
          timeZone: 'Europe/Berlin',
        },
        durationMinutes: 60,
        namesRequired: true,
        maxPeople: 10,
        expiresAt: '2026-06-08T10:00:00+00:00',
      },
      answers,
      isCreator: false,
    })
    expect(fake.rpcArgs('quick_poll_preview')).toEqual([{ code: 'abc', token: 'tok' }])
  })

  it('leaves out a missing token and keeps a missing title and names null', async () => {
    const row = {
      ...openRow,
      status: 'closed',
      title: null,
      names_required: false,
      is_creator: true,
      answers: [{ seat: 1, name: null, mine: false, slots: [] }],
    }
    const fake = fakeSupabase().respond('rpc:quick_poll_preview', { data: [row] })

    const view = await fetchQuickPollPreview(fake.client, 'abc', null)

    expect(fake.rpcArgs('quick_poll_preview')).toEqual([{ code: 'abc' }])
    expect(view).toMatchObject({
      status: 'closed',
      poll: { title: null, namesRequired: false },
      answers: [{ seat: 1, name: null, mine: false, slots: [] }],
      isCreator: true,
    })
  })

  it('shows nothing but the status for an expired poll, or a status it does not know', async () => {
    const fake = fakeSupabase().respond('rpc:quick_poll_preview', { data: [expiredRow] })
    expect(await fetchQuickPollPreview(fake.client, 'abc', null)).toEqual({ status: 'expired' })

    const odd = fakeSupabase().respond('rpc:quick_poll_preview', {
      data: [{ ...openRow, status: 'something-new' }],
    })
    expect(await fetchQuickPollPreview(odd.client, 'abc', null)).toEqual({ status: 'expired' })
  })

  it('reads odd answers defensively', async () => {
    const row = {
      ...openRow,
      answers: [null, { seat: 'x', name: 3, mine: 'yes', slots: [null, { level: 'no' }] }],
    }
    const fake = fakeSupabase().respond('rpc:quick_poll_preview', { data: [row] })
    const view = await fetchQuickPollPreview(fake.client, 'abc', null)
    expect(view.status === 'open' && view.answers).toEqual([
      { seat: 0, name: null, mine: false, slots: [] },
      {
        seat: 0,
        name: null,
        mine: false,
        slots: [
          { slot_start: 'undefined', level: 'yes' },
          { slot_start: 'undefined', level: 'yes' },
        ],
      },
    ])
    const none = fakeSupabase().respond('rpc:quick_poll_preview', {
      data: [{ ...openRow, answers: null }],
    })
    const empty = await fetchQuickPollPreview(none.client, 'abc', null)
    expect(empty.status === 'open' && empty.answers).toEqual([])
  })

  it('throws quick_poll_not_found when nothing comes back, and PlanErrors on failure', async () => {
    for (const fake of [
      fakeSupabase().respond('rpc:quick_poll_preview', { data: [] }),
      fakeSupabase(),
    ]) {
      await expect(fetchQuickPollPreview(fake.client, 'abc', null)).rejects.toMatchObject({
        name: 'PlanError',
        code: 'quick_poll_not_found',
      })
    }
    const failing = fakeSupabase().respond('rpc:quick_poll_preview', {
      error: { message: 'quick_poll_not_found', details: 'This poll is not valid' },
    })
    await expect(fetchQuickPollPreview(failing.client, 'abc', null)).rejects.toMatchObject({
      code: 'quick_poll_not_found',
    })
  })
})

describe('quick poll writes', () => {
  const input = {
    title: 'Board games',
    timeZone: 'UTC',
    windowStart: '2026-06-01',
    windowEnd: '2026-06-03',
    dayStartMinute: 600,
    dayEndMinute: 720,
    durationMinutes: 60,
    slotMinutes: 30 as const,
    ttl: '7d' as const,
    namesRequired: true,
    maxPeople: 15,
  }

  it('creates a poll from one payload and returns the code and creator token', async () => {
    const fake = fakeSupabase().respond('rpc:create_quick_poll', {
      data: [{ code: 'c1', creator_token: 'secret', expires_at: '2026-06-08T10:00:00+00:00' }],
    })

    expect(await createQuickPoll(fake.client, input)).toEqual({
      code: 'c1',
      creatorToken: 'secret',
      expiresAt: '2026-06-08T10:00:00+00:00',
    })
    expect(fake.rpcArgs('create_quick_poll')).toEqual([
      {
        payload: {
          title: 'Board games',
          timezone: 'UTC',
          window_start: '2026-06-01',
          window_end: '2026-06-03',
          day_start_minute: 600,
          day_end_minute: 720,
          duration_minutes: 60,
          slot_minutes: 30,
          ttl: '7d',
          names_required: true,
          max_people: 15,
        },
      },
    ])
  })

  it('saves an answer, sending empty strings for no name and no token', async () => {
    const fake = fakeSupabase().respond('rpc:set_quick_poll_availability', {
      data: [{ answer_token: 'fresh', saved: 1 }],
    })
    const slots = [{ slot_start: 's1', level: 'yes' as const }]

    expect(
      await setQuickPollAvailability(fake.client, { code: 'c', name: null, token: null, slots }),
    ).toEqual({ token: 'fresh', saved: 1 })
    await setQuickPollAvailability(fake.client, { code: 'c', name: 'Ana', token: 'old', slots })

    expect(fake.rpcArgs('set_quick_poll_availability')).toEqual([
      { code: 'c', name: '', token: '', slots },
      { code: 'c', name: 'Ana', token: 'old', slots },
    ])
  })

  it('closes and deletes with the creator token', async () => {
    const fake = fakeSupabase()
    await closeQuickPoll(fake.client, { code: 'c', creatorToken: 'secret' })
    await deleteQuickPoll(fake.client, { code: 'c', creatorToken: 'secret' })
    expect(fake.rpcArgs('close_quick_poll')).toEqual([{ code: 'c', token: 'secret' }])
    expect(fake.rpcArgs('delete_quick_poll')).toEqual([{ code: 'c', token: 'secret' }])
  })

  it('throws PlanErrors from every write, and unknown on an empty reply', async () => {
    const error = { message: 'quick_poll_full' }
    const fake = fakeSupabase()
      .respond('rpc:create_quick_poll', { error })
      .respond('rpc:set_quick_poll_availability', { error })
      .respond('rpc:close_quick_poll', { error })
      .respond('rpc:delete_quick_poll', { error })
    const answer = { code: 'c', name: 'A', token: null, slots: [] }
    const creator = { code: 'c', creatorToken: 'secret' }
    for (const write of [
      () => createQuickPoll(fake.client, input),
      () => setQuickPollAvailability(fake.client, answer),
      () => closeQuickPoll(fake.client, creator),
      () => deleteQuickPoll(fake.client, creator),
    ]) {
      await expect(write()).rejects.toMatchObject({ name: 'PlanError', code: 'quick_poll_full' })
    }
    const blank = fakeSupabase()
      .respond('rpc:create_quick_poll', { data: [] })
      .respond('rpc:set_quick_poll_availability', { data: [] })
    await expect(createQuickPoll(blank.client, input)).rejects.toMatchObject({ code: 'unknown' })
    await expect(setQuickPollAvailability(blank.client, answer)).rejects.toMatchObject({
      code: 'unknown',
    })
  })
})

describe('quickPollQueries', () => {
  it('keys the preview by code and token under quickPollKeys.all', async () => {
    const fake = fakeSupabase().respond('rpc:quick_poll_preview', { data: [expiredRow] })
    const preview = quickPollQueries.preview(fake.client, 'abc', null)

    expect(preview.queryKey).toEqual(['potluck', 'quick-poll', 'abc', ''])
    expect(preview.queryKey.slice(0, 2)).toEqual(quickPollKeys.all)
    expect(quickPollQueries.preview(fake.client, 'abc', 't').queryKey.at(-1)).toBe('t')
    expect(await (preview.queryFn as () => Promise<unknown>)()).toEqual({ status: 'expired' })
  })

  it('does not retry an unknown code, but retries a dropped request twice', () => {
    const { client } = fakeSupabase()
    const retry = quickPollQueries.preview(client, 'abc', null).retry as (
      count: number,
      error: unknown,
    ) => boolean
    expect(retry(0, new PlanError('quick_poll_not_found'))).toBe(false)
    expect(retry(0, new Error('Failed to fetch'))).toBe(true)
    expect(retry(2, new Error('Failed to fetch'))).toBe(false)
  })
})
