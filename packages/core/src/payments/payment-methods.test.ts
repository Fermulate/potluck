import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  PAYMENT_KINDS,
  isValidHandle,
  normalizeHandle,
  payableMethods,
  paymentAction,
  plainAmount,
  type PaymentKind,
} from '../index'

describe('isValidHandle', () => {
  // Same cases as "handle rules match the core test cases" in supabase/tests/23_payments.test.sql.
  const cases: [string, string, boolean][] = [
    ['paypal', 'avamakes', true],
    ['paypal', 'ava.makes', false],
    ['paypal', 'ava makes', false],
    ['venmo', 'Ava-Lee', true],
    ['venmo', 'ava', false],
    ['cashapp', 'Ava22', true],
    ['cashapp', '2ava', false],
    ['revolut', 'avalee', true],
    ['monzo', 'av', false],
    ['upi', 'ava@okhdfc', true],
    ['upi', 'ava', false],
    ['interac', 'ava@example.ca', true],
    ['interac', '+14165550123', true],
    ['interac', '555', false],
    ['bank', 'IBAN DE89 3704 0044 0532 0130 00', true],
    ['bank', '', false],
    ['paypal', ' ava', false],
    ['zelle', 'ava', false],
  ]
  it.each(cases)('%s %j is %s', (kind, handle, expected) => {
    expect(isValidHandle(kind, handle)).toBe(expected)
  })

  it('caps every handle at 256 characters', () => {
    expect(isValidHandle('bank', 'x'.repeat(200))).toBe(true)
    expect(isValidHandle('bank', 'x'.repeat(201))).toBe(false)
  })
})

describe('normalizeHandle', () => {
  it.each<[PaymentKind, string, string]>([
    ['paypal', ' https://www.paypal.me/AvaMakes/20USD ', 'AvaMakes'],
    ['paypal', '@avamakes', 'avamakes'],
    ['venmo', 'https://venmo.com/u/Ava-Lee', 'Ava-Lee'],
    ['venmo', '@Ava-Lee', 'Ava-Lee'],
    ['cashapp', '$Ava22', 'Ava22'],
    ['cashapp', 'https://cash.app/$Ava22', 'Ava22'],
    ['revolut', 'revolut.me/avalee', 'avalee'],
    ['monzo', 'https://monzo.me/avalee/10', 'avalee'],
    ['upi', ' Ava@OKHDFC ', 'ava@okhdfc'],
    ['interac', '(416) 555-0123', '4165550123'],
    ['interac', '+1 416 555 0123', '+14165550123'],
    ['interac', 'Ava@Example.ca', 'ava@example.ca'],
    ['bank', '  Sort code 12-34-56  ', 'Sort code 12-34-56'],
  ])('%s %j becomes %j', (kind, raw, expected) => {
    expect(normalizeHandle(kind, raw)).toBe(expected)
  })

  it('turns pasted profile links into valid handles', () => {
    expect(isValidHandle('cashapp', normalizeHandle('cashapp', 'https://cash.app/$Ava22'))).toBe(
      true,
    )
    expect(isValidHandle('venmo', normalizeHandle('venmo', 'venmo.com/Ava-Lee?txn=pay'))).toBe(true)
  })

  it('never lengthens what was typed', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PAYMENT_KINDS), fc.string(), (kind, raw) => {
        expect(normalizeHandle(kind, raw).length).toBeLessThanOrEqual(raw.length)
      }),
    )
  })
})

describe('payableMethods', () => {
  const methods = [
    { kind: 'bank' as const, handle: 'x' },
    { kind: 'upi' as const, handle: 'ava@okhdfc' },
    { kind: 'interac' as const, handle: 'ava@example.ca' },
    { kind: 'venmo' as const, handle: 'Ava-Lee' },
    { kind: 'paypal' as const, handle: 'avamakes' },
  ]

  it('puts apps with links first and details to copy last', () => {
    expect(payableMethods(methods, 'USD').map((m) => m.kind)).toEqual([
      'paypal',
      'venmo',
      'interac',
      'bank',
    ])
  })

  it('offers UPI only for rupees', () => {
    expect(payableMethods(methods, 'inr').map((m) => m.kind)).toEqual([
      'paypal',
      'venmo',
      'upi',
      'interac',
      'bank',
    ])
  })
})

describe('plainAmount', () => {
  it('uses the digits of the currency', () => {
    expect(plainAmount(1250, 'USD')).toBe('12.50')
    expect(plainAmount(5, 'EUR')).toBe('0.05')
    expect(plainAmount(1500, 'JPY')).toBe('1500')
    expect(plainAmount(1234, 'KWD')).toBe('1.234')
    expect(plainAmount(-1250, 'USD')).toBe('-12.50')
    expect(plainAmount(0, 'USD')).toBe('0.00')
  })
})

describe('paymentAction', () => {
  const pay = (kind: PaymentKind, handle: string, amountCents = 2050, currency = 'USD') =>
    paymentAction({ kind, handle }, { amountCents, currency, note: 'Tacos', payeeName: 'Ava' })

  it('builds PayPal.me links with the amount and currency', () => {
    expect(pay('paypal', 'avamakes')).toEqual({
      type: 'link',
      url: 'https://paypal.me/avamakes/20.50USD',
      prefilled: true,
    })
    expect(pay('paypal', 'avamakes', 1500, 'JPY')).toMatchObject({
      url: 'https://paypal.me/avamakes/1500JPY',
    })
  })

  it('prefills Venmo only in dollars', () => {
    expect(pay('venmo', 'Ava-Lee')).toEqual({
      type: 'link',
      url: 'https://venmo.com/Ava-Lee?txn=pay&amount=20.50&note=Tacos',
      prefilled: true,
    })
    expect(pay('venmo', 'Ava-Lee', 2050, 'EUR')).toEqual({
      type: 'link',
      url: 'https://venmo.com/Ava-Lee?txn=pay&note=Tacos',
      prefilled: false,
    })
  })

  it('builds Cash App, Monzo and Revolut links', () => {
    expect(pay('cashapp', 'Ava22')).toMatchObject({
      url: 'https://cash.app/$Ava22/20.50',
      prefilled: true,
    })
    expect(pay('cashapp', 'Ava22', 100, 'CAD')).toMatchObject({
      url: 'https://cash.app/$Ava22',
      prefilled: false,
    })
    expect(pay('monzo', 'avalee', 2050, 'GBP')).toMatchObject({
      url: 'https://monzo.me/avalee/20.50',
      prefilled: true,
    })
    expect(pay('monzo', 'avalee')).toMatchObject({
      url: 'https://monzo.me/avalee',
      prefilled: false,
    })
    expect(pay('revolut', 'avalee')).toEqual({
      type: 'link',
      url: 'https://revolut.me/avalee',
      prefilled: false,
    })
  })

  it('builds UPI intents in rupees', () => {
    expect(pay('upi', 'ava@okhdfc', 50000, 'INR')).toEqual({
      type: 'link',
      url: 'upi://pay?pa=ava%40okhdfc&pn=Ava&am=500.00&cu=INR&tn=Tacos',
      prefilled: true,
    })
    expect(pay('upi', 'ava@okhdfc')).toMatchObject({
      url: 'upi://pay?pa=ava%40okhdfc&pn=Ava&tn=Tacos',
      prefilled: false,
    })
  })

  it('offers a copy button where there is no link', () => {
    expect(pay('interac', 'ava@example.ca')).toEqual({ type: 'copy', value: 'ava@example.ca' })
    expect(pay('bank', 'Sort code 12-34-56')).toEqual({ type: 'copy', value: 'Sort code 12-34-56' })
  })

  it('leaves the amount out when there is nothing to pay', () => {
    expect(pay('paypal', 'avamakes', 0)).toEqual({
      type: 'link',
      url: 'https://paypal.me/avamakes',
      prefilled: false,
    })
  })

  it('escapes handles in URLs', () => {
    const action = paymentAction(
      { kind: 'venmo', handle: 'a/b?c' },
      { amountCents: 1, currency: 'USD' },
    )
    expect(action).toMatchObject({ url: 'https://venmo.com/a%2Fb%3Fc?txn=pay&amount=0.01' })
  })
})
