// RFC 5545 text helpers. No Deno APIs, so the tests run under Node too.

/** Escapes a TEXT value. CRLF and bare CR count as line breaks, like LF. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/[,;]/g, (c) => `\\${c}`)
}

const encoder = new TextEncoder()
const LIMIT = 75

/**
 * Folds a content line so no physical line is longer than 75 octets of UTF-8, breaking only
 * between characters (a continuation line starts with one space, which counts toward its 75).
 */
export function fold(line: string): string {
  if (encoder.encode(line).length <= LIMIT) return line
  const out: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const bytes = encoder.encode(char).length
    if (size + bytes > LIMIT) {
      out.push(current)
      current = ' '
      size = 1
    }
    current += char
    size += bytes
  }
  out.push(current)
  return out.join('\r\n')
}
