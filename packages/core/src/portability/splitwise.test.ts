import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv'
import { SPLITWISE_EXPORT, TEST_LABELS } from './fixtures'
import { readImportFile } from './read'
import { looksLikeSplitwise, parseSplitwise, splitwiseCategory } from './splitwise'

describe('Splitwise exports', () => {
  it('are recognised by their shape, whatever the header language', () => {
    expect(looksLikeSplitwise(parseCsv(SPLITWISE_EXPORT))).toBe(true)
    const german = SPLITWISE_EXPORT.replace(
      'Date,Description,Category,Cost,Currency',
      'Datum,Beschreibung,Kategorie,Kosten,Währung',
    )
    expect(looksLikeSplitwise(parseCsv(german))).toBe(true)
    expect(looksLikeSplitwise(parseCsv('a,b,c\n1,2,3'))).toBe(false)
    expect(looksLikeSplitwise(parseCsv('Date,Description,Category,Cost,Currency,Ava'))).toBe(false)
  })

  it('reads people, rows, payments and the total line', () => {
    const file = parseSplitwise(parseCsv(SPLITWISE_EXPORT))
    expect(file.people).toEqual(['Ava Smith', 'Ben Jones', 'Cleo Park'])
    expect(file.issues).toEqual([])
    expect(file.entries.map((e) => [e.line, e.kind, e.amountCents, e.category])).toEqual([
      [2, 'expense', 9000, 'food'],
      [3, 'expense', 4500, 'groceries'],
      [4, 'payment', 3000, null],
      [5, 'expense', 3000, 'tickets'],
      [6, 'expense', 450, 'other'],
    ])
    expect(file.entries[1]!.description).toBe('Groceries, big shop')
    expect(file.entries[0]!.nets).toEqual([6000, -3000, -3000])
    expect(file.totals).toEqual([{ line: 8, key: 'USD', nets: [-500, 4000, -3500] }])
  })

  it('knows "Payment" in other languages', () => {
    const file = parseSplitwise(
      parseCsv(
        'Datum,B,K,Kosten,W,Ava,Ben\n2026-03-03,Ben zahlte Ava,Zahlung,30.00,EUR,-30.00,30.00',
      ),
    )
    expect(file.entries[0]!.kind).toBe('payment')
  })

  it('lists rows it cannot read with their line', () => {
    const file = parseSplitwise(
      parseCsv(
        [
          'Date,Description,Category,Cost,Currency,Ava,Ben',
          'yesterday,Lunch,General,10.00,USD,5.00,-5.00',
          '2026-03-01,Lunch,General,ten,USD,5.00,-5.00',
          '2026-03-01,Lunch,General,10.00,dollars,5.00,-5.00',
          '2026-03-01,Lunch,General,10.00,USD,5.00,-4.00',
          '2026-03-01,Lunch,General,10.00,USD,5.00,x',
          '2026-02-30,Lunch,General,10.00,USD,5.00,-5.00',
        ].join('\n'),
      ),
    )
    expect(file.issues).toEqual([
      { line: 2, code: 'bad_date', detail: 'yesterday' },
      { line: 3, code: 'bad_amount', detail: 'ten' },
      { line: 4, code: 'bad_currency', detail: 'dollars' },
      { line: 5, code: 'unbalanced' },
      { line: 6, code: 'bad_amount', detail: 'x' },
      { line: 7, code: 'bad_date', detail: '2026-02-30' },
    ])
    expect(file.entries).toEqual([])
  })

  it('says when there are no rows', () => {
    const file = parseSplitwise(parseCsv('Date,Description,Category,Cost,Currency,Ava,Ben\n'))
    expect(file.issues).toEqual([{ line: 0, code: 'no_rows' }])
  })

  it('maps categories, anything unknown to other', () => {
    expect(splitwiseCategory('Gas/fuel')).toBe('gas')
    expect(splitwiseCategory(' hotel ')).toBe('lodging')
    expect(splitwiseCategory('Medical expenses')).toBe('other')
  })
})

describe('readImportFile', () => {
  it('tells formats apart', () => {
    expect(readImportFile(SPLITWISE_EXPORT, [TEST_LABELS]).format).toBe('splitwise')
    expect(readImportFile('name,age\nAva,30', [TEST_LABELS]).issues).toEqual([
      { line: 0, code: 'unknown_format' },
    ])
    expect(readImportFile('PK\u0003\u0004\u0000\u0000', [TEST_LABELS]).issues).toEqual([
      { line: 0, code: 'not_csv' },
    ])
  })
})
