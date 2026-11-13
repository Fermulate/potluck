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
}

/** A total line the file carries, to check the rows against. */
export interface SourceTotal {
  line: number
  /** Currency (Splitwise) or group name (Potluck) the total is for. */
  key: string
  nets: number[]
}

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
}

/** YYYY-MM-DD from "2026-03-01" or "2026-03-01 18:30"; null for anything else. */
export function isoDay(text: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T].*)?$/.exec(text.trim())
  if (!match) return null
  const [, y, m, d] = match
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  return date.getUTCMonth() === Number(m) - 1 && date.getUTCDate() === Number(d)
    ? `${y}-${m}-${d}`
    : null
}

export const CURRENCY_CODE = /^[A-Z]{3}$/

/** At most this many rows go to the server in one import (same cap as `import_expenses`). */
export const MAX_IMPORT_ROWS = 5000
