/**
 * Expense attachments: receipts, photos and PDFs in the private `receipts` bucket, up to five per
 * expense (ADR 21). Platform-neutral: no DOM imports.
 */
import { queryOptions } from '@tanstack/react-query'
import type { Database, Json } from './database.types'
import type { PotluckClient } from './index'
import { moneyKeys, type ExpensePayload, type ExpenseRow } from './money'

/** One file on an expense, in order; the first is also `expenses.receipt_path`. */
export type ExpenseAttachment = Pick<
  Database['public']['Tables']['expense_attachments']['Row'],
  'expense_id' | 'position' | 'path' | 'content_type' | 'uploaded_by' | 'created_at'
>

/** How many files one expense holds (the database refuses a sixth). */
export const MAX_ATTACHMENTS = 5

export const attachmentKeys = {
  /** Under the expense key, so anything that refreshes the expense refreshes its files. */
  list: (expenseId: string) => [...moneyKeys.expense(expenseId), 'attachments'] as const,
}

function unwrap<T>(result: { data: T | null; error: unknown }): T {
  if (result.error) throw result.error
  return result.data as T
}

export async function fetchExpenseAttachments(
  client: PotluckClient,
  expenseId: string,
): Promise<ExpenseAttachment[]> {
  return unwrap(
    await client
      .from('expense_attachments')
      .select('expense_id, position, path, content_type, uploaded_by, created_at')
      .eq('expense_id', expenseId)
      .order('position'),
  )
}

/**
 * Replaces an expense's attachments with `paths`, in order. The files must already be uploaded
 * under the group folder (`uploadReceipt`).
 */
export async function setExpenseAttachments(
  client: PotluckClient,
  expenseId: string,
  paths: string[],
): Promise<ExpenseAttachment[]> {
  return unwrap(await client.rpc('set_expense_attachments', { id: expenseId, attachments: paths }))
}

/**
 * Creates an expense with its files in one call (`paths` already uploaded, in order), so its
 * history has one entry and a refused file means nothing is created.
 */
export async function createExpenseWithAttachments(
  client: PotluckClient,
  payload: ExpensePayload,
  paths: string[],
): Promise<ExpenseRow> {
  return unwrap(
    await client.rpc('create_expense_with_attachments', {
      payload: payload as unknown as Json,
      attachments: paths,
    }),
  )
}

/**
 * Deletes files that are no longer on any expense. The bucket lets the uploader or a group admin
 * delete; anything else stays put, so this never throws.
 */
export async function removeReceiptFiles(client: PotluckClient, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  try {
    await client.storage.from('receipts').remove(paths)
  } catch {
    // A leftover file costs storage, not correctness.
  }
}

export const attachmentQueries = {
  list: (client: PotluckClient, expenseId: string) =>
    queryOptions({
      queryKey: attachmentKeys.list(expenseId),
      queryFn: () => fetchExpenseAttachments(client, expenseId),
    }),
}
