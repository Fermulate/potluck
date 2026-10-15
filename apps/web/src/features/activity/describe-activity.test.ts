import type { ActivityItem } from '@potluck/api'
import { describe, expect, it } from 'vitest'
import { describeActivity } from './describe-activity'

const ME = 'me'
const names: Record<string, string> = { me: 'You', ben: 'Ben', cleo: 'Cleo' }
const ctx = {
  viewerId: ME,
  timeZone: 'UTC',
  nameOf: (id: string | null | undefined, { lower = false } = {}) => {
    const name = names[id ?? ''] ?? 'Someone'
    return lower && id === ME ? 'you' : name
  },
}

function item(patch: Partial<ActivityItem>): ActivityItem {
  return {
    id: 'a1',
    group_id: 'g1',
    actor_id: 'ben',
    verb: 'expense.created',
    subject_id: 'x1',
    data: {},
    created_at: '2026-11-04T18:00:00Z',
    actor: null,
    group: { id: 'g1', name: 'Hike crew', emoji: '🥾', is_direct: false },
    ...patch,
  }
}

describe('describeActivity', () => {
  it('renders expense verbs with the amount and links to the expense', () => {
    const view = describeActivity(
      item({ data: { description: 'Tacos', amount_cents: 4500, currency: 'USD' } }),
      ctx,
    )
    expect(view.text).toBe('Ben added "Tacos" ($45.00)')
    expect(view.link).toEqual({ to: '/expenses/$expenseId', params: { expenseId: 'x1' } })
  })

  it('names the person paid, as "you" when it was you', () => {
    const view = describeActivity(
      item({
        verb: 'settlement.created',
        data: { from_user: 'ben', to_user: ME, amount_cents: 2000, currency: 'EUR' },
      }),
      ctx,
    )
    expect(view.text).toBe('Ben paid you €20.00')
    expect(view.link).toEqual({ to: '/groups/$groupId/balances', params: { groupId: 'g1' } })
  })

  it('uses own-action phrasing for the viewer', () => {
    const view = describeActivity(
      item({ actor_id: ME, verb: 'event.created', data: { title: 'Taco night', emoji: '🌮' } }),
      ctx,
    )
    expect(view.text).toBe('You are planning 🌮 Taco night')
    expect(view.link).toEqual({ to: '/plans/$eventId', params: { eventId: 'x1' } })
  })

  it('shows comment excerpts and links to what was commented on', () => {
    const view = describeActivity(
      item({ verb: 'comment.created', data: { expense_id: 'e9', excerpt: 'Tip included?' } }),
      ctx,
    )
    expect(view.text).toBe('Ben commented on an expense')
    expect(view.detail).toBe('Tip included?')
    expect(view.link).toEqual({ to: '/expenses/$expenseId', params: { expenseId: 'e9' } })
  })

  it('falls back politely for verbs it does not know', () => {
    expect(describeActivity(item({ verb: 'mystery.happened' }), ctx).text).toBe('Ben made a change')
  })
})
