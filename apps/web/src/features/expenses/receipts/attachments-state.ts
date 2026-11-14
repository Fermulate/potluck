import {
  MAX_ATTACHMENTS,
  removeReceiptFiles,
  setExpenseAttachments,
  uploadReceipt,
  type ExpenseAttachment,
  type PotluckClient,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { receiptExtension, receiptType } from '../form/receipt'

/** One file in the form: already stored (`path`) or picked and waiting to upload (`file`). */
export type AttachmentDraft =
  | { key: string; path: string; contentType: string; file?: undefined }
  | { key: string; file: File; contentType: string; path?: undefined }

let seq = 0
const nextKey = () => `attachment-${(seq += 1)}`

export function draftsFromStored(stored: readonly ExpenseAttachment[]): AttachmentDraft[] {
  return [...stored]
    .sort((a, b) => a.position - b.position)
    .map((a) => ({ key: a.path, path: a.path, contentType: a.content_type }))
}

/** A picked file as a draft, or null when receipts cannot take its type. */
export function draftFromFile(file: File): AttachmentDraft | null {
  const contentType = receiptType(file)
  return contentType ? { key: nextKey(), file, contentType } : null
}

export const isPdf = (draft: Pick<AttachmentDraft, 'contentType'>) =>
  draft.contentType === 'application/pdf'

/** A label for the nth file: "Photo 2", "PDF 1". */
export function attachmentName(draft: Pick<AttachmentDraft, 'contentType'>, index: number) {
  return isPdf(draft)
    ? t('expenses.attachments.pdf', { number: index + 1 })
    : t('expenses.attachments.photo', { number: index + 1 })
}

/** Adds picked files after the current ones, up to the limit. `leftOut` counts what did not fit. */
export function addDrafts(
  current: readonly AttachmentDraft[],
  added: readonly AttachmentDraft[],
): { drafts: AttachmentDraft[]; leftOut: number } {
  const room = Math.max(0, MAX_ATTACHMENTS - current.length)
  return {
    drafts: [...current, ...added.slice(0, room)],
    leftOut: Math.max(0, added.length - room),
  }
}

/** Whether the list differs from what is stored (new files, removals or a new order). */
export function attachmentsChanged(
  drafts: readonly AttachmentDraft[],
  stored: readonly ExpenseAttachment[],
): boolean {
  const before = draftsFromStored(stored).map((d) => d.path)
  return drafts.length !== before.length || drafts.some((d, i) => d.path !== before[i])
}

/**
 * Uploads the new files and returns every path, in the form's order. `uploaded` remembers what
 * already went up (draft key to path), so a retry after a failed save sends nothing twice; the
 * form deletes whatever is left in it when it closes without saving.
 */
export async function uploadDrafts(
  client: PotluckClient,
  groupId: string,
  drafts: readonly AttachmentDraft[],
  uploaded: Map<string, string> = new Map(),
): Promise<string[]> {
  return Promise.all(
    drafts.map(async (d) => {
      if (d.path !== undefined) return d.path
      const done = uploaded.get(d.key)
      if (done) return done
      const path = await uploadReceipt(client, groupId, d.file, {
        extension: receiptExtension(d.file),
        contentType: d.contentType,
      })
      uploaded.set(d.key, path)
      return path
    }),
  )
}

/**
 * Saves the list on an expense and deletes the files that left it. Deleting is best effort: the
 * bucket lets only the uploader or an admin remove a file.
 */
export async function saveAttachments(
  client: PotluckClient,
  expenseId: string,
  paths: string[],
  stored: readonly ExpenseAttachment[],
): Promise<void> {
  await setExpenseAttachments(client, expenseId, paths)
  await removeReceiptFiles(
    client,
    stored.map((a) => a.path).filter((p) => !paths.includes(p)),
  )
}
