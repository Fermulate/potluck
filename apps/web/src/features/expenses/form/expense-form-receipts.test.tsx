import type * as Api from '@potluck/api'
import {
  attachmentKeys,
  createExpense,
  createExpenseWithAttachments,
  removeReceiptFiles,
  setExpenseAttachments,
  updateExpense,
  uploadReceipt,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Ocr from '../receipts/ocr'
import { BEN, CLEO, GROUP_ID, ME, expense, renderWithClient, seededClient } from '../test-utils'
import { ExpenseForm } from './expense-form'

vi.mock('@/lib/supabase', () => import('../fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => {
  let n = 0
  return {
    ...(await importOriginal<typeof Api>()),
    createExpense: vi.fn(async () => ({ id: 'new-expense' })),
    createExpenseWithAttachments: vi.fn(async () => ({ id: 'new-expense' })),
    updateExpense: vi.fn(async (_c: unknown, id: string) => ({ id })),
    uploadReceipt: vi.fn(async (_c: unknown, groupId: string) => `${groupId}/up-${(n += 1)}.jpg`),
    setExpenseAttachments: vi.fn(async () => []),
    removeReceiptFiles: vi.fn(async () => undefined),
  }
})
vi.mock('../receipts/ocr', async (original) => ({
  ...(await original<typeof Ocr>()),
  readReceiptText: vi.fn(async () => [
    `TAQUERIA SOL
11/08/2026
Tacos al pastor   12.00
Horchata           4.00
TOTAL             16.00`,
  ]),
}))

const photo = (name = 'p.jpg') => new File(['jpg'], name, { type: 'image/jpeg' })
const addFiles = async (files: File[]) => {
  const input = screen.getByLabelText(t('expenses.attachments.label'), { selector: 'input' })
  await act(async () => {
    fireEvent.change(input, { target: { files } })
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = vi.fn(() => 'blob:photo')
  URL.revokeObjectURL = vi.fn()
})

describe('expense form files', () => {
  it('uploads every file and creates the expense with them in one call', async () => {
    const onDone = vi.fn()
    renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={onDone} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '20' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
      target: { value: 'Lunch' },
    })
    await addFiles([photo('a.jpg'), photo('b.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-expense'))
    expect(vi.mocked(uploadReceipt)).toHaveBeenCalledTimes(2)
    const [, , paths] = vi.mocked(createExpenseWithAttachments).mock.calls[0]!
    expect(paths).toEqual([`${GROUP_ID}/up-1.jpg`, `${GROUP_ID}/up-2.jpg`])
    expect(vi.mocked(createExpense)).not.toHaveBeenCalled()
    expect(vi.mocked(setExpenseAttachments)).not.toHaveBeenCalled()
  })

  it('creates an expense without files the plain way', async () => {
    const onDone = vi.fn()
    renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={onDone} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '20' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
      target: { value: 'Lunch' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(vi.mocked(createExpense).mock.calls[0]![1].receipt_path).toBeNull()
    expect(vi.mocked(createExpenseWithAttachments)).not.toHaveBeenCalled()
    expect(vi.mocked(uploadReceipt)).not.toHaveBeenCalled()
  })

  it('removes a stored file on edit without resending the expense receipt', async () => {
    const saved = expense({ id: 'e1', receipt_path: `${GROUP_ID}/a.jpg` })
    const stored = ['a.jpg', 'b.pdf'].map((name, position) => ({
      expense_id: 'e1',
      position,
      path: `${GROUP_ID}/${name}`,
      content_type: name.endsWith('pdf') ? 'application/pdf' : 'image/jpeg',
      uploaded_by: ME,
      created_at: '2026-11-01T00:00:00Z',
    }))
    const onDone = vi.fn()
    renderWithClient(
      <ExpenseForm mode="edit" expense={saved} onDone={onDone} onClose={() => {}} />,
      seededClient((c) => c.setQueryData(attachmentKeys.list('e1'), stored)),
    )
    const first = t('expenses.attachments.photo', { number: 1 })
    fireEvent.click(
      await screen.findByRole('button', {
        name: t('expenses.attachments.remove', { name: first }),
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('e1'))
    expect(vi.mocked(updateExpense).mock.calls[0]![2]).not.toHaveProperty('receipt_path')
    expect(vi.mocked(setExpenseAttachments)).toHaveBeenCalledWith(expect.anything(), 'e1', [
      `${GROUP_ID}/b.pdf`,
    ])
    expect(vi.mocked(removeReceiptFiles)).toHaveBeenCalledWith(expect.anything(), [
      `${GROUP_ID}/a.jpg`,
    ])
  })

  it('leaves files alone on an edit that does not touch them', async () => {
    const saved = expense({ id: 'e2' })
    const onDone = vi.fn()
    renderWithClient(
      <ExpenseForm mode="edit" expense={saved} onDone={onDone} onClose={() => {}} />,
      seededClient((c) => c.setQueryData(attachmentKeys.list('e2'), [])),
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
      target: { value: 'Renamed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('e2'))
    expect(vi.mocked(setExpenseAttachments)).not.toHaveBeenCalled()
  })

  it('reuses uploads when a failed save is retried, and deletes them if the form closes', async () => {
    vi.mocked(createExpenseWithAttachments).mockRejectedValueOnce({
      message: 'fx_rate_unavailable',
    })
    const onDone = vi.fn()
    const view = renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={onDone} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '20' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
      target: { value: 'Lunch' },
    })
    await addFiles([photo('a.jpg'), photo('b.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(vi.mocked(createExpenseWithAttachments)).toHaveBeenCalledTimes(1))
    expect(vi.mocked(uploadReceipt)).toHaveBeenCalledTimes(2)

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('new-expense'))
    expect(vi.mocked(uploadReceipt)).toHaveBeenCalledTimes(2)
    const [first, second] = vi.mocked(createExpenseWithAttachments).mock.calls
    expect(second![2]).toEqual(first![2])
    view.unmount()
    expect(vi.mocked(removeReceiptFiles)).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([first![2][0]]),
    )
  })

  it('deletes uploads for a save that never went through when the form closes', async () => {
    vi.mocked(createExpenseWithAttachments).mockRejectedValueOnce({
      message: 'fx_rate_unavailable',
    })
    const view = renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={() => {}} onClose={() => {}} />,
    )
    fireEvent.change(screen.getByRole('textbox', { name: 'Amount' }), { target: { value: '20' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'What was it?' }), {
      target: { value: 'Lunch' },
    })
    await addFiles([photo('a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(vi.mocked(createExpenseWithAttachments)).toHaveBeenCalledTimes(1))
    const paths = vi.mocked(createExpenseWithAttachments).mock.calls[0]![2]
    view.unmount()
    expect(vi.mocked(removeReceiptFiles)).toHaveBeenCalledWith(expect.anything(), paths)
  })

  it('tells the person when an edit saved but its files did not, and drops the new upload', async () => {
    vi.mocked(setExpenseAttachments).mockRejectedValueOnce({ message: 'attachment_not_found' })
    const onDone = vi.fn()
    renderWithClient(
      <ExpenseForm
        mode="edit"
        expense={expense({ id: 'e3' })}
        onDone={onDone}
        onClose={() => {}}
      />,
      seededClient((c) => c.setQueryData(attachmentKeys.list('e3'), [])),
    )
    await addFiles([photo('a.jpg')])
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('e3'))
    const [path] = vi.mocked(uploadReceipt).mock.results.map((r) => r.value as Promise<string>)
    expect(vi.mocked(removeReceiptFiles)).toHaveBeenCalledWith(expect.anything(), [await path])
  })

  it('fills the form from a scanned receipt, split by item, and saves only when asked', async () => {
    const onDone = vi.fn()
    renderWithClient(
      <ExpenseForm mode="create" groupId={GROUP_ID} onDone={onDone} onClose={() => {}} />,
    )
    const input = document.querySelector('input[type=file][accept="image/*"]') as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { files: [photo('scan.jpg')] } })
    })
    const sheet = await screen.findByRole('dialog', { name: t('expenses.scan.reviewTitle') })
    fireEvent.click(within(sheet).getByRole('button', { name: t('expenses.scan.apply') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(vi.mocked(createExpenseWithAttachments)).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'What was it?' })).toHaveValue('Taqueria Sol')
    expect(screen.getByDisplayValue('2026-11-08')).toBeInTheDocument()
    expect(
      screen
        .getAllByRole('textbox', { name: t('expenses.itemized.itemName') })
        .map((i) => (i as HTMLInputElement).value),
    ).toEqual(['Tacos al pastor', 'Horchata'])
    expect(
      screen.getByRole('img', { name: t('expenses.attachments.photo', { number: 1 }) }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    const payload = vi.mocked(createExpenseWithAttachments).mock.calls[0]![1]
    expect(payload).toMatchObject({
      description: 'Taqueria Sol',
      amount_cents: 1600,
      split_type: 'itemized',
      spent_at: '2026-11-08',
    })
    expect(payload.items).toEqual([
      { description: 'Tacos al pastor', amount_cents: 1200, user_ids: [ME, BEN, CLEO] },
      { description: 'Horchata', amount_cents: 400, user_ids: [ME, BEN, CLEO] },
    ])
  })
})
