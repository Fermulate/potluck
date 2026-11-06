import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { minorUnits } from '@potluck/core'
import { formatMoney as formatMoneyText } from '@potluck/i18n'
import { formatMoney, formatMoneyInput, parseMoneyInput } from '@potluck/ui'
import { describe, expect, it } from 'vitest'

const migrations = join(import.meta.dirname, '../../../../supabase/migrations')

/**
 * The `private.minor_units` table as the database runs it: the newest migration that defines
 * the function wins, like `supabase migration up` replaying them in order.
 */
function sqlMinorUnits(): (currency: string) => number {
  const files = readdirSync(migrations)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  const sources = files
    .map((f) => readFileSync(join(migrations, f), 'utf8'))
    .filter((sql) => /function\s+private\.minor_units\s*\(/i.test(sql))
  const latest = sources.at(-1)
  if (!latest) throw new Error('no migration defines private.minor_units')
  const start = latest.search(/function\s+private\.minor_units\s*\(/i)
  const body = latest.slice(start, latest.indexOf('end;', start))
  const table = new Map<string, number>()
  for (const [, code, digits] of body.matchAll(/when\s+'([A-Z]{3})'\s+then\s+(\d+)/gi)) {
    table.set(code!.toUpperCase(), Number(digits))
  }
  const fallback = /else\s+(\d+)/i.exec(body)
  if (table.size === 0 || !fallback) throw new Error('could not read private.minor_units')
  return (currency) => table.get(currency.toUpperCase()) ?? Number(fallback[1])
}

/** Digits after the decimal point in an en-US formatted amount. */
const decimalsIn = (text: string) => /\.(\d+)/.exec(text)?.[1]?.length ?? 0

const currencies = Intl.supportedValuesOf('currency')
const sql = sqlMinorUnits()

describe('minor units', () => {
  it('covers every currency people can pick', () => {
    expect(currencies.length).toBeGreaterThan(100)
    expect(currencies).toEqual(expect.arrayContaining(['USD', 'JPY', 'HUF', 'IQD', 'KWD']))
  })

  it.each(currencies)('%s agrees across core, the database, i18n and ui', (currency) => {
    const digits = minorUnits(currency)
    const amount = 1_234_567

    expect(sql(currency)).toBe(digits)
    expect(decimalsIn(formatMoneyText(amount, currency, { locale: 'en-US' }))).toBe(digits)
    expect(decimalsIn(formatMoney(amount, currency, { locale: 'en-US' }))).toBe(digits)
    expect(formatMoney(amount, currency, { locale: 'en-US' })).toBe(
      formatMoneyText(amount, currency, { locale: 'en-US' }),
    )
    expect(parseMoneyInput('1', currency, 'en-US')).toBe(10 ** digits)
    expect(parseMoneyInput(formatMoneyInput(amount, currency, 'en-US'), currency, 'en-US')).toBe(
      amount,
    )
  })
})
