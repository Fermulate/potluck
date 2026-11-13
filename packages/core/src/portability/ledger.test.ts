import { describe, expect, it } from 'vitest'
import { computeBalances, pairwiseDebts, type BalanceExpense } from '../balances'
import { parseCsv } from './csv'
import { TEST_LABELS, TEST_LABELS_ES } from './fixtures'
import { planImport, type ImportRow } from './import-plan'
import {
  ledgerCsv,
  ledgerPeople,
  parseLedger,
  type LedgerGroup,
  type LedgerOptions,
} from './ledger'
import { readImportFile } from './read'

const names: Record<string, string> = { a: 'Ava', b: 'Ben', c: 'Cleo', d: 'Dan' }
const people = ['a', 'b', 'c'].map((id) => ({ id, name: names[id]! }))
const options: LedgerOptions = {
  labels: TEST_LABELS,
  people,
  paymentText: (from, to) => `${names[from]} paid ${names[to]}`,
}

// A trip in USD: several payers, a refund, a by-item bill, an expense in EUR and two payments.
const trip: LedgerGroup = {
  name: 'Trip',
  currency: 'USD',
  expenses: [
    {
      description: 'Dinner',
      category: 'food',
      notes: 'Birthday',
      spentAt: '2026-03-01',
      createdAt: '2026-03-01T20:00:00Z',
      amountCents: 9000,
      currency: 'USD',
      fxRate: '1.000000000000',
      isRefund: false,
      payers: [
        { userId: 'a', paidCents: 6000 },
        { userId: 'b', paidCents: 3000 },
      ],
      splits: [
        { userId: 'a', shareCents: 3000 },
        { userId: 'b', shareCents: 3000 },
        { userId: 'c', shareCents: 3000 },
      ],
    },
    {
      description: 'Returned tickets',
      category: null,
      notes: null,
      spentAt: '2026-03-02',
      createdAt: '2026-03-02T10:00:00Z',
      amountCents: 3000,
      currency: 'USD',
      fxRate: '1',
      isRefund: true,
      payers: [{ userId: 'c', paidCents: 3000 }],
      splits: [
        { userId: 'a', shareCents: 1500 },
        { userId: 'c', shareCents: 1500 },
      ],
    },
    {
      description: '=Pizza night',
      category: 'food',
      notes: null,
      spentAt: '2026-03-03',
      createdAt: '2026-03-03T10:00:00Z',
      amountCents: 2700,
      currency: 'USD',
      fxRate: '1',
      isRefund: false,
      payers: [{ userId: 'b', paidCents: 2700 }],
      splits: [
        { userId: 'a', shareCents: 1350 },
        { userId: 'b', shareCents: 1350 },
      ],
      items: [{ description: 'Pizza', amountCents: 2400, userIds: ['a', 'b'] }],
      taxCents: 200,
      tipCents: 300,
      discountCents: 200,
    },
    {
      description: 'Museum',
      category: 'tickets',
      notes: null,
      spentAt: '2026-03-04',
      createdAt: '2026-03-04T10:00:00Z',
      amountCents: 1000,
      currency: 'EUR',
      fxRate: '1.100000000000',
      isRefund: false,
      payers: [{ userId: 'a', paidCents: 1000 }],
      splits: [
        { userId: 'a', shareCents: 334 },
        { userId: 'b', shareCents: 333 },
        { userId: 'c', shareCents: 333 },
      ],
    },
  ],
  payments: [
    {
      fromUser: 'c',
      toUser: 'a',
      amountCents: 1000,
      currency: 'USD',
      fxRate: '1',
      note: 'Cash',
      day: '2026-03-05',
      settledAt: '2026-03-05T12:00:00Z',
    },
    {
      fromUser: 'b',
      toUser: 'a',
      amountCents: 500,
      currency: 'EUR',
      fxRate: '1.1',
      note: null,
      day: '2026-03-06',
      settledAt: '2026-03-06T12:00:00Z',
    },
  ],
}

const toBalance = (e: LedgerGroup['expenses'][number]): BalanceExpense => ({
  paidBy: e.payers[0]!.userId,
  payers: e.payers,
  isRefund: e.isRefund,
  amountCents: e.amountCents,
  currency: e.currency,
  fxRate: e.fxRate,
  splits: e.splits,
})
const balancesOf = (group: LedgerGroup) =>
  computeBalances(
    group.expenses.map(toBalance),
    group.payments.map((p) => ({ ...p })),
    { groupCurrency: group.currency },
  )

/** What the server makes of import rows: the same rates the original rows had on those days. */
function balancesAfterImport(rows: ImportRow[], group: LedgerGroup) {
  const rateOn = (currency: string, day: string) =>
    [
      ...group.expenses.map((e) => [e.currency, e.spentAt, e.fxRate] as const),
      ...group.payments.map((p) => [p.currency, p.day, p.fxRate] as const),
    ].find(([c, d]) => c === currency && d === day)?.[2] ?? '1'
  return computeBalances(
    rows.flatMap((r) =>
      r.kind === 'expense'
        ? [
            {
              paidBy: r.payers[0]!.user_id,
              payers: r.payers.map((p) => ({ userId: p.user_id, paidCents: p.paid_cents })),
              isRefund: r.is_refund,
              amountCents: r.amount_cents,
              currency: r.currency,
              fxRate: rateOn(r.currency, r.spent_at),
              splits: r.splits.map((s) => ({ userId: s.user_id, shareCents: s.share_cents })),
            },
          ]
        : [],
    ),
    rows.flatMap((r) =>
      r.kind === 'payment'
        ? [
            {
              fromUser: r.from_user,
              toUser: r.to_user,
              amountCents: r.amount_cents,
              currency: r.currency,
              fxRate: rateOn(r.currency, r.paid_on),
            },
          ]
        : [],
    ),
    { groupCurrency: group.currency },
  )
}

describe('ledgerCsv', () => {
  const csv = ledgerCsv([trip], options)
  const rows = parseCsv(csv)

  it('has fixed columns, three per person, then notes and items', () => {
    expect(rows[0]).toEqual([
      'Date',
      'Group',
      'Type',
      'Description',
      'Category',
      'Amount',
      'Currency',
      'Rate',
      'Group currency',
      'Amount in group currency',
      'Paid by',
      'Ava paid',
      'Ava share',
      'Ava balance',
      'Ben paid',
      'Ben share',
      'Ben balance',
      'Cleo paid',
      'Cleo share',
      'Cleo balance',
      'Notes',
      'Items',
    ])
  })

  it('lists several payers, negative refunds, items and payments as a spreadsheet reads them', () => {
    expect(rows[1]).toEqual([
      '2026-03-01',
      'Trip',
      'Expense',
      'Dinner',
      'Food',
      '90.00',
      'USD',
      '1',
      'USD',
      '90.00',
      'Ava 60.00; Ben 30.00',
      '60.00',
      '30.00',
      '30.00',
      '30.00',
      '30.00',
      '0.00',
      '',
      '30.00',
      '-30.00',
      'Birthday',
      '',
    ])
    expect(rows[2]!.slice(2, 11)).toEqual([
      'Refund',
      'Returned tickets',
      '',
      '-30.00',
      'USD',
      '1',
      'USD',
      '-30.00',
      'Cleo',
    ])
    expect(rows[2]!.slice(11, 20)).toEqual([
      '',
      '-15.00',
      '15.00',
      '',
      '',
      '',
      '-30.00',
      '-15.00',
      '-15.00',
    ])
    expect(rows[3]![3]).toBe("'=Pizza night")
    expect(rows[3]!.at(-1)).toBe('Pizza 24.00 (Ava, Ben); Tax 2.00; Tip 3.00; Discount -2.00')
    expect(rows[4]!.slice(5, 10)).toEqual(['10.00', 'EUR', '1.1', 'USD', '11.00'])
    expect(rows[5]!.slice(2, 11)).toEqual([
      'Payment',
      'Cleo paid Ava',
      '',
      '10.00',
      'USD',
      '1',
      'USD',
      '10.00',
      'Cleo',
    ])
    expect(rows[5]!.slice(11, 20)).toEqual([
      '',
      '10.00',
      '-10.00',
      '',
      '',
      '',
      '10.00',
      '',
      '10.00',
    ])
  })

  it('ends with a balance row that matches the balances to the cent', () => {
    const balance = rows.at(-1)!
    expect(balance.slice(0, 3)).toEqual(['', 'Trip', 'Balance'])
    const expected = balancesOf(trip)
    const shown = people.map((_, i) => balance[13 + i * 3])
    expect(shown).toEqual(
      people.map((p) => {
        const cents = expected[p.id]!
        return `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, '0')}`
      }),
    )
    // And every balance column adds up to it.
    for (let i = 0; i < people.length; i++) {
      const col = 13 + i * 3
      const sum = rows
        .slice(1, -1)
        .reduce((acc, row) => acc + Math.round(Number(row[col] || 0) * 100), 0)
      expect(sum).toBe(expected[people[i]!.id])
    }
  })

  it('reimporting it into an empty group reproduces the balances', () => {
    const file = readImportFile(csv, [TEST_LABELS])
    expect(file.format).toBe('potluck')
    expect(file.issues).toEqual([])
    expect(file.people).toEqual(['Ava', 'Ben', 'Cleo'])
    const plan = planImport(file, { mapping: ['a', 'b', 'c'], untitled: 'x' })
    expect(plan.issues).toEqual([])
    expect(plan.totals).toBe('match')
    expect(plan.counts).toEqual({ expenses: 3, refunds: 1, payments: 2 })
    expect(balancesAfterImport(plan.rows, trip)).toEqual(balancesOf(trip))
    const pizza = plan.rows.find((r) => r.kind === 'expense' && r.description === '=Pizza night')
    expect(pizza).toMatchObject({ category: 'food', amount_cents: 2700 })
    const refund = plan.rows.find((r) => r.kind === 'expense' && r.is_refund)
    expect(refund).toMatchObject({
      payers: [{ user_id: 'c', paid_cents: 3000 }],
      splits: [
        { user_id: 'a', share_cents: 1500 },
        { user_id: 'c', share_cents: 1500 },
      ],
    })
    expect(plan.rows.find((r) => r.kind === 'payment')).toEqual({
      kind: 'payment',
      from_user: 'c',
      to_user: 'a',
      amount_cents: 1000,
      currency: 'USD',
      paid_on: '2026-03-05',
      note: 'Cash',
    })
  })

  it('round trips through any language it was written in', () => {
    const spanish = ledgerCsv([trip], { ...options, labels: TEST_LABELS_ES })
    const file = readImportFile(spanish, [TEST_LABELS, TEST_LABELS_ES])
    expect(file.format).toBe('potluck')
    const plan = planImport(file, { mapping: ['a', 'b', 'c'], untitled: 'x' })
    expect(balancesAfterImport(plan.rows, trip)).toEqual(balancesOf(trip))
  })
})

describe('several groups', () => {
  const flat: LedgerGroup = {
    name: 'Flat',
    currency: 'EUR',
    expenses: [{ ...trip.expenses[3]!, payers: [{ userId: 'd', paidCents: 1000 }], fxRate: '1' }],
    payments: [],
  }
  const everyone = ledgerPeople(people, ['d', 'a'], (id) => names[id]!)

  it('give the people of every group a column, and a balance row each', () => {
    expect(everyone.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
    const rows = parseCsv(
      ledgerCsv([trip, flat, { ...flat, name: 'Empty', expenses: [] }], {
        ...options,
        people: everyone,
      }),
    )
    const balances = rows.filter((r) => r[2] === 'Balance').map((r) => r[1])
    expect(balances).toEqual(['Trip', 'Flat'])
  })

  it('import one group at a time', () => {
    const file = readImportFile(ledgerCsv([trip, flat], { ...options, people: everyone }), [
      TEST_LABELS,
    ])
    expect(file.groups).toEqual(['Trip', 'Flat'])
    const plan = planImport(file, { mapping: ['a', 'b', 'c', 'd'], group: 'Flat', untitled: 'x' })
    expect(plan.rows).toHaveLength(1)
    expect(plan.totals).toBe('match')
    expect(balancesAfterImport(plan.rows, flat)).toEqual(balancesOf(flat))
  })
})

describe('a friend export', () => {
  const friend = { me: 'a', friend: 'c' }
  const csv = ledgerCsv([trip], { ...options, friend })
  const rows = parseCsv(csv)

  it('has the two of you and what each row does between you', () => {
    expect(rows[0]!.slice(11)).toEqual([
      'Ava paid',
      'Ava share',
      'Cleo paid',
      'Cleo share',
      'Between you and Cleo',
      'Notes',
      'Items',
    ])
    // The pizza night was only Ava and Ben.
    expect(rows.some((r) => r[3] === "'=Pizza night")).toBe(false)
    expect(rows.some((r) => r[3] === 'Ben paid Ava')).toBe(false)
  })

  it('adds up to what you owe each other there', () => {
    const between = rows.at(-1)![15]
    const debts = pairwiseDebts(trip.expenses.map(toBalance), trip.payments, {
      groupCurrency: 'USD',
    })
    const debt = debts.find((d) => [d.fromUser, d.toUser].sort().join() === 'a,c')!
    const owedToMe = debt.toUser === 'a' ? debt.amountCents : -debt.amountCents
    expect(Math.round(Number(between) * 100)).toBe(owedToMe)
    const sum = rows.slice(1, -1).reduce((acc, r) => acc + Math.round(Number(r[15]) * 100), 0)
    expect(sum).toBe(owedToMe)
  })

  it('cannot be imported, since it leaves people out', () => {
    expect(readImportFile(csv, [TEST_LABELS]).issues).toEqual([{ line: 0, code: 'friend_export' }])
  })
})

describe('parseLedger', () => {
  const header = parseCsv(ledgerCsv([trip], options))[0]!.join(',')

  it('lists rows it cannot read', () => {
    const bad = [
      header,
      ',Trip,Mystery,,,,,,USD,,,,,,,,,,,,,',
      'soon,Trip,Expense,X,,10.00,USD,1,USD,10.00,Ava,10.00,10.00,0.00,,,,,,,,',
      '2026-03-01,Trip,Expense,X,,10.00,USD,1,USD,10.00,Ava,10.00,5.00,0.00,,,,,,,,',
      '2026-03-01,Trip,Expense,X,,ten,USD,1,USD,10.00,Ava,10.00,10.00,0.00,,,,,,,,',
      '2026-03-01,Trip,Expense,X,,10.00,US,1,USD,10.00,Ava,10.00,10.00,0.00,,,,,,,,',
      '2026-03-01,Trip,Expense,X,,10.00,USD,1,USD,10.00,Ava,ten,10.00,0.00,,,,,,,,',
      '2026-03-01,Trip,Payment,X,,10.00,USD,1,USD,10.00,Ava,10.00,10.00,0.00,,,,,,,,',
    ].join('\n')
    expect(parseLedger(parseCsv(bad), [TEST_LABELS]).issues).toEqual([
      { line: 2, code: 'unknown_format', detail: 'Mystery' },
      { line: 3, code: 'bad_date', detail: 'soon' },
      { line: 4, code: 'unbalanced' },
      { line: 5, code: 'bad_amount', detail: 'ten' },
      { line: 6, code: 'bad_currency', detail: 'US' },
      { line: 7, code: 'bad_amount', detail: 'ten' },
      { line: 8, code: 'unbalanced' },
    ])
  })

  it('says so when the header is not one it knows, or there are no rows', () => {
    expect(parseLedger(parseCsv('a,b'), [TEST_LABELS]).issues).toEqual([
      { line: 0, code: 'unknown_format' },
    ])
    expect(parseLedger(parseCsv(header), [TEST_LABELS]).issues).toEqual([
      { line: 0, code: 'no_rows' },
    ])
    const odd = header.replace('Ava balance,', '')
    expect(parseLedger(parseCsv(odd), [TEST_LABELS]).issues[0]!.code).toBe('unknown_format')
    const renamed = header.replace('Ben paid', 'Ben gave')
    expect(parseLedger(parseCsv(renamed), [TEST_LABELS]).issues[0]!.code).toBe('unknown_format')
  })

  it('gives duplicate names their own columns', () => {
    const twins = ledgerCsv([trip], {
      ...options,
      people: [
        { id: 'a', name: 'Alex' },
        { id: 'b', name: 'Alex' },
        { id: 'c', name: 'Cleo' },
      ],
    })
    expect(readImportFile(twins, [TEST_LABELS]).people).toEqual(['Alex', 'Alex (2)', 'Cleo'])
  })
})
