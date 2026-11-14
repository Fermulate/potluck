import { describe, expect, it } from 'vitest'
import { summarizeBalances } from './summary'

const b = (groupId: string, netCents: number, currency = 'USD') => ({
  groupId,
  groupName: groupId,
  groupEmoji: null,
  isDirect: false,
  currency,
  netCents,
})

describe('summarizeBalances', () => {
  it('splits owe and owed and nets them in the preferred currency', () => {
    const s = summarizeBalances(
      [b('a', -1200), b('b', 5000), b('c', -300), b('d', 900, 'EUR')],
      'USD',
    )
    expect(s.currency).toBe('USD')
    expect(s.owe).toBe(-1500)
    expect(s.owed).toBe(5000)
    expect(s.net).toBe(3500)
    expect(s.oweGroups.map((g) => g.groupId)).toEqual(['a', 'c'])
    expect(s.otherCurrencies).toEqual([{ currency: 'EUR', owed: 900, owe: 0 }])
    expect(s.groupCount).toBe(4)
  })

  it('falls back to the most common currency when the preferred one has no groups', () => {
    const s = summarizeBalances([b('a', 100, 'EUR'), b('b', -50, 'EUR'), b('c', 10, 'GBP')], 'USD')
    expect(s.currency).toBe('EUR')
    expect(s.net).toBe(50)
  })

  it('keeps what is owed and owing apart in each other currency', () => {
    const s = summarizeBalances(
      [b('a', 100), b('b', 700, 'GBP'), b('c', -200, 'GBP'), b('d', -50, 'EUR'), b('e', 0, 'JPY')],
      'USD',
    )
    expect(s.otherCurrencies).toEqual([
      { currency: 'EUR', owed: 0, owe: -50 },
      { currency: 'GBP', owed: 700, owe: -200 },
    ])
  })

  it('is all square with no balances', () => {
    expect(summarizeBalances([], 'CAD')).toMatchObject({ currency: 'CAD', net: 0, groupCount: 0 })
  })
})
