/** A value for one spreadsheet cell. */
export type CsvValue = string | number | null | undefined

/** Leading characters that make Excel, Sheets or LibreOffice treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/

/**
 * One CSV cell. Text that a spreadsheet would run as a formula gets a leading apostrophe (a
 * plain negative number is left alone); anything with a separator, quote or line break is
 * quoted.
 */
export function csvCell(value: CsvValue): string {
  const text = value == null ? '' : String(value)
  const safe = FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text
  return /[",;\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

/** Undo `csvCell`'s formula guard on text read back from a file this app wrote. */
export function unguardCell(text: string): string {
  return /^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text
}

/** Rows to CSV text: comma separated, CRLF line ends (RFC 4180), with a final line end. */
export function toCsv(rows: readonly (readonly CsvValue[])[]): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** The separator a file uses: whichever of comma, semicolon or tab its first line has most of. */
function detectDelimiter(text: string): string {
  const counts = new Map([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ])
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c === '"') quoted = !quoted
    else if (!quoted && (c === '\n' || c === '\r')) break
    else if (!quoted && counts.has(c)) counts.set(c, counts.get(c)! + 1)
  }
  let best = ','
  for (const [d, n] of counts) if (n > counts.get(best)!) best = d
  return best
}

/**
 * Parse CSV text into rows of cells (RFC 4180: quoted cells may hold separators, doubled quotes
 * and line breaks). Handles a byte order mark, CRLF, LF or CR line ends, and comma, semicolon
 * or tab separators (spreadsheets in many locales save with semicolons). Blank lines come back
 * as rows with one empty cell, so row numbers stay true to the file.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const n = text.length

  while (i < n) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      // Copy a run of ordinary characters at once: large files stay fast.
      const next = text.indexOf('"', i)
      const end = next === -1 ? n : next
      cell += text.slice(i, end)
      i = end
      continue
    }
    if (c === '"' && cell === '') {
      quoted = true
      i++
    } else if (c === delimiter) {
      row.push(cell)
      cell = ''
      i++
    } else if (c === '\r' || c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      i += c === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      cell += c
      i++
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

/** A row with nothing in it (every cell blank). */
export function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => cell.trim() === '')
}
