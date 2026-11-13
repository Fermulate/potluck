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
    expect(view.link).toEqual({ to: '/payments/$paymentId', params: { paymentId: 'x1' } })
  })

  it('describes payment edits, restores and comments, linking to the payment', () => {
    const restored = describeActivity(
      item({ verb: 'settlement.restored', data: { from_user: 'ben', to_user: ME } }),
      ctx,
    )
    expect(restored.text).toBe('Ben restored a payment to you')
    expect(restored.link).toEqual({ to: '/payments/$paymentId', params: { paymentId: 'x1' } })
    const comment = describeActivity(
      item({ verb: 'comment.created', data: { settlement_id: 's9', excerpt: 'Cash' } }),
      ctx,
    )
    expect(comment.text).toBe('Ben commented on a payment')
    expect(comment.link).toEqual({ to: '/payments/$paymentId', params: { paymentId: 's9' } })
    const noSubject = describeActivity(
      item({ verb: 'settlement.deleted', subject_id: null, data: { to_user: 'ben' } }),
      ctx,
    )
    expect(noSubject.emoji).toBe('🗑️')
    expect(noSubject.link).toEqual({ to: '/groups/$groupId/balances', params: { groupId: 'g1' } })
  })

  it('phrases every verb in the second person when the viewer did it', () => {
    const mine = (verb: string, data: Record<string, unknown> = {}) =>
      describeActivity(item({ actor_id: ME, verb, data }), ctx).text
    expect(mine('member.joined')).toBe('You joined the group')
    expect(
      mine('expense.created', { description: 'Tacos', amount_cents: 4500, currency: 'USD' }),
    ).toBe('You added "Tacos" ($45.00)')
    expect(
      mine('settlement.created', { to_user: 'ben', amount_cents: 2000, currency: 'EUR' }),
    ).toBe('You paid Ben €20.00')
    expect(mine('comment.created', { expense_id: 'x1' })).toBe('You commented on an expense')
  })

  it('has its own line when someone else acted on the viewer', () => {
    const view = describeActivity(
      item({ verb: 'member.role_changed', data: { user_id: ME, to: 'admin' } }),
      ctx,
    )
    expect(view.text).toBe('Ben made you admin')
    const removed = describeActivity(item({ verb: 'member.removed', data: { user_id: ME } }), ctx)
    expect(removed.text).toBe('Ben removed you')
    const other = describeActivity(item({ verb: 'member.removed', data: { user_id: 'cleo' } }), ctx)
    expect(other.text).toBe('Ben removed Cleo')
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
