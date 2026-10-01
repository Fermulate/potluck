import { describe, expect, it } from 'vitest'
import { hasMessage, t } from './index'

describe('hasMessage', () => {
  it('recognizes plain and plural keys built at runtime', () => {
    expect(hasMessage('app.name')).toBe(true)
    expect(hasMessage('groups.memberCount')).toBe(true)
    expect(hasMessage('groups.memberCount_one')).toBe(false)
    expect(hasMessage('app')).toBe(false)
    expect(hasMessage('made.up')).toBe(false)
  })
})

describe('t', () => {
  it('looks up a message by dotted key', () => {
    expect(t('app.name')).toBe('Potluck')
  })

  it('interpolates named params', () => {
    expect(t('home.greeting.evening', { name: 'Sam' })).toBe('Evening, Sam.')
  })

  it('picks the plural form from count', () => {
    expect(t('groups.memberCount', { count: 1 })).toBe('1 member')
    expect(t('groups.memberCount', { count: 4 })).toBe('4 members')
  })

  it('uses the zero form when there is one', () => {
    expect(t('expenses.count', { count: 0 })).toBe('No expenses yet')
    expect(t('expenses.count', { count: 1 })).toBe('1 expense')
    expect(t('expenses.count', { count: 2 })).toBe('2 expenses')
  })

  it('falls back to other for zero when there is no zero form', () => {
    expect(t('groups.memberCount', { count: 0 })).toBe('0 members')
  })

  it('formats numbers with grouping', () => {
    expect(t('groups.memberCount', { count: 1200 })).toBe('1,200 members')
  })

  it('keeps every fraction digit of interpolated numbers', () => {
    expect(t('expenses.foreignCurrency', { rate: 0.00684, currency: 'USD' })).toBe(
      'Converted at 0.00684 to USD',
    )
  })

  it('checks keys and params at compile time', () => {
    // @ts-expect-error unknown key
    expect(t('nope.never')).toBe('nope.never')
    // @ts-expect-error missing params
    t('home.greeting.evening')
    // @ts-expect-error plural keys need a count
    t('groups.memberCount', {})
    // @ts-expect-error plural forms are not keys of their own
    t('groups.memberCount_one', { count: 1 })
  })

  it('leaves a placeholder alone when its param is missing at runtime', () => {
    const loose = t as (key: string, params?: Record<string, unknown>) => string
    expect(loose('home.greeting.evening', {})).toBe('Evening, {name}.')
  })
})
