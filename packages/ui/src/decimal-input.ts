/**
 * Typed decimal text <-> integer units (cents, basis points), following the locale's decimal
 * mark. Every money and percent field goes through these so "12,50" reads the same everywhere.
 */

function separators(locale?: string): { decimal: string; group: string | undefined } {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5)
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value,
  }
}

/**
 * Rewrites typed text so "." is the only decimal mark. When the locale
 * separator is present, grouping is dropped and the separator becomes ".";
 * otherwise a typed "." already means the decimal point.
 */
function toPlainDecimal(text: string, locale?: string): string {
  const { decimal, group } = separators(locale)
  if (!text.includes(decimal)) return text
  return (group ? text.split(group).join('') : text).replace(decimal, '.')
}

/**
 * Parses typed text into an integer count of `10^-digits` units (cents for 2 digits). Accepts
 * "." or the locale separator, ignores grouping, and drops decimals past `digits`. Returns null
 * for empty input.
 */
export function parseDecimalInput(text: string, digits: number, locale?: string): number | null {
  const normalized = toPlainDecimal(text, locale).replace(/[^\d.]/g, '')
  if (normalized === '' || normalized === '.') return null
  const [whole = '0', fraction = ''] = normalized.split('.')
  const frac = fraction.slice(0, digits).padEnd(digits, '0')
  return Number(whole || '0') * 10 ** digits + Number(frac || '0')
}

/** Editable text for `units` (no grouping, locale decimal mark, no trailing ".00"). */
export function formatDecimalInput(units: number | null, digits: number, locale?: string): string {
  if (units === null) return ''
  const scale = 10 ** digits
  const whole = Math.floor(units / scale)
  const frac = units % scale
  if (digits === 0 || frac === 0) return String(whole)
  return `${whole}${separators(locale).decimal}${String(frac).padStart(digits, '0')}`
}

/** Keeps only digits and a single locale separator, with at most `digits` decimals. */
export function sanitizeDecimalInput(raw: string, digits: number, locale?: string): string {
  const sep = separators(locale).decimal
  let out = ''
  let seenSep = false
  let fraction = 0
  for (const ch of toPlainDecimal(raw, locale)) {
    if (ch >= '0' && ch <= '9') {
      if (seenSep) {
        if (fraction >= digits) continue
        fraction++
      }
      out += ch
    } else if (ch === '.' && !seenSep && digits > 0) {
      seenSep = true
      out += out === '' ? `0${sep}` : sep
    }
  }
  // No leading zeros like "007".
  return out.replace(/^0+(?=\d)/, '')
}
