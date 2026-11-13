import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { csvCell, isBlankRow, parseCsv, toCsv, unguardCell } from './csv'
import { formatMinor, parseMinor, trimRate } from './decimal'

describe('csvCell', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('Pizza, wine')).toBe('"Pizza, wine"')
    expect(csvCell('Say "cheese"')).toBe('"Say ""cheese"""')
    expect(csvCell('a\nb')).toBe('"a\nb"')
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(12)).toBe('12')
  })

  it('neutralises formulas but not negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('-12.50')).toBe('-12.50')
    expect(unguardCell("'=1+1")).toBe('=1+1')
    expect(unguardCell("'tis")).toBe("'tis")
  })
})

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes and line breaks inside quotes', () => {
    expect(parseCsv('a,"b, c","say ""hi""",\r\n"x\ny",z\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"', ''],
      ['x\ny', 'z'],
    ])
  })

  it('drops a byte order mark and keeps blank lines as blank rows', () => {
    const rows = parseCsv('﻿a,b\n\nc,d')
    expect(rows).toEqual([['a', 'b'], [''], ['c', 'd']])
    expect(isBlankRow(rows[1]!)).toBe(true)
    expect(isBlankRow(rows[0]!)).toBe(false)
  })

  it('takes semicolons or tabs when the first line uses them', () => {
    expect(parseCsv('a;b;"c;d"\r1;2;3')).toEqual([
      ['a', 'b', 'c;d'],
      ['1', '2', '3'],
    ])
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('reads back whatever toCsv writes', () => {
    const text = fc.string({ unit: fc.constantFrom('a', ',', '"', '\n', ';', '=', ' ', '1') })
    fc.assert(
      fc.property(
        fc.array(fc.array(text, { minLength: 2, maxLength: 4 }), { minLength: 1 }),
        (rows) => {
          const back = parseCsv(toCsv(rows)).map((row) => row.map(unguardCell))
          expect(back).toEqual(rows)
        },
      ),
    )
  })

  it('reads a large file quickly', () => {
    const row = '2026-03-01,"Dinner, with ""friends""",Dining out,90.00,USD,60.00,-30.00,-30.00\r\n'
    const text = 'Date,Description,Category,Cost,Currency,A,B,C\r\n' + row.repeat(50_000)
    const started = Date.now()
    const rows = parseCsv(text)
    expect(rows).toHaveLength(50_001)
    expect(rows[50_000]![1]).toBe('Dinner, with "friends"')
    expect(Date.now() - started).toBeLessThan(2000)
  })
})

describe('decimals', () => {
  it('formats minor units with the currency digits', () => {
    expect(formatMinor(1234, 'USD')).toBe('12.34')
    expect(formatMinor(-5, 'USD')).toBe('-0.05')
    expect(formatMinor(1500, 'JPY')).toBe('1500')
    expect(formatMinor(1234, 'KWD')).toBe('1.234')
  })

  it('parses plain decimals to minor units', () => {
    expect(parseMinor('12.34', 'USD')).toBe(1234)
    expect(parseMinor('-7.5', 'USD')).toBe(-750)
    expect(parseMinor('+3', 'USD')).toBe(300)
    expect(parseMinor('1,234.00', 'USD')).toBe(123400)
    expect(parseMinor('1500.00', 'JPY')).toBe(1500)
    expect(parseMinor('1500.0', 'JPY')).toBe(1500)
    expect(parseMinor('-0.00', 'USD')).toBe(0)
    expect(parseMinor(' 4.10 ', 'USD')).toBe(410)
  })

  it('refuses anything that is not a plain amount', () => {
    for (const text of ['', 'abc', '12.345', '1.5', '$12', '12,34', '1e3']) {
      const currency = text === '1.5' ? 'JPY' : 'USD'
      expect(parseMinor(text, currency), text).toBeNull()
    }
  })

  it('round trips every amount', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1e11, max: 1e11 }),
        fc.constantFrom('USD', 'JPY', 'KWD'),
        (cents, cur) => {
          expect(parseMinor(formatMinor(cents, cur), cur)).toBe(cents)
        },
      ),
    )
  })

  it('trims a rate', () => {
    expect(trimRate('1.100000000000')).toBe('1.1')
    expect(trimRate('1.000000000000')).toBe('1')
    expect(trimRate(1)).toBe('1')
    expect(trimRate('0.912345678901')).toBe('0.912345678901')
  })
})
