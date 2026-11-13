import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  computeBalances,
  crossRate,
  invertRate,
  spendingRate,
  ledgerLines,
  matchesExpenseFilters,
  matchesPaymentFilters,
  monthEnd,
  nextMonth,
  noFilters,
  previousMonth,
  spendingByCategory,
  spendingByGroup,
  spendingByMonth,
  spendingCurrencies,
  spendingSummary,
  spendingTotals,
  viewerShare,
  type LedgerExpense,
  type LedgerPayment,
  type SpendingRow,
} from '../index'

// The same flat as supabase/tests/25_search_insights.test.sql: three people in a USD group, a
// taco night Ava paid for, groceries Ben paid for, a hotel in EUR Cleo paid for at 1.1, and Ben
// paying Ava back 30.00 in April.
const g = 'group-flat'
const ava = 'a-ava'
const ben = 'b-ben'
const cleo = 'c-cleo'
const equal3 = (cents: number) => [
  { userId: ava, shareCents: cents },
  { userId: ben, shareCents: cents },
  { userId: cleo, shareCents: cents },
]

const taco: LedgerExpense = {
  id: 'e1',
  groupId: g,
  paidBy: ava,
  amountCents: 9000,
  spentAt: '2026-03-05',
  category: 'food',
  splits: equal3(3000),
}
const groceries: LedgerExpense = {
  id: 'e2',
  groupId: g,
  paidBy: ben,
  amountCents: 1200,
  spentAt: '2026-03-20',
  category: 'groceries',
  splits: equal3(400),
}
const hotel: LedgerExpense = {
  id: 'e3',
  groupId: g,
  paidBy: cleo,
  amountCents: 10000,
  currency: 'EUR',
  fxRate: '1.100000000000',
  spentAt: '2026-04-02',
  category: 'lodging',
  splits: [
    { userId: ava, shareCents: 5000 },
    { userId: cleo, shareCents: 5000 },
  ],
}
const payback: LedgerPayment = {
  groupId: g,
  fromUser: ben,
  toUser: ava,
  amountCents: 3000,
  day: '2026-04-10',
}
const flat = { groupId: g, groupCurrency: 'USD', expenses: [taco, groceries, hotel] }

const row = (r: Partial<SpendingRow>): SpendingRow => ({
  groupId: g,
  currency: 'USD',
  month: '2026-03-01',
  category: null,
  expenseCount: 0,
  spendCents: 0,
  paidCents: 0,
  shareCents: 0,
  paymentsMadeCents: 0,
  paymentsReceivedCents: 0,
  unconvertedCount: 0,
  ...r,
})

describe('spendingSummary', () => {
  it('matches spending_summary for the flat, row for row', () => {
    expect(spendingSummary({ ...flat, viewerId: ava, payments: [payback] })).toEqual([
      row({
        category: 'food',
        expenseCount: 1,
        spendCents: 9000,
        paidCents: 9000,
        shareCents: 3000,
      }),
      row({ category: 'groceries', expenseCount: 1, spendCents: 1200, shareCents: 400 }),
      row({
        month: '2026-04-01',
        category: 'lodging',
        expenseCount: 1,
        spendCents: 11000,
        shareCents: 5500,
      }),
      row({ month: '2026-04-01', paymentsReceivedCents: 3000 }),
    ])
  })

  it('gives each viewer their own numbers', () => {
    const totals = spendingTotals(spendingSummary({ ...flat, viewerId: ben, payments: [payback] }))
    expect(totals).toMatchObject({ paidCents: 1200, shareCents: 3400, paymentsMadeCents: 3000 })
  })

  it('keeps only the days in range', () => {
    const march = spendingSummary({
      ...flat,
      viewerId: ava,
      payments: [payback],
      from: '2026-03-01',
      to: '2026-03-31',
    })
    expect(spendingTotals(march).shareCents).toBe(3400)
    expect(march.every((r) => r.month === '2026-03-01')).toBe(true)
  })

  it('skips deleted expenses and payments, and payments the viewer is not in', () => {
    const rows = spendingSummary({
      ...flat,
      expenses: [taco, { ...groceries, deletedAt: '2026-03-21T00:00:00Z' }],
      viewerId: cleo,
      payments: [payback, { ...payback, fromUser: cleo, deletedAt: '2026-04-11T00:00:00Z' }],
    })
    expect(spendingTotals(rows)).toMatchObject({
      expenseCount: 1,
      spendCents: 9000,
      shareCents: 3000,
      paymentsMadeCents: 0,
      paymentsReceivedCents: 0,
    })
  })

  it('files an expense without a category under other', () => {
    const rows = spendingSummary({
      ...flat,
      expenses: [{ ...taco, category: null }],
      viewerId: ava,
    })
    expect(rows[0]!.category).toBe('other')
  })

  it('over all time, the net change is the balance computeBalances gives', () => {
    const balances = computeBalances(
      flat.expenses.map((e) => ({ ...e, fxRate: e.fxRate })),
      [payback],
      { groupCurrency: 'USD' },
    )
    for (const viewerId of [ava, ben, cleo]) {
      const net = spendingTotals(
        spendingSummary({ ...flat, viewerId, payments: [payback] }),
      ).netCents
      expect(net).toBe(balances[viewerId])
    }
  })

  it('net change equals the balance for any expenses and payments (property)', () => {
    const people = ['p1', 'p2', 'p3', 'p4']
    const person = fc.constantFrom(...people)
    const expense = fc.record({
      paidBy: person,
      amountCents: fc.integer({ min: 1, max: 1_000_000 }),
      splits: fc.uniqueArray(
        fc.record({ userId: person, shareCents: fc.integer({ min: 1, max: 1000 }) }),
        { selector: (s) => s.userId, minLength: 1 },
      ),
      fxRate: fc.constantFrom('1', '1.100000000000', '0.873421000000'),
      day: fc.integer({ min: 1, max: 28 }),
    })
    const payment = fc.record({
      fromUser: person,
      toUser: person,
      amountCents: fc.integer({ min: 1, max: 100_000 }),
    })
    fc.assert(
      fc.property(
        fc.array(expense, { maxLength: 8 }),
        fc.array(payment, { maxLength: 4 }),
        (es, ps) => {
          const expenses: LedgerExpense[] = es.map((e, i) => ({
            ...e,
            id: `x${i}`,
            groupId: g,
            spentAt: `2026-0${(i % 9) + 1}-${String(e.day).padStart(2, '0')}`,
          }))
          const payments: LedgerPayment[] = ps
            .filter((p) => p.fromUser !== p.toUser)
            .map((p) => ({ ...p, groupId: g, day: '2026-05-01' }))
          const balances = computeBalances(
            expenses,
            payments.map((p) => ({ ...p })),
          )
          for (const viewerId of people) {
            const rows = spendingSummary({
              viewerId,
              groupId: g,
              groupCurrency: 'USD',
              expenses,
              payments,
            })
            expect(spendingTotals(rows).netCents).toBe(balances[viewerId] ?? 0)
          }
        },
      ),
    )
  })
})

describe('spendingSummary in one currency', () => {
  // Same rates as the pgTAP case: USD to EUR 0.9 from March 1, 0.95 from April 1.
  const usdToEur = (day: string) => (day >= '2026-04-01' ? '0.950000000000' : '0.900000000000')
  const eur = (r: Partial<SpendingRow>) => row({ currency: 'EUR', ...r })

  it('converts each amount at its own date, matching spending_summary(..., in_currency)', () => {
    expect(
      spendingSummary({
        ...flat,
        viewerId: ava,
        payments: [payback],
        inCurrency: 'eur',
        rateOn: usdToEur,
      }),
    ).toEqual([
      eur({
        category: 'food',
        expenseCount: 1,
        spendCents: 8100,
        paidCents: 8100,
        shareCents: 2700,
      }),
      eur({ category: 'groceries', expenseCount: 1, spendCents: 1080, shareCents: 360 }),
      eur({
        month: '2026-04-01',
        category: 'lodging',
        expenseCount: 1,
        spendCents: 10450,
        shareCents: 5225,
      }),
      eur({ month: '2026-04-01', paymentsReceivedCents: 2850 }),
    ])
  })

  it('changes nothing in the group currency itself', () => {
    const rows = spendingSummary({ ...flat, viewerId: ava, inCurrency: 'USD', rateOn: () => null })
    expect(spendingTotals(rows)).toMatchObject({ spendCents: 21200, shareCents: 8900 })
  })

  it('leaves out and counts what has no rate', () => {
    const rows = spendingSummary({
      ...flat,
      viewerId: ava,
      payments: [payback],
      inCurrency: 'JPY',
    })
    expect(spendingTotals(rows)).toMatchObject({
      unconvertedCount: 4,
      spendCents: 0,
      // Only what was converted counts as an expense in the converted view.
      expenseCount: 0,
    })
    expect(rows.every((r) => r.currency === 'JPY')).toBe(true)
  })
})

describe('spendingRate', () => {
  // Same rates as the pgTAP case: EUR to USD 1.1 and GBP to USD 1.25, nothing between EUR and GBP.
  const rates: Record<string, string> = {
    'EUR>USD': '1.100000000000',
    'GBP>USD': '1.250000000000',
  }
  // Like private.fx_rate: the direct pair, else the inverse pair rounded to 12 places.
  const rateOf = (from: string, to: string): string | null => {
    const direct = rates[`${from}>${to}`]
    if (direct) return direct
    const inverse = rates[`${to}>${from}`]
    return inverse ? invertRate(inverse) : null
  }

  it('goes through a common base when two currencies have no rate between them', () => {
    expect(spendingRate('EUR', 'GBP', rateOf)).toBe('0.880000000000')
    expect(spendingRate('GBP', 'EUR', rateOf)).toBe('1.136363636364')
  })

  it('uses the direct rate, or the inverse, when there is one', () => {
    expect(spendingRate('EUR', 'USD', rateOf)).toBe('1.100000000000')
    expect(spendingRate('USD', 'GBP', rateOf)).toBe('0.800000000000')
    expect(spendingRate('USD', 'USD', rateOf)).toBe(1)
  })

  it('gives up when no base links them', () => {
    expect(spendingRate('JPY', 'GBP', rateOf)).toBeNull()
    expect(spendingRate('EUR', 'JPY', rateOf)).toBeNull()
  })

  it('multiplies rates exactly and rounds half away from zero at 12 places', () => {
    expect(crossRate('1.1', '0.8')).toBe('0.880000000000')
    expect(crossRate('0.000000500001', '0.000001')).toBe('0.000000000001')
    expect(crossRate('2', '0.0000000000005')).toBe('0.000000000002')
  })
})

describe('several payers and refunds', () => {
  // Same case as the pgTAP test: 90 paid 60 by Ava and 30 by Ben, split three ways, then a 40
  // refund Ava got, split between Ava and Ben.
  const dinner: LedgerExpense = {
    id: 'm1',
    groupId: g,
    paidBy: ava,
    payers: [
      { userId: ava, paidCents: 6000 },
      { userId: ben, paidCents: 3000 },
    ],
    amountCents: 9000,
    spentAt: '2026-05-02',
    category: 'food',
    splits: equal3(3000),
  }
  const refund: LedgerExpense = {
    id: 'm2',
    groupId: g,
    paidBy: ava,
    isRefund: true,
    amountCents: 4000,
    spentAt: '2026-05-09',
    category: 'tickets',
    splits: [
      { userId: ava, shareCents: 2000 },
      { userId: ben, shareCents: 2000 },
    ],
  }
  const market = { groupId: g, groupCurrency: 'USD', expenses: [dinner, refund] }

  it('credits each payer what they paid', () => {
    expect(ledgerLines(dinner).map((l) => [l.userId, l.paidCents, l.shareCents])).toEqual([
      [ava, 6000, 3000],
      [ben, 3000, 3000],
      [cleo, 0, 3000],
    ])
  })

  it('takes a refund off the spend, what was paid and the shares', () => {
    expect(spendingTotals(spendingSummary({ ...market, viewerId: ava }))).toMatchObject({
      spendCents: 5000,
      paidCents: 2000,
      shareCents: 1000,
    })
    expect(spendingTotals(spendingSummary({ ...market, viewerId: ben }))).toMatchObject({
      paidCents: 3000,
      shareCents: 1000,
    })
  })

  it('keeps paid minus share equal to the balance', () => {
    const balances = computeBalances(market.expenses, [], { groupCurrency: 'USD' })
    for (const viewerId of [ava, ben, cleo]) {
      expect(spendingTotals(spendingSummary({ ...market, viewerId })).netCents).toBe(
        balances[viewerId],
      )
    }
  })

  it('skips an expense nobody paid for', () => {
    expect(ledgerLines({ ...dinner, payers: [{ userId: ava, paidCents: 0 }] })).toEqual([])
  })

  it('filters by anyone who paid', () => {
    const e = {
      paidBy: ava,
      payers: [{ userId: ava }, { userId: cleo }],
      spentAt: '2026-05-02',
      splits: [{ userId: ben }],
    }
    expect(matchesExpenseFilters(e, { person: cleo })).toBe(true)
    expect(matchesExpenseFilters({ ...e, payers: undefined }, { person: cleo })).toBe(false)
  })
})

describe('ledgerLines', () => {
  it('splits the converted total by largest remainder, ties to the smaller id', () => {
    const lines = ledgerLines({ ...groceries, amountCents: 1000, splits: equal3(1) })
    expect(lines.map((l) => [l.userId, l.paidCents, l.shareCents])).toEqual([
      [ava, 0, 334],
      [ben, 1000, 333],
      [cleo, 0, 333],
    ])
  })

  it('credits a payer who is not in the split', () => {
    const lines = ledgerLines({ ...taco, paidBy: 'd-dan' })
    expect(lines.find((l) => l.userId === 'd-dan')).toMatchObject({
      paidCents: 9000,
      shareCents: 0,
    })
  })

  it('has no lines for a deleted expense or one without shares', () => {
    expect(ledgerLines({ ...taco, deletedAt: '2026-03-06T00:00:00Z' })).toEqual([])
    expect(ledgerLines({ ...taco, splits: [{ userId: ava, shareCents: 0 }] })).toEqual([])
  })

  it('converts into a group currency with other minor units', () => {
    const lines = ledgerLines({ ...hotel, fxRate: '160.5' }, 'JPY')
    expect(lines.map((l) => l.shareCents)).toEqual([8025, 8025])
  })
})

describe('viewerShare', () => {
  it('reads one person off the ledger', () => {
    expect(viewerShare(hotel, ava, 'USD')).toEqual({
      totalCents: 11000,
      paidCents: 0,
      shareCents: 5500,
    })
    expect(viewerShare(hotel, ben, 'USD')).toEqual({
      totalCents: 11000,
      paidCents: 0,
      shareCents: 0,
    })
    expect(viewerShare({ ...hotel, deletedAt: 'x' }, ava)).toEqual({
      totalCents: 0,
      paidCents: 0,
      shareCents: 0,
    })
  })
})

describe('rollups', () => {
  const rows = spendingSummary({ ...flat, viewerId: ava, payments: [payback] })

  it('totals by month, filling the gaps', () => {
    const gap = [...rows, row({ month: '2026-06-01', category: 'food', shareCents: 100 })]
    expect(spendingByMonth(gap).map((b) => [b.key, b.totals.shareCents])).toEqual([
      ['2026-03-01', 3400],
      ['2026-04-01', 5500],
      ['2026-05-01', 0],
      ['2026-06-01', 100],
    ])
    expect(spendingByMonth([])).toEqual([])
  })

  it('rolls subcategories up into their category, keeping other values as they are', () => {
    expect(
      spendingByCategory([
        row({ category: 'taxi', shareCents: 1200 }),
        row({ category: 'flights', shareCents: 3000 }),
        row({ category: 'transport', shareCents: 300 }),
        row({ category: 'coffee', shareCents: 450 }),
        row({ category: 'crypto', shareCents: 10 }),
      ]).map((b) => [b.key, b.totals.shareCents]),
    ).toEqual([
      ['transport', 4500],
      ['food', 450],
      ['crypto', 10],
    ])
  })

  it('totals by category, largest first, payments left out', () => {
    expect(spendingByCategory(rows).map((b) => [b.key, b.totals.shareCents])).toEqual([
      ['lodging', 5500],
      ['food', 3000],
      ['groceries', 400],
    ])
    expect(spendingByCategory(rows, 'spendCents').map((b) => b.key)).toEqual([
      'lodging',
      'food',
      'groceries',
    ])
    expect(
      spendingByCategory([
        row({ category: 'b', shareCents: 5 }),
        row({ category: 'a', shareCents: 5 }),
      ]).map((b) => b.key),
    ).toEqual(['a', 'b'])
  })

  it('totals by group and lists currencies by spend', () => {
    const other = [row({ groupId: 'g2', currency: 'EUR', category: 'food', spendCents: 50 })]
    expect(spendingByGroup([...rows, ...other]).map((b) => [b.key, b.totals.spendCents])).toEqual([
      [g, 21200],
      ['g2', 50],
    ])
    expect(
      spendingByGroup([row({ groupId: 'b' }), row({ groupId: 'a' })]).map((b) => b.key),
    ).toEqual(['a', 'b'])
    expect(spendingCurrencies([...rows, ...other])).toEqual(['USD', 'EUR'])
    expect(spendingCurrencies([row({ currency: 'JPY' }), row({ currency: 'EUR' })])).toEqual([
      'EUR',
      'JPY',
    ])
  })

  it('net is paid minus share plus payments made minus received', () => {
    expect(spendingTotals(rows)).toEqual({
      expenseCount: 3,
      spendCents: 21200,
      paidCents: 9000,
      shareCents: 8900,
      paymentsMadeCents: 0,
      paymentsReceivedCents: 3000,
      unconvertedCount: 0,
      netCents: -2900,
    })
  })
})

describe('months', () => {
  it('steps months across years', () => {
    expect(nextMonth('2026-12-01')).toBe('2027-01-01')
    expect(nextMonth('2026-03-01')).toBe('2026-04-01')
    expect(previousMonth('2026-01-01')).toBe('2025-12-01')
    expect(previousMonth('2026-11-01')).toBe('2026-10-01')
    expect(monthEnd('2028-02-01')).toBe('2028-02-29')
    expect(monthEnd('2026-04-15')).toBe('2026-04-30')
  })
})

describe('matchesExpenseFilters', () => {
  const e = { paidBy: ava, spentAt: '2026-03-05', category: 'food', splits: [{ userId: ben }] }

  it('matches person (paid or in the split), dates and categories', () => {
    expect(matchesExpenseFilters(e, {})).toBe(true)
    expect(matchesExpenseFilters(e, { person: ben, categories: ['food'] })).toBe(true)
    expect(matchesExpenseFilters(e, { person: ava })).toBe(true)
    expect(matchesExpenseFilters(e, { person: cleo })).toBe(false)
    expect(matchesExpenseFilters(e, { from: '2026-03-06' })).toBe(false)
    expect(matchesExpenseFilters(e, { to: '2026-03-04' })).toBe(false)
    expect(matchesExpenseFilters(e, { from: '2026-03-01', to: '2026-03-31' })).toBe(true)
    expect(matchesExpenseFilters(e, { categories: ['groceries'] })).toBe(false)
    expect(matchesExpenseFilters({ ...e, category: null }, { categories: ['other'] })).toBe(true)
  })

  it('takes subcategories under a top level category, but not the other way round', () => {
    const taxi = { ...e, category: 'taxi' }
    expect(matchesExpenseFilters(taxi, { categories: ['transport'] })).toBe(true)
    expect(matchesExpenseFilters(taxi, { categories: ['taxi'] })).toBe(true)
    expect(matchesExpenseFilters(taxi, { categories: ['food'] })).toBe(false)
    expect(matchesExpenseFilters(e, { categories: ['dining_out'] })).toBe(false)
    expect(matchesExpenseFilters({ ...e, category: 'dining_out' }, { categories: ['food'] })).toBe(
      true,
    )
  })

  it('matches a payment on either person and its day, and never under a category', () => {
    const p = { fromUser: ben, toUser: ava, day: '2026-03-05' }
    expect(matchesPaymentFilters(p, {})).toBe(true)
    expect(matchesPaymentFilters(p, { person: ben })).toBe(true)
    expect(matchesPaymentFilters(p, { person: ava })).toBe(true)
    expect(matchesPaymentFilters(p, { person: cleo })).toBe(false)
    expect(matchesPaymentFilters(p, { from: '2026-03-05', to: '2026-03-05' })).toBe(true)
    expect(matchesPaymentFilters(p, { from: '2026-03-06' })).toBe(false)
    expect(matchesPaymentFilters(p, { to: '2026-03-04' })).toBe(false)
    expect(matchesPaymentFilters(p, { categories: ['food'] })).toBe(false)
    expect(matchesPaymentFilters(p, { categories: [] })).toBe(true)
  })

  it('knows when nothing is filtered', () => {
    expect(noFilters({})).toBe(true)
    expect(noFilters({ categories: [] })).toBe(true)
    expect(noFilters({ person: ben })).toBe(false)
  })
})
