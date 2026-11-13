/**
 * Export, backup and import. Platform-neutral: no DOM imports. Reading and writing files is the
 * app's job; these only talk to the database.
 */
import { backupSchema, MAX_IMPORT_ROWS, type Backup, type ImportRow } from '@potluck/core'
import { queryOptions } from '@tanstack/react-query'
import type { Json } from './database.types'
import type { PotluckClient } from './index'
import { fetchAllPages } from './paging'

export type ImportSource = 'splitwise' | 'potluck' | 'csv'

export interface ImportResult {
  expenses: number
  payments: number
}

/** Rows sent in one request; a larger import is sent ahead in parts (`import_stage`). */
export const IMPORT_PART_ROWS = 2000

export interface ImportOptions {
  /** Remembered on the activity entry, so the same file is recognised next time. */
  fingerprint?: string
  /** Called after each request with how many rows have gone so far. */
  onProgress?: (sent: number, total: number) => void
  /** Ids for staged imports (tests pass their own). */
  newId?: () => string
}

/**
 * What a failed import throws: the database error (its code in `message`), with `hint` naming the
 * row of the whole file (`import_row:<n>`, from 1), and what earlier imports of a long file wrote.
 */
export interface ImportFailure {
  message: string
  code?: string
  details?: string
  hint?: string | null
  /** Rows of a long file that went in before the failing import (each import is all or nothing). */
  imported: ImportResult
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

function counts(data: unknown): ImportResult {
  const c = data as { expenses?: unknown; payments?: unknown } | null
  return {
    expenses: typeof c?.expenses === 'number' ? c.expenses : 0,
    payments: typeof c?.payments === 'number' ? c.payments : 0,
  }
}

/**
 * Writes the rows into the group. Up to 5,000 rows are one all or nothing import: sent in one
 * request, or ahead in parts of 2,000 (`import_stage`) and written by the last request. A longer
 * file goes in as several such imports, one after the other; if one fails, the ones before it
 * stay and the error says how much went in.
 */
export async function importExpenses(
  client: PotluckClient,
  groupId: string,
  rows: readonly ImportRow[],
  source: ImportSource,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const total: ImportResult = { expenses: 0, payments: 0 }
  const newId =
    options.newId ??
    (() => (globalThis as unknown as { crypto: { randomUUID(): string } }).crypto.randomUUID())
  let sent = 0
  for (let offset = 0; offset < rows.length; offset += MAX_IMPORT_ROWS) {
    const part = rows.slice(offset, offset + MAX_IMPORT_ROWS)
    try {
      let batchId: string | undefined
      let last = part
      if (part.length > IMPORT_PART_ROWS) {
        const id = newId()
        batchId = id
        while (last.length > IMPORT_PART_ROWS) {
          unwrap(
            await client.rpc('import_stage', {
              batch_id: id,
              group_id: groupId,
              rows: last.slice(0, IMPORT_PART_ROWS) as unknown as Json,
            }),
          )
          last = last.slice(IMPORT_PART_ROWS)
          sent += IMPORT_PART_ROWS
          options.onProgress?.(sent, rows.length)
        }
      }
      const result = counts(
        unwrap(
          await client.rpc('import_expenses', {
            group_id: groupId,
            rows: last as unknown as Json,
            source,
            ...(batchId ? { batch_id: batchId } : {}),
            ...(options.fingerprint ? { fingerprint: options.fingerprint } : {}),
          }),
        ),
      )
      sent += last.length
      options.onProgress?.(sent, rows.length)
      total.expenses += result.expenses
      total.payments += result.payments
    } catch (error) {
      const e = (error ?? {}) as Partial<ImportFailure>
      const row = typeof e.hint === 'string' ? /^import_row:(\d+)$/.exec(e.hint) : null
      const failure: ImportFailure = {
        message: typeof e.message === 'string' ? e.message : String(error),
        code: e.code,
        details: e.details,
        hint: row ? `import_row:${offset + Number(row[1])}` : (e.hint ?? null),
        imported: { ...total },
      }
      throw failure
    }
  }
  return total
}

/** The viewer's whole account (`export_my_data`), checked against the version 1 format. */
export async function exportMyData(client: PotluckClient): Promise<Backup> {
  return backupSchema.parse(unwrap(await client.rpc('export_my_data')))
}

/** Every stored rate from `from` into `to` (and the inverse pair) up to `until`, newest first. */
export interface FxHistory {
  direct: { day: string; rate: string }[]
  inverse: { day: string; rate: string }[]
}

export async function fetchFxHistory(
  client: PotluckClient,
  from: string,
  to: string,
  until: string,
): Promise<FxHistory> {
  const pair = (base: string, quote: string) =>
    fetchAllPages((start, end) =>
      client
        .from('fx_rates')
        .select('day, rate::text')
        .eq('base', base)
        .eq('quote', quote)
        .lte('day', until)
        .order('day', { ascending: false })
        .range(start, end),
    )
  const [direct, inverse] = await Promise.all([pair(from, to), pair(to, from)])
  return { direct, inverse }
}

/** An earlier import into a group (its `expenses.imported` activity entry). */
export interface PastImport {
  at: string
  actorId: string | null
  fingerprint: string | null
  expenses: number
  payments: number
}

export async function fetchPastImports(
  client: PotluckClient,
  groupId: string,
): Promise<PastImport[]> {
  const rows = unwrap(
    await client
      .from('activity')
      .select('actor_id, data, created_at')
      .eq('group_id', groupId)
      .eq('verb', 'expenses.imported')
      .order('created_at', { ascending: false }),
  )
  return rows.map((r) => {
    const d = (r.data ?? {}) as Record<string, unknown>
    return {
      at: r.created_at,
      actorId: r.actor_id,
      fingerprint: typeof d.fingerprint === 'string' ? d.fingerprint : null,
      expenses: typeof d.expenses === 'number' ? d.expenses : 0,
      payments: typeof d.payments === 'number' ? d.payments : 0,
    }
  })
}

export const transferKeys = {
  fx: (from: string, to: string, until: string) =>
    ['potluck', 'money', 'fx-history', from, to, until] as const,
  imports: (groupId: string) => ['potluck', 'money', 'group', groupId, 'imports'] as const,
}

export const transferQueries = {
  fxHistory: (client: PotluckClient, from: string, to: string, until: string) =>
    queryOptions({
      queryKey: transferKeys.fx(from, to, until),
      queryFn: () => fetchFxHistory(client, from, to, until),
      staleTime: 60 * 60 * 1000,
    }),
  pastImports: (client: PotluckClient, groupId: string) =>
    queryOptions({
      queryKey: transferKeys.imports(groupId),
      queryFn: () => fetchPastImports(client, groupId),
    }),
}
