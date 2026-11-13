import { describe, expect, it } from 'vitest'
import { checkPayers, primaryPayer } from '../index'

// The same cases run against `private.save_expense` in supabase/tests/19_expense_entry.test.sql.
describe('checkPayers', () => {
  it('accepts payers that add up to the total', () => {
    expect(
      checkPayers(9000, [
        { userId: 'ben', paidCents: 3000 },
        { userId: 'ava', paidCents: 6000 },
      ]),
    ).toEqual({ ok: true, payers: { ava: 6000, ben: 3000 } })
  })

  it('drops people who paid nothing', () => {
    expect(
      checkPayers(500, [
        { userId: 'a', paidCents: 500 },
        { userId: 'b', paidCents: 0 },
      ]),
    ).toEqual({ ok: true, payers: { a: 500 } })
  })

  it('says how far off a total that does not add up is', () => {
    expect(
      checkPayers(9000, [
        { userId: 'a', paidCents: 6000 },
        { userId: 'b', paidCents: 2000 },
      ]),
    ).toEqual({
      ok: false,
      error: { code: 'payers_sum_mismatch', expected: 9000, actual: 8000, difference: 1000 },
    })
  })

  it('refuses nobody, negative or fractional amounts, and the same person twice', () => {
    expect(checkPayers(100, [])).toEqual({ ok: false, error: { code: 'no_payers' } })
    expect(checkPayers(100, [{ userId: 'a', paidCents: 0 }])).toEqual({
      ok: false,
      error: { code: 'no_payers' },
    })
    expect(checkPayers(100, [{ userId: 'a', paidCents: -1 }])).toEqual({
      ok: false,
      error: { code: 'invalid_paid_amount', userId: 'a' },
    })
    expect(checkPayers(100, [{ userId: 'a', paidCents: 0.5 }])).toEqual({
      ok: false,
      error: { code: 'invalid_paid_amount', userId: 'a' },
    })
    expect(
      checkPayers(100, [
        { userId: 'a', paidCents: 50 },
        { userId: 'a', paidCents: 50 },
      ]),
    ).toEqual({ ok: false, error: { code: 'duplicate_payer', userId: 'a' } })
  })
})

describe('primaryPayer', () => {
  it('is whoever paid the most, ties to the smaller id', () => {
    expect(primaryPayer({ ava: 6000, ben: 3000 })).toBe('ava')
    expect(primaryPayer({ b: 100, a: 100 })).toBe('a')
    expect(primaryPayer({})).toBeUndefined()
  })
})
