import { describe, expect, it } from 'vitest'
import { computeBalances } from '../balances'
import { TEST_LABELS } from './fixtures'
import {
  RATE_BAND,
  SKIP_PERSON,
  alreadyThere,
  isRate,
  peopleInScope,
  planImport,
  rateIsOutlier,
  nearestRate,
  rateOnDay,
  rowEffectIn,
} from './import-plan'
import { ledgerCsv } from './ledger'
import { readImportFile } from './read'
import { detectDateFormat, isoDay } from './source'

const HEADER = 'Date,Description,Category,Cost,Currency,Ava,Ben,Cleo'
const file = (...rows: string[]) => readImportFile([HEADER, ...rows].join('\n'), [TEST_LABELS])
const base = { mapping: ['a', 'b', 'c'], untitled: 'x', groupCurrency: 'USD' }

describe('dates as spreadsheets write them', () => {
  it('reads month first or day first, whichever every row fits', () => {
    expect(detectDateFormat(['2026-03-01', '2026-03-02 10:00'])).toEqual({
      format: 'iso',
      ambiguous: false,
    })
    expect(detectDateFormat(['3/1/26', '12/31/2026'])).toEqual({ format: 'mdy', ambiguous: false })
    expect(detectDateFormat(['01/03/2026', '31.12.2026'])).toEqual({
      format: 'dmy',
      ambiguous: false,
    })
    expect(detectDateFormat(['3/1/26', '4/2/26'])).toEqual({ format: 'mdy', ambiguous: true })
    expect(isoDay('3/1/26', 'mdy')).toBe('2026-03-01')
    expect(isoDay('3/1/26', 'dmy')).toBe('2026-01-03')
    expect(isoDay('31/02/2026', 'dmy')).toBeNull()
    expect(isoDay('3/1/26')).toBeNull()
    expect(isoDay('noon', 'mdy')).toBeNull()
  })

  it('says how a Splitwise file was read, and can be told otherwise', () => {
    const rows = ['4/3/2026,Lunch,General,10.00,USD,5.00,-5.00,0.00']
    const guessed = file(...rows)
    expect(guessed.dateFormat).toBe('mdy')
    expect(guessed.dateAmbiguous).toBe(true)
    expect(guessed.entries[0]!.date).toBe('2026-04-03')
    const told = readImportFile([HEADER, ...rows].join('\n'), [TEST_LABELS], { dateFormat: 'dmy' })
    expect(told.entries[0]!.date).toBe('2026-03-04')
    expect(told.dateAmbiguous).toBe(false)
    expect(file('25/3/2026,Lunch,General,10.00,USD,5.00,-5.00,0.00').dateFormat).toBe('dmy')
  })
})

describe('Splitwise refunds', () => {
  it('turn a negative cost into a refund to whoever came out behind', () => {
    // 30 came back to Ava, split three ways: Ava -20, Ben +10, Cleo +10.
    const plan = planImport(file('2026-03-01,Returned,General,-30.00,USD,-20.00,10.00,10.00'), base)
    expect(plan.counts).toEqual({ expenses: 0, refunds: 1, payments: 0 })
    expect(plan.rows[0]).toMatchObject({
      is_refund: true,
      amount_cents: 3000,
      payers: [{ user_id: 'a', paid_cents: 3000 }],
      splits: [
        { user_id: 'a', share_cents: 1000 },
        { user_id: 'b', share_cents: 1000 },
        { user_id: 'c', share_cents: 1000 },
      ],
    })
    expect(plan.balances).toEqual({ a: -2000, b: 1000, c: 1000 })
  })
})

describe('rates', () => {
  const eur = (date: string) => `${date},Museum,General,10.00,EUR,10.00,-5.00,-5.00`

  it('converts every row the way the server will, rates included in each row', () => {
    const plan = planImport(
      file(eur('2026-03-01'), '2026-03-02,Taxi,Taxi,9.00,USD,6.00,-3.00,-3.00'),
      {
        ...base,
        rateOn: () => '1.1',
      },
    )
    expect(plan.rows[0]).toMatchObject({ fx_rate: '1.1' })
    expect(plan.rows[1]).not.toHaveProperty('fx_rate')
    // Ava paid 10 EUR (11 USD) for Ben and Cleo; then the taxi.
    expect(plan.balances).toEqual({ a: 1100 + 600, b: -550 - 300, c: -550 - 300 })
    expect(plan.ratesPending).toBe(false)
  })

  it('waits for stored rates, then asks for one when Potluck has none', () => {
    expect(
      planImport(file(eur('2026-03-01')), { ...base, rateOn: () => undefined }).ratesPending,
    ).toBe(true)
    const missing = planImport(file(eur('2024-01-05'), eur('2024-02-01')), {
      ...base,
      rateOn: () => null,
    })
    expect(missing.missingRates).toEqual([
      {
        currency: 'EUR',
        from: '2024-01-05',
        to: '2024-02-01',
        days: ['2024-01-05', '2024-02-01'],
        rows: 2,
        typed: null,
        skipped: false,
      },
    ])
    expect(missing.balances).toEqual({})
  })

  it('takes a typed rate, or leaves those rows out', () => {
    const typed = planImport(file(eur('2024-01-05')), {
      ...base,
      rateOn: () => null,
      typedRates: { EUR: ' 1.2 ' },
    })
    expect(typed.rows[0]).toMatchObject({ fx_rate: '1.2' })
    expect(typed.rows[0]).not.toHaveProperty('fx_rate_confirmed')
    // The currency stays listed, now with its rate, so the screen does not jump while typing.
    expect(typed.missingRates).toEqual([
      {
        currency: 'EUR',
        from: '2024-01-05',
        to: '2024-01-05',
        days: ['2024-01-05'],
        rows: 1,
        typed: '1.2',
        skipped: false,
      },
    ])
    const skipped = planImport(file(eur('2024-01-05')), {
      ...base,
      rateOn: () => null,
      typedRates: { EUR: 'abc' },
      skipCurrencies: new Set(['EUR']),
    })
    expect(skipped.rows).toEqual([])
    expect(skipped.skipped).toEqual([{ line: 2, reason: 'rate' }])
    expect(skipped.missingRates[0]).toMatchObject({ typed: null, skipped: true })
  })

  it('keeps every digit of a typed rate, and marks a confirmed far one', () => {
    const plan = planImport(file(eur('2024-01-05')), {
      ...base,
      rateOn: () => null,
      typedRates: { EUR: '0.0091' },
      confirmedRates: new Set(['EUR']),
    })
    expect(plan.rows[0]).toMatchObject({ fx_rate: '0.0091', fx_rate_confirmed: true })
    // Ava paid 10 EUR for Ben and Cleo: 9.1 US cents at 0.0091, spread 5 and 4 (largest remainder).
    expect(plan.balances).toEqual({ a: 9, b: -5, c: -4 })
  })

  it('calls a typed rate far off outside a fifth to five times the stored one', () => {
    expect(rateIsOutlier('1.1', '1.08')).toBe(false)
    expect(rateIsOutlier('5.4', '1.08')).toBe(false)
    expect(rateIsOutlier('5.41', '1.08')).toBe(true)
    expect(rateIsOutlier('0.2', '1.08')).toBe(true)
    expect(rateIsOutlier('999999999999', '1.08')).toBe(true)
    expect(rateIsOutlier('1.1', null)).toBe(true)
    expect(RATE_BAND).toEqual({ low: 0.2, high: 5 })
  })

  it('keeps the rate a Potluck file was written with, and counts where it differs', () => {
    const trip = {
      name: 'Trip',
      currency: 'USD',
      expenses: [
        {
          description: 'Museum',
          category: null,
          notes: null,
          spentAt: '2026-03-01',
          createdAt: '2026-03-01T10:00:00Z',
          amountCents: 1000,
          currency: 'EUR',
          fxRate: '1.080000000000',
          isRefund: false,
          payers: [{ userId: 'a', paidCents: 1000 }],
          splits: [
            { userId: 'a', shareCents: 500 },
            { userId: 'b', shareCents: 500 },
          ],
        },
      ],
      payments: [],
    }
    const csv = ledgerCsv([trip], {
      labels: TEST_LABELS,
      people: [
        { id: 'a', name: 'Ava' },
        { id: 'b', name: 'Ben' },
      ],
      paymentText: () => '',
    })
    const read = readImportFile(csv, [TEST_LABELS])
    expect(read.entries[0]).toMatchObject({ rate: '1.08', groupCurrency: 'USD' })
    const plan = planImport(read, {
      mapping: ['a', 'b'],
      untitled: 'x',
      groupCurrency: 'USD',
      rateOn: () => '1.2',
    })
    expect(plan.rows[0]).toMatchObject({ fx_rate: '1.08' })
    expect(plan.rows[0]).not.toHaveProperty('fx_rate_confirmed')
    expect(plan.fileRates).toEqual({
      rows: 1,
      differ: 1,
      rates: [{ currency: 'EUR', day: '2026-03-01', rate: '1.08' }],
    })
    // Once the person says the file's EUR rates are right, the server is told so.
    const confirmed = planImport(read, {
      mapping: ['a', 'b'],
      untitled: 'x',
      groupCurrency: 'USD',
      rateOn: () => '1.2',
      confirmedFileRates: new Set(['EUR']),
    })
    expect(confirmed.rows[0]).toMatchObject({ fx_rate: '1.08', fx_rate_confirmed: true })
    expect(plan.balances).toEqual(
      computeBalances(
        [
          {
            paidBy: 'a',
            payers: trip.expenses[0]!.payers,
            amountCents: 1000,
            currency: 'EUR',
            fxRate: '1.08',
            splits: trip.expenses[0]!.splits,
          },
        ],
        [],
        { groupCurrency: 'USD' },
      ),
    )
    // Into a group in another currency, the file's rate does not apply.
    const other = planImport(read, { mapping: ['a', 'b'], untitled: 'x', groupCurrency: 'EUR' })
    expect(other.rows[0]).not.toHaveProperty('fx_rate')
    expect(other.fileRates).toEqual({ rows: 0, differ: 0, rates: [] })
  })

  it('find the rate on a day like the server: latest on or before, else the inverse', () => {
    const history = {
      direct: [
        { day: '2026-03-01', rate: '1.1' },
        { day: '2026-03-05', rate: '1.2' },
      ],
      inverse: [{ day: '2026-01-01', rate: '0.8' }],
    }
    expect(rateOnDay(history, '2026-03-04')).toBe('1.1')
    expect(rateOnDay(history, '2026-03-09')).toBe('1.2')
    expect(rateOnDay(history, '2026-02-01')).toBe('1.250000000000')
    expect(rateOnDay(history, '2025-12-31')).toBeNull()
  })

  it('holds a typed rate against the nearest stored one either side, like the server', () => {
    const history = {
      direct: [
        { day: '2026-03-01', rate: '1.1' },
        { day: '2026-03-05', rate: '1.2' },
      ],
      inverse: [
        { day: '2026-01-01', rate: '0.8' },
        { day: '2026-03-03', rate: '0.5' },
      ],
    }
    // Before every stored day the server still compares with the first one after it.
    expect(nearestRate(history, '2025-12-01')).toBe('1.250000000000')
    expect(nearestRate(history, '2026-03-04')).toBe('1.2')
    // A day off either side: the later day wins.
    expect(nearestRate(history, '2026-03-02')).toBe('2.000000000000')
    expect(nearestRate(history, '2026-03-31')).toBe('1.2')
    // The direct rate before the inverse one on the same day.
    expect(
      nearestRate(
        { direct: [{ day: '2026-03-03', rate: '3' }], inverse: history.inverse },
        '2026-03-03',
      ),
    ).toBe('3')
    expect(nearestRate({ direct: [], inverse: [] }, '2026-03-03')).toBeNull()
  })

  it('checks a typed rate', () => {
    expect(isRate('1.25')).toBe(true)
    expect(isRate('0')).toBe(false)
    expect(isRate('-1')).toBe(false)
    expect(isRate('1,25')).toBe(false)
    expect(isRate(null)).toBe(false)
  })

  it('converts payments too', () => {
    expect(
      rowEffectIn(
        {
          kind: 'payment',
          from_user: 'b',
          to_user: 'a',
          amount_cents: 1000,
          currency: 'EUR',
          paid_on: '2026-03-01',
          note: null,
        },
        'USD',
        '1.1',
      ),
    ).toEqual({ b: 1100, a: -1100 })
  })
})

describe('leaving rows out', () => {
  const rows = [
    '2026-03-01,Dinner,Dining out,90.00,USD,60.00,-30.00,-30.00',
    '2026-03-02,Lunch,Dining out,20.00,USD,10.00,-10.00,0.00',
  ]

  it('skips everything someone left has money in', () => {
    const plan = planImport(file(...rows), { ...base, mapping: ['a', 'b', SKIP_PERSON] })
    expect(plan.issues).toEqual([])
    expect(plan.rows).toHaveLength(1)
    expect(plan.skipped).toEqual([{ line: 2, reason: 'person' }])
  })

  it('spots rows already in the group, once each, and leaves them out on request', () => {
    const plan = planImport(file(...rows, rows[1]!), base)
    const lines = alreadyThere(plan, [
      {
        kind: 'expense',
        day: '2026-03-02',
        amountCents: 2000,
        currency: 'USD',
        description: ' lunch ',
      },
      {
        kind: 'payment',
        day: '2026-03-02',
        amountCents: 2000,
        currency: 'USD',
        fromUser: 'b',
        toUser: 'a',
      },
    ])
    expect(lines).toEqual([3])
    const without = planImport(file(...rows, rows[1]!), { ...base, skipLines: new Set(lines) })
    expect(without.rows).toHaveLength(2)
    expect(without.skipped).toEqual([{ line: 3, reason: 'duplicate' }])
    const payments = planImport(
      file('2026-03-02,Ben paid Ava,Payment,20.00,USD,-20.00,20.00,0.00'),
      base,
    )
    expect(
      alreadyThere(payments, [
        {
          kind: 'payment',
          day: '2026-03-02',
          amountCents: 2000,
          currency: 'USD',
          fromUser: 'b',
          toUser: 'a',
        },
      ]),
    ).toEqual([2])
  })

  it('only asks about the people in the rows being imported', () => {
    expect(peopleInScope(file(rows[1]!))).toEqual([0, 1])
  })
})
