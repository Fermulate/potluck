import { describe, expect, it } from 'vitest'
import {
  friendTotals,
  MAX_PAYMENT_CENTS,
  paymentProblem,
  settleAllPayments,
  type PaymentCheck,
} from '../index'

describe('paymentProblem', () => {
  // Same order and cases as private.check_payment (23_payments.test.sql, settle_up_v2).
  const base: PaymentCheck = {
    viewerId: 'a',
    viewerRole: 'member',
    fromUser: 'b',
    toUser: 'a',
    amountCents: 2000,
    memberIds: ['o', 'ad', 'a', 'b', 'c'],
  }

  it('lets a member record that someone paid them', () => {
    expect(paymentProblem(base)).toBeNull()
  })

  it('stops a member recording a payment between two others', () => {
    expect(paymentProblem({ ...base, fromUser: 'b', toUser: 'c' })).toBe('not_a_party')
  })

  it('lets owners and admins record between two others', () => {
    expect(paymentProblem({ ...base, viewerRole: 'admin', fromUser: 'b', toUser: 'c' })).toBeNull()
    expect(paymentProblem({ ...base, viewerRole: 'owner', fromUser: 'b', toUser: 'c' })).toBeNull()
  })

  it('refuses amounts out of range', () => {
    expect(paymentProblem({ ...base, amountCents: 0 })).toBe('invalid_amount')
    expect(paymentProblem({ ...base, amountCents: null })).toBe('invalid_amount')
    expect(paymentProblem({ ...base, amountCents: 1.5 })).toBe('invalid_amount')
    expect(paymentProblem({ ...base, amountCents: MAX_PAYMENT_CENTS + 1 })).toBe('invalid_amount')
    expect(paymentProblem({ ...base, amountCents: MAX_PAYMENT_CENTS })).toBeNull()
  })

  it('needs two different people', () => {
    expect(paymentProblem({ ...base, fromUser: 'a', toUser: 'a' })).toBe('invalid_parties')
    expect(paymentProblem({ ...base, toUser: null })).toBe('invalid_parties')
  })

  it('needs both people in the group', () => {
    expect(paymentProblem({ ...base, fromUser: 'x' })).toBe('member_not_in_group')
  })

  it('refuses outsiders first as not a party', () => {
    expect(paymentProblem({ ...base, viewerRole: undefined })).toBe('not_a_party')
  })
})

describe('settleAllPayments', () => {
  it('keeps the debts you are in, between current members', () => {
    // Same group as "settle_all records every debt involving you" in 23_payments.test.sql.
    const debts = [
      { fromUser: 'b', toUser: 'a', amountCents: 300 },
      { fromUser: 'c', toUser: 'a', amountCents: 300 },
      { fromUser: 'c', toUser: 'b', amountCents: 300 },
      { fromUser: 'gone', toUser: 'a', amountCents: 10 },
    ]
    expect(settleAllPayments(debts, 'a', ['a', 'b', 'c'])).toEqual([
      { fromUser: 'b', toUser: 'a', amountCents: 300 },
      { fromUser: 'c', toUser: 'a', amountCents: 300 },
    ])
    expect(settleAllPayments(debts, 'c', ['a', 'b', 'c'])).toHaveLength(2)
  })
})

describe('friendTotals', () => {
  it('adds up per friend and currency, keeping archived groups apart', () => {
    // The friend_balances rows from 23_payments.test.sql.
    const totals = friendTotals([
      { friendId: 'fb', groupId: 'f1', currency: 'USD', netCents: 500, archived: false },
      { friendId: 'fb', groupId: 'f2', currency: 'EUR', netCents: 300, archived: false },
      { friendId: 'fb', groupId: 'f3', currency: 'USD', netCents: -100, archived: false },
      { friendId: 'fb', groupId: 'f4', currency: 'USD', netCents: 400, archived: true },
      { friendId: 'fc', groupId: 'f2', currency: 'EUR', netCents: 0, archived: false },
    ])
    const fb = totals.get('fb')!
    expect(fb.byCurrency).toEqual([
      { currency: 'USD', netCents: 800 },
      { currency: 'EUR', netCents: 300 },
    ])
    expect(fb.settleable.map((r) => r.groupId)).toEqual(['f1', 'f2', 'f3'])
    expect(fb.archived.map((r) => r.groupId)).toEqual(['f4'])
    expect(totals.has('fc')).toBe(false)
  })

  it('drops a currency that nets to zero', () => {
    const totals = friendTotals([
      { friendId: 'b', groupId: 'g1', currency: 'USD', netCents: 500, archived: false },
      { friendId: 'b', groupId: 'g2', currency: 'USD', netCents: -500, archived: false },
    ])
    expect(totals.get('b')!.byCurrency).toEqual([])
    expect(totals.get('b')!.settleable).toHaveLength(2)
  })
})
