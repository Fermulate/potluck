import { t } from '@potluck/i18n'
import { describe, expect, it } from 'vitest'
import {
  activeFilters,
  countFilters,
  dateLabel,
  matchingPreset,
  presetRange,
  withoutFilter,
  type MoneyFilters,
} from './filter-state'
import { chartMonths, rowsInPeriod } from './period'
import {
  filtersFromSearch,
  searchFromFilters,
  validateActivitySearch,
  validateGroupListSearch,
  validateMoneySearch,
} from './search-params'

const today = '2026-03-15'

describe('date presets', () => {
  it('turn into inclusive ranges from today', () => {
    expect(presetRange('thisMonth', today)).toEqual({ from: '2026-03-01', to: '2026-03-31' })
    expect(presetRange('lastMonth', today)).toEqual({ from: '2026-02-01', to: '2026-02-28' })
    expect(presetRange('lastMonth', '2026-01-09')).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    expect(presetRange('thisYear', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })

  it('are recognized back from a range', () => {
    expect(matchingPreset({ from: '2026-02-01', to: '2026-02-28' }, today)).toBe('lastMonth')
    expect(matchingPreset({ from: '2026-02-02', to: '2026-02-28' }, today)).toBeNull()
  })

  it('label the range', () => {
    expect(dateLabel({}, today)).toBeNull()
    expect(dateLabel(presetRange('thisYear', today), today)).toBe(t('filters.thisYear'))
    expect(dateLabel({ from: '2026-03-02', to: '2026-03-09' }, today)).toBe(
      t('filters.range', { from: 'Mar 2, 2026', to: 'Mar 9, 2026' }),
    )
    expect(dateLabel({ from: '2026-03-02' }, today)).toBe(
      t('filters.since', { from: 'Mar 2, 2026' }),
    )
    expect(dateLabel({ to: '2026-03-09' }, today)).toBe(t('filters.until', { to: 'Mar 9, 2026' }))
  })
})

describe('active filters', () => {
  const filters: MoneyFilters = {
    ...presetRange('thisMonth', today),
    person: 'u-ben',
    categories: ['food', 'drinks'],
    groupId: 'g1',
    kind: 'expense',
  }
  const chips = activeFilters(filters, {
    today,
    personName: () => 'Ben',
    groupName: () => 'Hike crew',
  })

  it('make one chip per filter, in sheet order', () => {
    expect(chips.map((c) => c.label)).toEqual([
      t('filters.thisMonth'),
      'Ben',
      t('categories.food'),
      t('categories.drinks'),
      'Hike crew',
      t('filters.expenses'),
    ])
    expect(countFilters(filters)).toBe(6)
    expect(countFilters({})).toBe(0)
    expect(
      activeFilters({ kind: 'payment' }, { today, personName: () => '' }).map((c) => c.label),
    ).toEqual([t('filters.payments')])
  })

  it('remove just the one a chip stands for', () => {
    const [dates, person, food, , group, kind] = chips
    expect(withoutFilter(filters, dates!)).toMatchObject({ from: null, to: null })
    expect(withoutFilter(filters, person!).person).toBeNull()
    expect(withoutFilter(filters, food!).categories).toEqual(['drinks'])
    expect(withoutFilter(filters, group!).groupId).toBeNull()
    expect(withoutFilter(filters, kind!).kind).toBeNull()
  })
})

describe('search params', () => {
  const uuid = '10000000-0000-4000-8000-000000000001'

  it('keep what is well formed and drop the rest', () => {
    expect(
      validateMoneySearch({
        q: ' tacos ',
        groupId: uuid,
        person: 'nope',
        from: '2026-03-01',
        to: '03/31/2026',
        cats: 'food,DROP TABLE,drinks',
        kind: 'payment',
      }),
    ).toEqual({
      q: ' tacos ',
      groupId: uuid,
      from: '2026-03-01',
      cats: 'food,drinks',
      kind: 'payment',
    })
    expect(validateMoneySearch({ q: '   ', kind: 'other', cats: '!!' })).toEqual({})
    expect(validateMoneySearch({ to: '2026-03-31', person: uuid })).toEqual({
      to: '2026-03-31',
      person: uuid,
    })
    expect(validateActivitySearch({ groupId: uuid, person: uuid })).toEqual({
      groupId: uuid,
      person: uuid,
    })
    expect(validateActivitySearch({ groupId: 1 })).toEqual({})
    // The Expenses tab keeps the type too, but no query or group.
    expect(validateGroupListSearch({ kind: 'payment', q: 'tacos', groupId: uuid })).toEqual({
      kind: 'payment',
    })
    expect(validateGroupListSearch({ kind: 'refund' })).toEqual({})
    expect(filtersFromSearch({ kind: 'expense', cats: 'food' })).toMatchObject({
      kind: 'expense',
      categories: ['food'],
    })
    expect(searchFromFilters({ kind: 'payment', categories: [], person: null })).toEqual({
      kind: 'payment',
      person: undefined,
      from: undefined,
      to: undefined,
      cats: undefined,
    })
  })
})

describe('periods', () => {
  const rows = [{ month: '2025-11-01' }, { month: '2026-02-01' }, { month: '2026-03-01' }]

  it('pick the rows in a month, a year or all time', () => {
    expect(rowsInPeriod(rows, { kind: 'month', month: '2026-02-01' })).toEqual([rows[1]])
    expect(rowsInPeriod(rows, { kind: 'year', month: '2026-07-01' })).toEqual([rows[1], rows[2]])
    expect(rowsInPeriod(rows, { kind: 'all', month: '2026-03-01' })).toHaveLength(3)
  })

  it('chart the twelve months to the one picked, the year, or everything', () => {
    expect(chartMonths(rows, { kind: 'month', month: '2026-03-01' }, '2026-03-01')).toEqual({
      from: '2025-04-01',
      to: '2026-03-01',
    })
    expect(chartMonths(rows, { kind: 'year', month: '2025-05-01' }, '2026-03-01')).toEqual({
      from: '2025-01-01',
      to: '2025-12-01',
    })
    expect(chartMonths(rows, { kind: 'all', month: '2026-03-01' }, '2026-04-01')).toEqual({
      from: '2025-11-01',
      to: '2026-04-01',
    })
  })
})
