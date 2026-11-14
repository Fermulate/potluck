import { describe, expect, it } from 'vitest'
import {
  createExpenseWithAttachments,
  attachmentKeys,
  attachmentQueries,
  fetchExpenseAttachments,
  removeReceiptFiles,
  setExpenseAttachments,
} from './attachments'
import { moneyKeys } from './money'
import { argsOf, fakeSupabase } from './testing/fake-supabase'

const row = (position: number, path: string) => ({
  expense_id: 'e1',
  position,
  path,
  content_type: 'image/jpeg',
  uploaded_by: 'u1',
  created_at: '2026-11-13T10:00:00Z',
})

describe('expense attachments', () => {
  it("reads one expense's files in order", async () => {
    const fake = fakeSupabase({
      tables: { expense_attachments: [row(1, 'g1/b.jpg'), row(0, 'g1/a.jpg')] },
    })
    const files = await fetchExpenseAttachments(fake.client, 'e1')
    expect(files.map((f) => f.path)).toEqual(['g1/a.jpg', 'g1/b.jpg'])
    const [query] = fake.queries('expense_attachments')
    expect(argsOf(query!, 'eq')).toEqual([['expense_id', 'e1']])
  })

  it('sets the list through set_expense_attachments', async () => {
    const fake = fakeSupabase().respond('rpc:set_expense_attachments', {
      data: [row(0, 'g1/a.jpg')],
    })
    expect(await setExpenseAttachments(fake.client, 'e1', ['g1/a.jpg'])).toHaveLength(1)
    expect(fake.rpcArgs('set_expense_attachments')).toEqual([
      { id: 'e1', attachments: ['g1/a.jpg'] },
    ])

    const failing = fakeSupabase().respond('rpc:set_expense_attachments', {
      error: { message: 'too_many_attachments' },
    })
    await expect(setExpenseAttachments(failing.client, 'e1', [])).rejects.toEqual({
      message: 'too_many_attachments',
    })
  })

  it('creates an expense with its files in one call', async () => {
    const fake = fakeSupabase().respond('rpc:create_expense_with_attachments', {
      data: { id: 'e1' },
    })
    const payload = {
      group_id: 'g1',
      description: 'Lunch',
      amount_cents: 2000,
      currency: 'USD',
      paid_by: 'u1',
      split_type: 'equal' as const,
      splits: [{ user_id: 'u1' }],
      spent_at: '2026-11-13',
    }
    expect(await createExpenseWithAttachments(fake.client, payload, ['g1/a.jpg'])).toEqual({
      id: 'e1',
    })
    expect(fake.rpcArgs('create_expense_with_attachments')).toEqual([
      { payload, attachments: ['g1/a.jpg'] },
    ])
  })

  it('removes files quietly, and skips the call when there is nothing to remove', async () => {
    const fake = fakeSupabase()
    await removeReceiptFiles(fake.client, [])
    expect(fake.storageCalls('receipts')).toHaveLength(0)
    await removeReceiptFiles(fake.client, ['g1/a.jpg'])
    expect(fake.storageCalls('receipts')[0]).toMatchObject({
      method: 'remove',
      args: [['g1/a.jpg']],
    })

    const offline = fakeSupabase().respond('storage:receipts.remove', () => {
      throw new Error('offline')
    })
    await expect(removeReceiptFiles(offline.client, ['g1/a.jpg'])).resolves.toBeUndefined()
  })

  it('keeps the list under the expense key', () => {
    expect(attachmentKeys.list('e1').slice(0, 4)).toEqual([...moneyKeys.expense('e1')])
    expect(attachmentQueries.list(fakeSupabase().client, 'e1').queryKey).toEqual(
      attachmentKeys.list('e1'),
    )
  })
})
