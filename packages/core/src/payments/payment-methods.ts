import { minorUnits } from '../currency'

/**
 * Where someone can be paid, and the link that opens that app with the amount filled in.
 * Potluck never moves money (ADR 15): links only save typing, and the payer still confirms the
 * payment went through before it is recorded.
 *
 * Handle rules mirror `private.valid_payment_handle` in SQL; both are tested with the same cases
 * (`payment-methods.test.ts`, `supabase/tests/20_payments.test.sql`).
 */
export const PAYMENT_KINDS = [
  'paypal',
  'venmo',
  'cashapp',
  'revolut',
  'monzo',
  'upi',
  'interac',
  'bank',
] as const

export type PaymentKind = (typeof PAYMENT_KINDS)[number]

export interface PaymentMethod {
  kind: PaymentKind
  handle: string
}

const RULES: Record<PaymentKind, (handle: string) => boolean> = {
  paypal: (h) => /^[A-Za-z0-9]{1,20}$/.test(h),
  venmo: (h) => /^[A-Za-z0-9_-]{5,30}$/.test(h),
  cashapp: (h) => /^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(h),
  revolut: (h) => /^[A-Za-z0-9]{3,32}$/.test(h),
  monzo: (h) => /^[A-Za-z0-9]{3,32}$/.test(h),
  upi: (h) => /^[A-Za-z0-9._-]{2,200}@[A-Za-z]{2,50}$/.test(h),
  interac: (h) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(h) || /^\+?[0-9]{10,15}$/.test(h),
  bank: (h) => h.length <= 200,
}

export function isPaymentKind(kind: string): kind is PaymentKind {
  return (PAYMENT_KINDS as readonly string[]).includes(kind)
}

/** Whether a stored (normalized) handle is valid for `kind`. Same rule as the database. */
export function isValidHandle(kind: string, handle: string): boolean {
  if (!isPaymentKind(kind)) return false
  if (handle !== handle.trim() || handle.length < 1 || handle.length > 256) return false
  return RULES[kind](handle)
}

const URL_PREFIX: Partial<Record<PaymentKind, RegExp>> = {
  paypal: /^(?:https?:\/\/)?(?:www\.)?paypal\.me\//i,
  venmo: /^(?:https?:\/\/)?(?:www\.|account\.)?venmo\.com\/(?:u\/)?/i,
  cashapp: /^(?:https?:\/\/)?(?:www\.)?cash\.app\//i,
  revolut: /^(?:https?:\/\/)?(?:www\.)?revolut\.me\//i,
  monzo: /^(?:https?:\/\/)?(?:www\.)?monzo\.me\//i,
}

/**
 * What people paste or type, turned into the stored form: no surrounding spaces, no profile URL,
 * no leading @ or $, and phone numbers for Interac as digits with an optional leading +.
 */
export function normalizeHandle(kind: PaymentKind, raw: string): string {
  let handle = raw.trim()
  const prefix = URL_PREFIX[kind]
  if (prefix) handle = handle.replace(prefix, '').replace(/[/?#].*$/, '')
  if (kind === 'venmo' || kind === 'paypal' || kind === 'revolut' || kind === 'monzo') {
    handle = handle.replace(/^@/, '')
  }
  if (kind === 'cashapp') handle = handle.replace(/^\$/, '')
  if (kind === 'interac' && !handle.includes('@')) {
    const phone = handle.replace(/[\s().-]/g, '')
    if (/^\+?[0-9]+$/.test(phone)) handle = phone
  }
  if (kind === 'upi' || (kind === 'interac' && handle.includes('@'))) handle = handle.toLowerCase()
  return handle.trim()
}

/** The currencies an app takes, when it only takes some. Amounts are only prefilled in these. */
const CURRENCIES: Partial<Record<PaymentKind, readonly string[]>> = {
  venmo: ['USD'],
  cashapp: ['USD', 'GBP'],
  monzo: ['GBP'],
  upi: ['INR'],
}

/** Minor units as a plain decimal string with the currency's digits: 1250 USD is "12.50". */
export function plainAmount(amountCents: number, currency: string): string {
  const digits = minorUnits(currency)
  const negative = amountCents < 0
  const abs = String(Math.abs(Math.trunc(amountCents))).padStart(digits + 1, '0')
  const whole = digits === 0 ? abs : abs.slice(0, -digits)
  const fraction = digits === 0 ? '' : `.${abs.slice(-digits)}`
  return `${negative ? '-' : ''}${whole}${fraction}`
}

/** `a=1&b=2` from the pairs that have a value (no URLSearchParams: core has no DOM or Node). */
function query(pairs: [string, string | undefined][]): string {
  return pairs
    .filter((p): p is [string, string] => !!p[1])
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')
}

export type PaymentAction =
  /** Opens the app or site. `prefilled`: the amount is in the link. */
  | { type: 'link'; url: string; prefilled: boolean }
  /** No link exists (Interac, bank details): show the handle with a copy button. */
  | { type: 'copy'; value: string }

export interface PaymentLinkInput {
  amountCents: number
  currency: string
  /** Shown in the app's note field where it has one. */
  note?: string
  /** The recipient's name, for UPI. */
  payeeName?: string
}

/** Methods that only show details to copy, never a link. */
const COPY_ONLY: readonly PaymentKind[] = ['interac', 'bank']

/**
 * The methods worth offering for a payment in `currency`, in the order to show them: apps that
 * open with a link first, then details to copy (Interac, bank). UPI only works in rupees, so it
 * is left out for any other currency.
 */
export function payableMethods<M extends PaymentMethod>(
  methods: readonly M[],
  currency: string,
): M[] {
  const cur = currency.toUpperCase()
  const rank = (m: M) => (COPY_ONLY.includes(m.kind) ? 1 : 0) * 100 + PAYMENT_KINDS.indexOf(m.kind)
  return methods.filter((m) => m.kind !== 'upi' || cur === 'INR').sort((a, b) => rank(a) - rank(b))
}

/** How to pay `method` the given amount. Built on the client only; nothing is sent anywhere. */
export function paymentAction(method: PaymentMethod, input: PaymentLinkInput): PaymentAction {
  const currency = input.currency.toUpperCase()
  const supported = CURRENCIES[method.kind]
  const prefilled = input.amountCents > 0 && (!supported || supported.includes(currency))
  const amount = plainAmount(input.amountCents, currency)
  const h = encodeURIComponent(method.handle)
  switch (method.kind) {
    case 'paypal':
      return {
        type: 'link',
        url: prefilled ? `https://paypal.me/${h}/${amount}${currency}` : `https://paypal.me/${h}`,
        prefilled,
      }
    case 'venmo': {
      const params = query([
        ['txn', 'pay'],
        ['amount', prefilled ? amount : undefined],
        ['note', input.note],
      ])
      return { type: 'link', url: `https://venmo.com/${h}?${params}`, prefilled }
    }
    case 'cashapp':
      return {
        type: 'link',
        url: prefilled ? `https://cash.app/$${h}/${amount}` : `https://cash.app/$${h}`,
        prefilled,
      }
    case 'revolut':
      return { type: 'link', url: `https://revolut.me/${h}`, prefilled: false }
    case 'monzo':
      return {
        type: 'link',
        url: prefilled ? `https://monzo.me/${h}/${amount}` : `https://monzo.me/${h}`,
        prefilled,
      }
    case 'upi': {
      const params = query([
        ['pa', method.handle],
        ['pn', input.payeeName],
        ['am', prefilled ? amount : undefined],
        ['cu', prefilled ? 'INR' : undefined],
        ['tn', input.note],
      ])
      return { type: 'link', url: `upi://pay?${params}`, prefilled }
    }
    case 'interac':
    case 'bank':
      return { type: 'copy', value: method.handle }
  }
}
