import { describe, expect, it } from 'vitest'
import { uuidParam, validateNewExpenseSearch, validateSettleSearch } from './search-params'

const GROUP = '10000000-0000-4000-8000-000000000001'
const BEN = 'BBBBBBBB-0000-4000-8000-000000000002'

describe('search params', () => {
  it('keeps only real uuids', () => {
    expect(uuidParam(GROUP)).toBe(GROUP)
    expect(uuidParam(BEN)).toBe(BEN)
    expect(uuidParam('g-hike')).toBeUndefined()
    expect(uuidParam(42)).toBeUndefined()
  })

  it('reads the group and plan for a new expense', () => {
    expect(validateNewExpenseSearch({ groupId: GROUP, eventId: 'nope' })).toEqual({
      groupId: GROUP,
      eventId: undefined,
    })
  })

  it('keeps a home bill preset and drops anything else', () => {
    expect(validateNewExpenseSearch({ groupId: GROUP, preset: 'rent' })).toMatchObject({
      preset: 'rent',
    })
    expect(validateNewExpenseSearch({ preset: 'utilities' }).preset).toBe('utilities')
    expect(validateNewExpenseSearch({ preset: 'yacht' })).not.toHaveProperty('preset')
  })

  it('accepts a positive whole amount for settling, as a number or a string', () => {
    expect(validateSettleSearch({ groupId: GROUP, to: BEN, amount: '4750' })).toEqual({
      groupId: GROUP,
      to: BEN,
      amount: 4750,
    })
    expect(validateSettleSearch({ amount: 1200 }).amount).toBe(1200)
  })

  it('drops amounts that are not positive whole cents', () => {
    for (const amount of ['-5', '0', '12.5', 'lots', 2 ** 60, null]) {
      expect(validateSettleSearch({ amount }).amount).toBeUndefined()
    }
  })
})
