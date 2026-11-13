/**
 * Export, backup and import. Platform-neutral: no DOM imports. Reading and writing files is the
 * app's job; these only talk to the database.
 */
import { backupSchema, type Backup, type ImportRow } from '@potluck/core'
import type { Json } from './database.types'
import type { PotluckClient } from './index'

export type ImportSource = 'splitwise' | 'potluck' | 'csv'

export interface ImportResult {
  expenses: number
  payments: number
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

/**
 * Writes every row into the group in one transaction (`import_expenses`): all of them or, if
 * any row fails, none. The error's `hint` is `import_row:<n>` for the row that failed (from 1).
 */
export async function importExpenses(
  client: PotluckClient,
  groupId: string,
  rows: readonly ImportRow[],
  source: ImportSource,
): Promise<ImportResult> {
  const result = unwrap(
    await client.rpc('import_expenses', {
      group_id: groupId,
      rows: rows as unknown as Json,
      source,
    }),
  )
  const counts = result as { expenses?: unknown; payments?: unknown } | null
  return {
    expenses: typeof counts?.expenses === 'number' ? counts.expenses : 0,
    payments: typeof counts?.payments === 'number' ? counts.payments : 0,
  }
}

/** The viewer's whole account (`export_my_data`), checked against the version 1 format. */
export async function exportMyData(client: PotluckClient): Promise<Backup> {
  return backupSchema.parse(unwrap(await client.rpc('export_my_data')))
}
