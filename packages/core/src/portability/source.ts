/**
 * A spreadsheet read for import, before anyone is matched to a group member. Both formats Potluck
 * reads (a Splitwise export and Potluck's own) come out in this shape, so mapping, the preview
 * and the rows sent to `import_expenses` work the same way for each.
 */

/** Why a row (or the file) cannot be imported. Wording lives in i18n `transfer.issues`. */
export type IssueCode =
  | 'not_csv'
  | 'unknown_format'
  | 'no_rows'
  | 'too_many_rows'
  | 'bad_date'
  | 'bad_amount'
  | 'bad_currency'
  | 'unbalanced'
  | 'friend_export'
  | 'unmapped'

export interface SourceIssue {
  /** Row in the file, counting the header as 1. 0 for the file as a whole. */
  line: number
  code: IssueCode
  /** A name, a column value or another detail to show with the message. */
  detail?: string
}

export type EntryKind = 'expense' | 'refund' | 'payment'

/** One expense, refund or payment from the file. Amounts are minor units of `currency`. */
export interface SourceEntry {
  line: number
  kind: EntryKind
  /** Calendar day, YYYY-MM-DD. */
  date: string
  description: string
  /** Potluck category id, or null. */
  category: string | null
  notes: string | null
  /** Positive. */
  amountCents: number
  currency: string
  /** Which group of a several-group Potluck file the row is in; null for Splitwise. */
  group: string | null
  /**
   * Per person (same order as `SourceFile.people`), what they paid and what their share was.
   * Potluck files say both. A refund's are as received and credited (positive).
   */
  paid?: number[]
  shares?: number[]
  /**
   * Splitwise files only say what each row did to each person (paid minus share, positive means
   * they are owed); the payers and split are worked out from it (see `fromNets`).
   */
  nets?: number[]
  /**
   * Potluck files: the rate the row was converted at into `groupCurrency` when it was written
   * (decimal text), so a re-import into a group with that currency converts exactly the same.
   */
  rate?: string | null
  groupCurrency?: string
}

/** A total line the file carries, to check the rows against. */
export interface SourceTotal {
  line: number
  /** Currency (Splitwise) or group name (Potluck) the total is for. */
  key: string
  nets: number[]
}

/** How the dates in a file are written: ISO, month first or day first. */
export type DateFormat = 'iso' | 'mdy' | 'dmy'

export interface SourceFile {
  format: 'splitwise' | 'potluck'
  /** Column names for each person, as the file has them. */
  people: string[]
  entries: SourceEntry[]
  totals: SourceTotal[]
  /** What each row says it does to each person, in the unit `totals` uses, keyed like them. */
  checks: { key: string; nets: number[] }[]
  /** Group names in a Potluck file, in file order. Empty for Splitwise. */
  groups: string[]
  issues: SourceIssue[]
  /** How the dates were read, and whether the file could be read the other way round too. */
  dateFormat: DateFormat
  dateAmbiguous: boolean
}

export interface ReadOptions {
  /** Read slashed dates this way instead of guessing (when the guess was ambiguous). */
  dateFormat?: DateFormat
}

const SLASHED = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T].*)?$/
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/

function validDay(y: number, m: number, d: number): string | null {
  const date = new Date(Date.UTC(y, m - 1, d))
  if (y < 1 || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * YYYY-MM-DD from a file's date cell: ISO ("2026-03-01", "2026-03-01 18:30") always, and with a
 * format, the way spreadsheets save dates ("3/1/26", "01/03/2026", "1.3.2026"). Two digit years
 * are 20xx. Null for anything else, or a day that does not exist.
 */
export function isoDay(text: string, format: DateFormat = 'iso'): string | null {
  const value = text.trim()
  const iso = ISO.exec(value)
  if (iso) return validDay(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  if (format === 'iso') return null
  const slashed = SLASHED.exec(value)
  if (!slashed) return null
  const [a, b] = [Number(slashed[1]), Number(slashed[2])]
  const year = slashed[3]!.length === 2 ? 2000 + Number(slashed[3]) : Number(slashed[3])
  return format === 'mdy' ? validDay(year, a, b) : validDay(year, b, a)
}

/**
 * How a column of dates is written. ISO when every date is; otherwise month first or day first,
 * whichever every date fits (a first number over 12 means day first, a second one over 12 means
 * month first). When both fit, month first is the guess and `ambiguous` says so.
 */
export function detectDateFormat(cells: readonly string[]): {
  format: DateFormat
  ambiguous: boolean
} {
  const values = cells.map((c) => c.trim()).filter((c) => c !== '')
  if (values.every((v) => ISO.test(v))) return { format: 'iso', ambiguous: false }
  const fits = (format: DateFormat) => values.every((v) => isoDay(v, format) !== null)
  const mdy = fits('mdy')
  const dmy = fits('dmy')
  if (mdy && dmy) return { format: 'mdy', ambiguous: true }
  return { format: dmy ? 'dmy' : 'mdy', ambiguous: false }
}

export const CURRENCY_CODE = /^[A-Z]{3}$/

/** At most this many rows go into one import (`import_expenses` takes the same). */
export const MAX_IMPORT_ROWS = 5000

/** A file can bring this many rows; past one import's worth it goes in as several imports. */
export const MAX_FILE_ROWS = 50000
