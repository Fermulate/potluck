import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { SPLITWISE_EXPORT, TEST_LABELS } from './fixtures'
import { failedLine, fromNets, guessMapping, planImport, rowEffect } from './import-plan'
import { readImportFile } from './read'
import type { SourceFile } from './source'

const people = { ava: 'a-ava', ben: 'b-ben', cleo: 'c-cleo' }
const splitwise = () => readImportFile(SPLITWISE_EXPORT, [TEST_LABELS])
const all = [people.ava, people.ben, people.cleo]

describe('fromNets', () => {
  it('one payer paid the cost and kept their share', () => {
    expect(
      fromNets(
        9000,
        new Map([
          ['a', 6000],
          ['b', -3000],
          ['c', -3000],
        ]),
      ),
    ).toEqual({
      amount_cents: 9000,
      payers: [{ user_id: 'a', paid_cents: 9000 }],
      splits: [
        { user_id: 'a', share_cents: 3000 },
        { user_id: 'b', share_cents: 3000 },
        { user_id: 'c', share_cents: 3000 },
      ],
    })
  })

  it('two payers, split equally, comes back exactly', () => {
    // 30 paid 15 and 15, split three ways: Ava -10, Ben +5, Cleo +5.
    expect(
      fromNets(
        3000,
        new Map([
          ['a', -1000],
          ['b', 500],
          ['c', 500],
        ]),
      ),
    ).toEqual({
      amount_cents: 3000,
      payers: [
        { user_id: 'b', paid_cents: 1500 },
        { user_id: 'c', paid_cents: 1500 },
      ],
      splits: [
        { user_id: 'a', share_cents: 1000 },
        { user_id: 'b', share_cents: 1000 },
        { user_id: 'c', share_cents: 1000 },
      ],
    })
  })

  it('a cost below what moved keeps what moved', () => {
    expect(
      fromNets(
        100,
        new Map([
          ['a', 500],
          ['b', -500],
        ]),
      ),
    ).toMatchObject({ amount_cents: 500 })
  })

  it('nothing moved, nothing to write', () => {
    expect(fromNets(450, new Map())).toBeNull()
  })

  it('always moves each person by exactly their net', () => {
    const nets = fc
      .array(fc.integer({ min: -100_000, max: 100_000 }), { minLength: 2, maxLength: 6 })
      .map((xs) => {
        const sum = xs.reduce((a, b) => a + b, 0)
        return [...xs, -sum]
      })
    fc.assert(
      fc.property(nets, fc.nat(1_000_000), (values, extra) => {
        const map = new Map(values.map((c, i) => [`p${i}`, c] as const).filter(([, c]) => c !== 0))
        const moved = [...map.values()].filter((c) => c > 0).reduce((a, b) => a + b, 0)
        const shape = fromNets(moved + extra, map)
        if (moved === 0) return expect(shape).toBeNull()
        const sum = (xs: { paid_cents?: number; share_cents?: number }[]) =>
          xs.reduce((a, x) => a + (x.paid_cents ?? x.share_cents ?? 0), 0)
        expect(sum(shape!.payers)).toBe(shape!.amount_cents)
        expect(sum(shape!.splits)).toBe(shape!.amount_cents)
        expect(shape!.amount_cents).toBe(moved + extra)
        const effect = rowEffect({
          kind: 'expense',
          description: 'x',
          currency: 'USD',
          spent_at: '2026-01-01',
          category: null,
          notes: null,
          is_refund: false,
          ...shape!,
        })
        for (const [id, cents] of map) expect(effect[id] ?? 0).toBe(cents)
      }),
    )
  })
})

describe('planImport from Splitwise', () => {
  it('turns every row into an expense or payment', () => {
    const plan = planImport(splitwise(), { mapping: all, untitled: 'Imported' })
    expect(plan.issues).toEqual([])
    expect(plan.counts).toEqual({ expenses: 3, refunds: 0, payments: 1 })
    expect(plan.skipped).toEqual([6])
    expect(plan.lines).toEqual([2, 3, 4, 5])
    expect(plan.rows[0]).toEqual({
      kind: 'expense',
      description: 'Dinner',
      amount_cents: 9000,
      currency: 'USD',
      spent_at: '2026-03-01',
      category: 'food',
      notes: null,
      is_refund: false,
      payers: [{ user_id: people.ava, paid_cents: 9000 }],
      splits: [
        { user_id: people.ava, share_cents: 3000 },
        { user_id: people.ben, share_cents: 3000 },
        { user_id: people.cleo, share_cents: 3000 },
      ],
    })
    expect(plan.rows[2]).toEqual({
      kind: 'payment',
      from_user: people.ben,
      to_user: people.ava,
      amount_cents: 3000,
      currency: 'USD',
      paid_on: '2026-03-03',
      note: null,
    })
  })

  it('ends at the balances Splitwise shows, and checks its total line', () => {
    const plan = planImport(splitwise(), { mapping: all, untitled: 'Imported' })
    expect(plan.effects).toEqual({
      USD: { [people.ava]: -500, [people.ben]: 4000, [people.cleo]: -3500 },
    })
    expect(plan.totals).toBe('match')
    const edited = SPLITWISE_EXPORT.replace('USD,-5.00,40.00', 'USD,-6.00,41.00')
    expect(
      planImport(readImportFile(edited, [TEST_LABELS]), { mapping: all, untitled: 'x' }).totals,
    ).toBe('mismatch')
  })

  it('needs everyone with money matched to a member', () => {
    const plan = planImport(splitwise(), {
      mapping: [people.ava, null, people.cleo],
      untitled: 'x',
    })
    expect(plan.issues).toEqual([{ line: 0, code: 'unmapped', detail: 'Ben Jones' }])
    expect(plan.rows).toEqual([])
  })

  it('two names for one person add up; a payment to yourself is dropped', () => {
    const plan = planImport(splitwise(), {
      mapping: [people.ava, people.ava, people.cleo],
      untitled: 'x',
    })
    expect(plan.effects.USD).toEqual({ [people.ava]: 3500, [people.cleo]: -3500 })
    expect(plan.counts.payments).toBe(0)
    expect(plan.skipped).toContain(4)
  })

  it('gives a nameless row a description and keeps descriptions short', () => {
    const file = readImportFile(
      `Date,Description,Category,Cost,Currency,Ava,Ben\n2026-03-01,,General,10.00,USD,5.00,-5.00\n2026-03-01,${'x'.repeat(200)},General,10.00,USD,5.00,-5.00`,
      [TEST_LABELS],
    )
    const plan = planImport(file, { mapping: ['a', 'b'], untitled: 'Imported expense' })
    expect(plan.rows.map((r) => (r.kind === 'expense' ? r.description.length : 0))).toEqual([
      'Imported expense'.length,
      120,
    ])
  })

  it('refuses more rows than one import takes', () => {
    const row = '2026-03-01,Lunch,General,10.00,USD,5.00,-5.00\n'
    const file = readImportFile(
      `Date,Description,Category,Cost,Currency,Ava,Ben\n${row.repeat(5001)}`,
      [TEST_LABELS],
    )
    const plan = planImport(file, { mapping: ['a', 'b'], untitled: 'x' })
    expect(plan.issues).toEqual([{ line: 0, code: 'too_many_rows', detail: '5000' }])
  })

  it('a payment row that is not one person paying another is an expense', () => {
    const file: SourceFile = {
      ...splitwise(),
      entries: [
        {
          line: 2,
          kind: 'payment',
          date: '2026-03-01',
          description: 'Odd',
          category: null,
          notes: null,
          amountCents: 3000,
          currency: 'USD',
          group: null,
          nets: [-3000, 1500, 1500],
        },
      ],
      totals: [],
      checks: [],
    }
    const plan = planImport(file, { mapping: all, untitled: 'x' })
    expect(plan.rows[0]!.kind).toBe('expense')
    expect(plan.totals).toBe('none')
  })
})

describe('failedLine', () => {
  it('reads the row number the server puts in the hint', () => {
    expect(failedLine({ lines: [2, 3, 5] }, 'import_row:3')).toBe(5)
    expect(failedLine({ lines: [2] }, 'import_row:9')).toBeNull()
    expect(failedLine({ lines: [2] }, 'something else')).toBeNull()
    expect(failedLine({ lines: [2] }, null)).toBeNull()
  })
})

describe('guessMapping', () => {
  const members = [
    { id: 'ava', name: 'Ava Smith' },
    { id: 'ben', name: 'Ben' },
    { id: 'cleo', name: 'Cléo Park' },
    { id: 'cleo2', name: 'Cleo Jones' },
  ]

  it('matches full names, then first names, accents and case aside', () => {
    expect(guessMapping(['ava smith', 'Ben Jones', 'Cleo Park', 'Dan', ''], members)).toEqual([
      'ava',
      'ben',
      'cleo',
      null,
      null,
    ])
  })

  it('never guesses when two members fit, or a member twice', () => {
    expect(guessMapping(['Cleo', 'Ava', 'Ava Smith'], members)).toEqual([null, null, 'ava'])
  })
})
