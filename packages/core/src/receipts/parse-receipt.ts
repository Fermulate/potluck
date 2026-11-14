import { minorUnits } from '../currency'

/** One priced line read off a receipt, in minor units of the scan's currency. */
export interface ReceiptItem {
  description: string
  amountCents: number
  /** How many were bought ("2 x Coffee"); the amount is the line total. */
  quantity: number
}

/**
 * What a receipt says, as far as the text lets us tell. Every field may be missing: a scan is a
 * suggestion the person confirms, never something saved on its own.
 */
export interface ReceiptScan {
  merchant: string | null
  /** Calendar day, `YYYY-MM-DD`. */
  date: string | null
  /** ISO code when the receipt names its currency (a symbol or a code), else null. */
  currency: string | null
  totalCents: number | null
  subtotalCents: number | null
  /** Tax added on top of the items. Null when the prices already include it (VAT receipts). */
  taxCents: number | null
  tipCents: number | null
  discountCents: number | null
  items: ReceiptItem[]
  /**
   * True when no total line was read and the total is the subtotal, or else the items, with no
   * payment line saying the same amount. The person should check it.
   */
  totalDerived: boolean
  /**
   * Whether the items (with tax, tip and discount) come to the total: `exact`, `close` (within
   * 5%), `off`, `unconfirmed` when the total was worked out rather than read and the items are
   * not far off it (it cannot confirm them), or null when there is no total or no item to compare. Anything but
   * `exact` means a line was misread or missed, and the review says so.
   */
  itemsMatch: 'exact' | 'close' | 'off' | 'unconfirmed' | null
}

export interface ParseReceiptOptions {
  /** Currency to read amounts in when the receipt does not say (the expense's currency). */
  currency: string
  /** How to read an ambiguous 03/04/2026. Defaults to day first. */
  dateOrder?: 'dmy' | 'mdy'
  /** Today, `YYYY-MM-DD`: dates after it are misreads and are dropped. */
  today?: string
}

/** At most this many items are offered; a longer list is almost surely noise. */
export const MAX_RECEIPT_ITEMS = 60

const ITEM_NAME_MAX = 80
const MERCHANT_MAX = 120

/** Day first or month first for a numeric date, from the currency and the viewer's locale. */
export function receiptDateOrder(currency: string, locale?: string): 'dmy' | 'mdy' {
  if (locale) return /^en-US$|^en-PH$|^es-US$/i.test(locale) ? 'mdy' : 'dmy'
  return currency.toUpperCase() === 'USD' ? 'mdy' : 'dmy'
}

// Text helpers ---------------------------------------------------------------------------------

/** Lowercase without accents, for keyword matching ("Gesamtbetrag", "Montant dû"). */
function plain(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function tidy(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** "JOE'S DINER" reads better as "Joe's Diner"; mixed case is left as printed. */
function titleCase(text: string): string {
  const letters = text.replace(/[^\p{L}]/gu, '')
  if (letters.length === 0 || letters !== letters.toUpperCase()) return text
  return text.toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (_, lead: string, ch: string) => {
    return lead + ch.toUpperCase()
  })
}

// Currency -------------------------------------------------------------------------------------

const DOLLARS = new Set(['USD', 'CAD', 'AUD', 'NZD', 'MXN', 'SGD', 'HKD'])
const CODES = /\b(USD|EUR|GBP|CAD|AUD|NZD|CHF|JPY|MXN|BRL|INR|SEK|NOK|DKK|PLN|CZK|SGD|HKD|ZAR)\b/g

function detectCurrency(text: string, fallback: string): string | null {
  const votes = new Map<string, number>()
  const vote = (code: string, n: number) => n && votes.set(code, (votes.get(code) ?? 0) + n)
  const count = (re: RegExp) => (text.match(re) ?? []).length
  vote('EUR', count(/€/g))
  vote('GBP', count(/£/g))
  vote('JPY', count(/[¥￥円]/g))
  vote('INR', count(/₹/g))
  vote('KRW', count(/₩/g))
  vote('BRL', count(/R\$/g))
  const dollars = count(/(?<!R)\$/g)
  vote(DOLLARS.has(fallback.toUpperCase()) ? fallback.toUpperCase() : 'USD', dollars)
  for (const match of text.matchAll(CODES)) vote(match[1]!, 2)
  let best: string | null = null
  for (const [code, n] of votes) if (best === null || n > votes.get(best)!) best = code
  return best
}

// Amounts --------------------------------------------------------------------------------------

/**
 * A printed amount in minor units: "1,234.50", "1.234,50", "1'234.50", "12,5" (one decimal),
 * "1,280" for yen. The last separator is the decimal one unless it is followed by exactly three
 * digits in a currency without three decimals. Null when it is not a usable amount.
 */
export function parseReceiptAmount(raw: string, currency: string): number | null {
  const digits = minorUnits(currency)
  const s = raw.replace(/['\s]/g, '')
  if (!/^\d[\d.,]*$/.test(s)) return null
  const sep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','))
  let whole = s
  let fraction = ''
  if (sep !== -1) {
    const after = s.slice(sep + 1)
    const mark = s[sep]!
    const repeated = s.split(mark).length > 2
    const thousands =
      (after.length === 3 && digits !== 3 && !(s.includes('.') && s.includes(','))) ||
      (repeated && !(s.includes('.') && s.includes(',')))
    if (thousands) {
      whole = s
    } else {
      if (after.length === 0 || after.length > digits) return null
      whole = s.slice(0, sep)
      fraction = after
    }
  }
  whole = whole.replace(/[.,]/g, '')
  if (whole === '') return null
  const value = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')
  return Number.isSafeInteger(value) ? value : null
}

const AMOUNT = String.raw`\d{1,3}(?:[.,']\d{3})+(?:[.,]\d{1,3})?|\d+(?:[.,]\d{1,3})?`
const SYMBOL = String.raw`R\$|[€$£¥￥₹₩]|EUR|USD|GBP|CHF|CAD|AUD|JPY`
const PRICE_AT_END = new RegExp(
  String.raw`(?:^|[\s:=])(-)?\s*(${SYMBOL})?\s*(-)?(${AMOUNT})\s*(${SYMBOL}|円)?\s*(-)?$`,
  'u',
)
/** A mark some tills print after a price: a VAT class letter, "*", a currency code. */
const TRAILING_MARK = /^(?:[A-Z]{1,2}\d?|[*#])$/u

/**
 * The line without the marks after its price. Words in a tidied line are one space apart; going
 * word by word from the end keeps this linear however many marks a misread line has.
 */
function withoutTrailingMarks(line: string): string {
  let end = line.length
  for (let space = line.lastIndexOf(' '); space > 0; space = line.lastIndexOf(' ', end - 1)) {
    if (!TRAILING_MARK.test(line.slice(space + 1, end))) break
    end = space
  }
  return line.slice(0, end)
}

interface Priced {
  cents: number
  negative: boolean
  /** The line without the price. */
  rest: string
}

function trailingPrice(line: string, currency: string): Priced | null {
  const trimmed = withoutTrailingMarks(line)
  const match = PRICE_AT_END.exec(trimmed)
  if (!match) return null
  const [whole, minusBefore, symbolBefore, minusMiddle, token, symbolAfter, minusAfter] = match
  const digits = minorUnits(currency)
  const hasDecimals = new RegExp(String.raw`[.,]\d{${digits}}$`).test(token!)
  if (digits > 0 && !hasDecimals) return null
  if (digits === 0 && !symbolBefore && !symbolAfter && !/[.,']/.test(token!)) return null
  const cents = parseReceiptAmount(token!, currency)
  if (cents === null) return null
  return {
    cents,
    negative: !!(minusBefore || minusMiddle || minusAfter),
    rest: trimmed.slice(0, trimmed.length - whole!.length).trim(),
  }
}

// Line kinds -----------------------------------------------------------------------------------

const SUBTOTAL =
  /\b(sub\s*-?\s*total|subtot|sous\s*-?\s*total|zwischensumme|zw\.?\s*summe|total\s+ht|net\s+total|total\s+parcial|base\s+imponible|netto(betrag)?)\b/
const INCLUSIVE = /\b(incl|inkl|incluse?|incluido|included|ttc|inc)\b/
const TAX =
  /\b(tax|taxes|vat|tva|iva|mwst|mw\.?\s?st|ust|gst|hst|pst|qst|impuesto|imposto|steuer|tasse)\b/
const TIP =
  /\b(tip|tips|gratuity|pourboire|trinkgeld|propina|gorjeta|service\s+charge|servicio|service)\b/
const DISCOUNT =
  /\b(discount|remise|rabatt|descuento|desconto|coupon|savings|you\s+saved|reduction|promo)\b/
const TOTAL =
  /\b(total|totale|totaal|gesamt\w*|summe|betrag|amount\s+due|balance\s+due|to\s+pay|a\s+pagar|zu\s+zahlen|montant|net\s+a\s+payer)\b/
const PAYMENT =
  /\b(cash|change|card|visa|mastercard|master\s*card|amex|maestro|debit|credit|contactless|tendered|tend|payment|paid|paypal|rendu|rendue|monnaie|especes|carte|cb|wechselgeld|ruckgeld|gegeben|geg|karte|kartenzahlung|kontaktlos|girocard|cambio|efectivo|tarjeta|debito|credito|troco|dinheiro|cartao|pix|auth|approval|balance|points|loyalty)\b|^(bar|ec)\b|\bbar\s+(eur|chf)\b/
// Cash handed over and the change given back: together they say what was paid.
const CHANGE_GIVEN = /\b(change|rendu|rendue|monnaie|wechselgeld|ruckgeld|cambio|troco)\b/
const CASH_PAID =
  /\b(cash|tendered|tend|especes|gegeben|geg|efectivo|dinheiro)\b|^bar\b|\bbar\s+(eur|chf)\b/
// What is left on a card, points and approval codes: nothing to do with what this bill came to.
const NOT_PAID =
  /\b(balance|bal|remaining|points|loyalty|auth|approval|solde|saldo|restguthaben|restbetrag)\b/

const NOT_AN_ITEM =
  /\b(tel|phone|fax|www|http|order|table|server|guest|guests|cashier|kasse|receipt|invoice|facture|rechnung|ticket|recibo|qty|items|articles|artikel|anzahl)\b/

/** An amount with two decimals, as tax summary rows print them (not a rate like 8.25%). */
const AMOUNTS = /\d[.,]\d{2}(?![\d%])/g

/**
 * A VAT summary row ("A= 7,0%  7,61  0,52  8,13", "B 19%  5,87  1,12  6,99"): a rate and several
 * amounts, or a class letter and an equals sign. It restates the bill, so it is neither an item
 * nor tax on top.
 */
function isTaxTable(key: string): boolean {
  if (/^[a-z0-9]{1,2}\s*=/.test(key)) return true
  return key.includes('%') && (key.match(AMOUNTS) ?? []).length >= 2
}

type Kind = 'subtotal' | 'tax' | 'tip' | 'discount' | 'total' | 'payment' | 'item' | 'table'

function kindOf(key: string): Kind {
  if (isTaxTable(key)) return 'table'
  if (SUBTOTAL.test(key)) return 'subtotal'
  if (TOTAL.test(key) && INCLUSIVE.test(key)) return 'total'
  if (TAX.test(key)) return 'tax'
  if (TIP.test(key)) return 'tip'
  if (DISCOUNT.test(key)) return 'discount'
  if (TOTAL.test(key)) return 'total'
  if (PAYMENT.test(key)) return 'payment'
  return 'item'
}

// Dates ----------------------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  ene: 1,
  feb: 2,
  fev: 2,
  mar: 3,
  apr: 4,
  avr: 4,
  abr: 4,
  may: 5,
  mai: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  aou: 8,
  ago: 8,
  sep: 9,
  set: 9,
  oct: 10,
  okt: 10,
  out: 10,
  nov: 11,
  dec: 12,
  dez: 12,
  dic: 12,
}

function monthOf(word: string): number | null {
  if (word.startsWith('juin') || word === 'juni') return 6
  if (word.startsWith('juil') || word === 'juli') return 7
  return MONTHS[word.slice(0, 3)] ?? null
}

function isoDay(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  if (day > days) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

function datesIn(key: string, order: 'dmy' | 'mdy'): string[] {
  const found: string[] = []
  const push = (day: string | null) => day && found.push(day)
  for (const m of key.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    push(isoDay(Number(m[1]), Number(m[2]), Number(m[3])))
  }
  for (const m of key.matchAll(/\b(\d{1,2})([-/.])(\d{1,2})\2(\d{4}|\d{2})(?![\d.,])/g)) {
    const a = Number(m[1])
    const b = Number(m[3])
    const year = fullYear(m[4]!)
    const dayFirst = m[2] === '.' || a > 12 || (order === 'dmy' && b <= 12)
    const day = dayFirst ? isoDay(year, b, a) : isoDay(year, a, b)
    // A blurred 0 often reads as 9, 8 or 6: "97/11/2026" was the 7th. Only a day no calendar
    // has gets that second chance.
    const repaired = !day && a > 31 && /^[689]\d$/.test(m[1]!) ? isoDay(year, b, a % 10) : null
    push(day ?? repaired)
  }
  for (const m of key.matchAll(
    /\b(\d{1,2})(?:\.|st|nd|rd|th)?\s*(?:de\s+)?([a-z]{3,10})\.?,?\s*(?:de\s+)?(\d{4}|\d{2})\b/g,
  )) {
    const month = monthOf(m[2]!)
    if (month) push(isoDay(fullYear(m[3]!), month, Number(m[1])))
  }
  for (const m of key.matchAll(/\b([a-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const month = monthOf(m[1]!)
    if (month) push(isoDay(Number(m[3]), month, Number(m[2])))
  }
  return found
}

function findDate(keys: string[], order: 'dmy' | 'mdy', today?: string): string | null {
  const oldest = today ? `${Number(today.slice(0, 4)) - 10}${today.slice(4)}` : null
  for (const key of keys) {
    for (const day of datesIn(key, order)) {
      if (today && (day > today || day < oldest!)) continue
      return day
    }
  }
  return null
}

// Merchant -------------------------------------------------------------------------------------

const NOT_A_NAME =
  /\b(receipt|invoice|facture|rechnung|ticket|recibo|welcome|bienvenue|willkommen|bienvenido|bem-vindo|tel|phone|fax|www|http|vat|tva|siret|siren|ust|nif|cif|cnpj|order|table|server|cashier|kasse|date|time|copy|customer)\b|@|\.com\b/

function findMerchant(lines: string[]): string | null {
  for (const line of lines.slice(0, 6)) {
    const key = plain(line)
    const letters = line.replace(/[^\p{L}]/gu, '').length
    const numbers = line.replace(/\D/g, '').length
    if (letters < 3 || numbers > letters) continue
    if (NOT_A_NAME.test(key) || /^\d+\s+\p{L}/u.test(line)) continue
    if (datesIn(key, 'dmy').length > 0) continue
    const name = titleCase(
      line.replace(/^[^\p{L}\p{N}]+|(?<![^\p{L}\p{N}).!'])[^\p{L}\p{N}).!']+$/gu, '').trim(),
    )
    if (name.length >= 2) return name.slice(0, MERCHANT_MAX).trim()
  }
  return null
}

// Items ----------------------------------------------------------------------------------------

const QTY_FIRST = /^(\d{1,2})\s*[x×*]\s*/i
const QTY_BARE = /^(\d{1,2})\s+(?=\p{L})/u
const QTY_AT_END = new RegExp(
  String.raw`\s*(\d{1,3})\s*[x×@*]\s*(?:${SYMBOL})?\s*(?:${AMOUNT})\s*$`,
  'iu',
)
const QTY_SUFFIX = /(?<!\s)\s+[x×]\s*(\d{1,2})$/i
/**
 * What is left of a unit price line once its price is cut off: "2 Stk x", "3 x", "2 @", "2 un x",
 * "> stk x" (the count lost to the scan). It belongs to the item above it, or the one below.
 */
const QTY_LINE =
  /^[^\p{L}\d]*(\d{1,3})?\s*(?:stk|st|pcs?|pz|ea|un|uds?|und|units?)?\.?\s*[x×@*]\s*$/iu
const UNIT_AT_END = new RegExp(String.raw`\s+@\s*(?:${SYMBOL})?\s*(?:${AMOUNT})\s*$`, 'u')

// A trailing run starts only after a character outside it, so no position is tried twice.
const JUNK_EDGES =
  /^[\s.,:;\-*#|>_~'"`«»[\]){}\\/]+|(?<![\s.,:;\-*#|>_~'"`«»[\]{}\\/])[\s.,:;\-*#|>_~'"`«»[\]{}\\/]+$/g

function itemOf(rest: string): { description: string; quantity: number } {
  let text = rest.replace(/^\d{4,}\s+/, '')
  let quantity = 1
  const atEnd = QTY_AT_END.exec(text)
  if (atEnd) {
    quantity = Number(atEnd[1])
    text = text.slice(0, atEnd.index)
  } else {
    text = text.replace(UNIT_AT_END, '')
  }
  const suffix = QTY_SUFFIX.exec(text)
  if (suffix) {
    quantity = Number(suffix[1])
    text = text.slice(0, suffix.index)
  }
  const first = QTY_FIRST.exec(text) ?? QTY_BARE.exec(text)
  if (first && Number(first[1]) > 0 && Number(first[1]) <= 20) {
    quantity = Number(first[1])
    text = text.slice(first[0].length)
  }
  // Rule lines, table borders and smudges read as "|", ">", "_" or quotes stay off the name.
  const description = titleCase(
    text.replace(JUNK_EDGES, '').replace(/\s+/g, ' ').replace(JUNK_EDGES, ''),
  )
  return {
    description: description.slice(0, ITEM_NAME_MAX).trim(),
    quantity: Math.max(quantity, 1),
  }
}

/**
 * Whether the items, with tax and tip added and the discount taken off, come to the total:
 * `exact`, `close` (within 5% of it), `off`, or null when there is no total or no item. A total
 * worked out without a total line is `unconfirmed` unless the items are far off it. Run again
 * after the person corrects a price.
 */
export function receiptItemsMatch(
  scan: Pick<
    ReceiptScan,
    'totalCents' | 'totalDerived' | 'taxCents' | 'tipCents' | 'discountCents' | 'items'
  >,
): ReceiptScan['itemsMatch'] {
  const total = scan.totalCents
  if (total === null || total <= 0 || scan.items.length === 0) return null
  const sum =
    scan.items.reduce((a, i) => a + i.amountCents, 0) +
    (scan.taxCents ?? 0) +
    (scan.tipCents ?? 0) -
    (scan.discountCents ?? 0)
  const diff = Math.abs(sum - total)
  const match = diff === 0 ? 'exact' : diff * 20 <= total ? 'close' : 'off'
  return scan.totalDerived && match !== 'off' ? 'unconfirmed' : match
}

// The parser -----------------------------------------------------------------------------------

/**
 * Reads OCR text from a receipt into a total, a date, a merchant and line items. Built for the
 * printed till receipts people photograph: US (tax added on top, tip line), UK and Europe (VAT
 * included, decimal comma, "1,99 A" class letters), and yen without decimals. It guesses; the
 * person checks everything in the expense form before saving.
 */
export function parseReceipt(text: string, options: ParseReceiptOptions): ReceiptScan {
  const lines = text
    .split(/\r?\n/)
    .map(tidy)
    .filter((l) => l.length > 0)
  const keys = lines.map(plain)
  const currency = detectCurrency(text, options.currency)
  const readIn = currency ?? options.currency

  let total: number | null = null
  let subtotal: number | null = null
  let tax: number | null = null
  let tip: number | null = null
  let discount: number | null = null
  let itemsEnd = lines.length
  const items: ReceiptItem[] = []
  let pending: string | null = null
  // The line the last item came from, and a unit price line still waiting for its item.
  let lastItemLine = -2
  let pendingQty: { count: number | null; unit: number } | null = null
  // What the card lines say was paid, the cash handed over, and the change given back.
  const paid: number[] = []
  const cash: number[] = []
  const change: number[] = []

  for (const [index, line] of lines.entries()) {
    const key = keys[index]!
    const price = trailingPrice(line, readIn)
    if (!price) {
      // A name on its own line, with "2 x 3,20  6,40" under it.
      pending = /\p{L}{2}/u.test(line) && !NOT_AN_ITEM.test(key) ? line : null
      continue
    }
    const kind = kindOf(key)
    if (kind === 'table') {
      pending = null
      continue
    }
    switch (kind) {
      case 'subtotal':
        subtotal ??= price.cents
        itemsEnd = Math.min(itemsEnd, index)
        break
      case 'total':
        // "Total" then "Total incl. VAT", or a grand total under a total: the biggest wins.
        total = Math.max(total ?? 0, price.cents)
        itemsEnd = Math.min(itemsEnd, index)
        break
      case 'tax':
        tax = (tax ?? 0) + price.cents
        break
      case 'tip':
        tip = (tip ?? 0) + price.cents
        break
      case 'discount':
        discount = (discount ?? 0) + price.cents
        break
      case 'payment':
        if (CHANGE_GIVEN.test(key)) change.push(price.cents)
        else if (CASH_PAID.test(key)) cash.push(price.cents)
        else if (!NOT_PAID.test(key)) paid.push(price.cents)
        itemsEnd = Math.min(itemsEnd, index)
        break
      case 'item': {
        if (index > itemsEnd || NOT_AN_ITEM.test(key)) break
        if (price.negative) {
          discount = (discount ?? 0) + price.cents
          break
        }
        const qty = QTY_LINE.exec(price.rest)
        if (qty) {
          // "2 Stk x 0,90" under "BROETCHEN 1,80": a count for the item above, not an item.
          const count = qty[1] ? Number(qty[1]) : null
          const above = lastItemLine === index - 1 ? items.at(-1) : undefined
          if (above && above.amountCents % price.cents === 0) {
            above.quantity = count ?? above.amountCents / price.cents
          } else {
            pendingQty = { count, unit: price.cents }
          }
          break
        }
        const read = itemOf(price.rest)
        const description =
          !/\p{L}{2}/u.test(read.description) && pending
            ? itemOf(pending).description
            : read.description
        // A unit price line printed above its item ("2 x 0,90" then "BROETCHEN 1,80").
        const quantity =
          pendingQty && price.cents % pendingQty.unit === 0
            ? (pendingQty.count ?? price.cents / pendingQty.unit)
            : read.quantity
        pendingQty = null
        if (/\p{L}{2}/u.test(description) && price.cents > 0) {
          items.push({ description, amountCents: price.cents, quantity })
          lastItemLine = index
        }
        break
      }
    }
    pending = null
  }

  // No total line read: the subtotal, else the items, with nothing added on top. Payment lines
  // never set it; one that says the same amount confirms it (below).
  let totalDerived = total === null
  total ??= subtotal
  // A line dearer than a printed total is a misread (a smudge read as 81.89). A total worked out
  // here cannot tell.
  const offered = items
    .filter((i) => total === null || totalDerived || i.amountCents <= total)
    .slice(0, MAX_RECEIPT_ITEMS)
  const itemsSum = offered.reduce((a, i) => a + i.amountCents, 0)
  if (total === null && offered.length > 0) total = itemsSum
  const base = subtotal ?? itemsSum
  // Tax, tip and discount are kept only when they make the receipt add up the way the expense
  // form adds it (items + tax + tip - discount). VAT already inside the prices is left out.
  if (total !== null && base > 0) {
    const sums = (t: number | null, p: number | null, d: number | null) =>
      base + (t ?? 0) + (p ?? 0) - (d ?? 0) === total
    if (!sums(tax, tip, discount)) {
      if (sums(null, tip, discount)) tax = null
      else if (sums(tax, null, discount)) tip = null
      else if (sums(tax, tip, null)) discount = null
      else if (sums(null, null, discount)) [tax, tip] = [null, null]
      else if (sums(null, null, null)) [tax, tip, discount] = [null, null, null]
    }
  }
  // What was paid: the card lines, and the cash handed over, less the change when there was any.
  const sum = (amounts: number[]) => amounts.reduce((a, c) => a + c, 0)
  if (cash.length > 0) paid.push(...(change.length > 0 ? [sum(cash) - sum(change)] : cash))
  // A total line read a few cents off, while the card line says exactly what the items say: the
  // card line was the bill ("TOTAL $76.59" over "VISA $76.50" on a blurred photo).
  const formSum = itemsSum + (tax ?? 0) + (tip ?? 0) - (discount ?? 0)
  if (!totalDerived && offered.length > 0 && total !== formSum && paid.includes(formSum)) {
    total = formSum
  }
  // A worked-out total that was paid is confirmed.
  if (total !== null && paid.includes(total)) totalDerived = false

  return {
    merchant: findMerchant(lines),
    // A receipt that names its currency says where it was printed, which beats the viewer's
    // own habit for 03/04 (a euro receipt is day first even for someone in the US).
    date: findDate(
      keys,
      currency ? receiptDateOrder(currency) : (options.dateOrder ?? 'dmy'),
      options.today,
    ),
    currency,
    totalCents: total,
    subtotalCents: subtotal,
    taxCents: tax,
    tipCents: tip,
    discountCents: discount,
    items: offered,
    totalDerived: totalDerived && total !== null,
    itemsMatch: receiptItemsMatch({
      totalCents: total,
      totalDerived,
      taxCents: tax,
      tipCents: tip,
      discountCents: discount,
      items: offered,
    }),
  }
}
