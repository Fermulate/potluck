import { afterEach, describe, expect, it } from 'vitest'
import { currencyCodes, currencyLabel } from './locale'

describe('currency pickers', () => {
  const RealDisplayNames = Intl.DisplayNames
  /** Stands in for the browser's currency names. */
  const names = (of: (code: string) => string) =>
    Object.defineProperty(Intl, 'DisplayNames', {
      value: class {
        of = of
      },
      configurable: true,
      writable: true,
    })

  afterEach(() => {
    Object.defineProperty(Intl, 'DisplayNames', {
      value: RealDisplayNames,
      configurable: true,
      writable: true,
    })
  })

  it('offer the common currencies first, then the rest in use, each once', () => {
    const codes = currencyCodes()
    expect(codes.slice(0, 3)).toEqual(['USD', 'EUR', 'GBP'])
    expect(new Set(codes).size).toBe(codes.length)
    expect(codes).toEqual(expect.arrayContaining(['XAF', 'XOF', 'BHD', 'SLE']))
  })

  it('leave out withdrawn currencies and codes that are not money', () => {
    const codes = currencyCodes()
    for (const code of ['SLL', 'HRK', 'XDR', 'XSU', 'XAU', 'XXX', 'CLF']) {
      expect(codes, code).not.toContain(code)
    }
  })

  it('name a currency without dash characters', () => {
    names(() => 'Sierra Leonean Leone (1964\u20142022, then \u2013 renamed)')
    expect(currencyLabel('SLL')).toBe('SLL (Sierra Leonean Leone (1964-2022, then - renamed))')
  })

  it('fall back to the code when there is no name', () => {
    expect(currencyLabel('EUR')).toMatch(/^EUR \(.+\)$/)
    names((code) => code)
    expect(currencyLabel('ZWG')).toBe('ZWG')
  })
})
