import { parseCsv } from './csv'
import { looksLikeLedger, parseLedger, type LedgerLabels } from './ledger'
import type { SourceFile } from './source'
import { looksLikeSplitwise, parseSplitwise } from './splitwise'

/**
 * Read an import file: Potluck's own export (in any of `labelSets`) or a Splitwise export.
 * Anything else comes back with an `unknown_format` issue. Pure and synchronous, so the web app
 * can run it in a worker for large files.
 */
export function readImportFile(text: string, labelSets: readonly LedgerLabels[]): SourceFile {
  const empty = (code: 'not_csv' | 'unknown_format'): SourceFile => ({
    format: 'splitwise',
    people: [],
    entries: [],
    totals: [],
    checks: [],
    groups: [],
    issues: [{ line: 0, code }],
  })
  // Binary files (a spreadsheet saved as .xlsx, an image) have NUL bytes; text never does.
  if (text.includes('\u0000')) return empty('not_csv')
  const rows = parseCsv(text)
  if (looksLikeLedger(rows, labelSets)) return parseLedger(rows, labelSets)
  if (looksLikeSplitwise(rows)) return parseSplitwise(rows)
  return empty('unknown_format')
}
