import { describe, expect, it } from 'vitest'
import { CURRENCIES_IN_USE } from './in-use'

describe('currencies in use', () => {
  it('lists each code once, three capital letters, in order', () => {
    expect(new Set(CURRENCIES_IN_USE).size).toBe(CURRENCIES_IN_USE.length)
    for (const code of CURRENCIES_IN_USE) expect(code).toMatch(/^[A-Z]{3}$/)
    expect([...CURRENCIES_IN_USE].sort()).toEqual(CURRENCIES_IN_USE)
  })

  it('keeps the money people pay with, X codes that are money included', () => {
    for (const code of [
      'USD',
      'EUR',
      'GBP',
      'JPY',
      'SLE',
      'VED',
      'XAF',
      'XOF',
      'XPF',
      'XCD',
      'ZWG',
    ]) {
      expect(CURRENCIES_IN_USE, code).toContain(code)
    }
  })

  it('leaves out withdrawn currencies, fund codes and X codes that are not money', () => {
    for (const code of [
      'SLL',
      'HRK',
      'BGN',
      'ZWL',
      'ANG',
      'CLF',
      'USN',
      'XDR',
      'XSU',
      'XAU',
      'XTS',
      'XXX',
    ]) {
      expect(CURRENCIES_IN_USE, code).not.toContain(code)
    }
  })
})
