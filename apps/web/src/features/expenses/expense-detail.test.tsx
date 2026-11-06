import { moneyKeys, type ExpenseComment, type ExpenseWithSplits } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { db, payloadOf, resetDb } from '@/test/supabase'
import { ExpenseDetail } from './expense-detail'
import { BEN, CLEO, GROUP_ID, ME, expense, group, seededClient } from './test-utils'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

const ID = 'e0000000-0000-4000-8000-000000000001'

function renderDetail(
  patch: Partial<ExpenseWithSplits> = {},
  { comments = [] as ExpenseComment[], role = 'member' } = {},
) {
  const client = seededClient((c) => {
    c.setQueryData(moneyKeys.expense(ID), expense({ id: ID, ...patch }))
    c.setQueryData(moneyKeys.comments(ID), comments)
    c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
      ...group,
      members: group.members.map((m) => (m.id === ME ? { ...m, role } : m)),
    })
    c.setQueryData(moneyKeys.expenses(GROUP_ID), [expense({ id: ID, ...patch })])
  })
  return renderWithProviders(
    <>
      <ExpenseDetail expenseId={ID} />
      <Toaster label="Notifications" />
    </>,
    { path: '/expenses/$expenseId', url: `/expenses/${ID}`, client },
  )
}

const comment = (id: string, author_id: string, body: string): ExpenseComment => ({
  id,
  expense_id: ID,
  author_id,
  body,
  created_at: '2026-11-04T19:00:00Z',
})

describe('ExpenseDetail', () => {
  beforeEach(() => {
    resetDb()
  })

  it('shows the amount, who paid and every share', async () => {
    renderDetail({ notes: 'Extra guac', created_by: BEN })
    expect(await screen.findByRole('heading', { name: 'Tacos' })).toBeInTheDocument()
    expect(screen.getByText(t('expenses.detail.youPaid'))).toBeInTheDocument()
    expect(screen.getByText(t('expenses.detail.paidAndOwes', { amount: '$10.00' }))).toBeVisible()
    expect(screen.getAllByText(t('expenses.detail.owes', { amount: '$10.00' }))).toHaveLength(2)
    expect(screen.getByText('Extra guac')).toBeInTheDocument()
    expect(screen.getByText(/^Added by Ben/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Hike crew/ })).toHaveAttribute(
      'href',
      `/groups/${GROUP_ID}`,
    )
    const actions = screen.getByRole('group', { name: t('expenses.detail.actions') })
    expect(within(actions).getByRole('link', { name: t('common.edit') })).toHaveAttribute(
      'href',
      `/expenses/${ID}/edit`,
    )
  })

  it('shows the converted amount and shares for a foreign expense', async () => {
    renderDetail({
      currency: 'EUR',
      fx_rate: 1.1,
      split_type: 'shares',
      expense_splits: [
        { user_id: ME, share_cents: 2000, weight: 2 },
        { user_id: BEN, share_cents: 1000, weight: 1 },
      ],
    })
    expect(
      await screen.findByText(
        t('expenses.detail.converted', { amount: '$33.00', currency: 'USD', rate: '1.1' }),
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/\(2 shares\)/)).toBeInTheDocument()
  })

  it('hides edit and delete from people who neither added nor paid it', async () => {
    renderDetail({ paid_by: BEN, created_by: CLEO })
    expect(await screen.findByText(t('expenses.detail.paidBy', { name: 'Ben' }))).toBeVisible()
    expect(
      screen.queryByRole('group', { name: t('expenses.detail.actions') }),
    ).not.toBeInTheDocument()
  })

  it('deletes after confirming, then goes back to the group with an undo', async () => {
    const { router } = renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: t('common.delete') }))
    const dialog = await screen.findByRole('dialog', { name: t('common.delete') })
    expect(dialog).toHaveTextContent(t('expenses.deleteConfirm', { description: 'Tacos' }))
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.delete') }))

    await waitFor(() => expect(router.state.location.pathname).toBe(`/groups/${GROUP_ID}`))
    expect(db().rpcArgs('delete_expense')).toEqual([{ id: ID }])
  })

  it('offers no delete when someone who left still has money on it, and says why', async () => {
    renderDetail({
      expense_splits: [
        { user_id: ME, share_cents: 1500, weight: null },
        { user_id: 'dddddddd-0000-4000-8000-000000000004', share_cents: 1500, weight: null },
      ],
    })
    expect(await screen.findByText(t('expenses.detail.departedLocked'))).toBeInTheDocument()
    const actions = screen.getByRole('group', { name: t('expenses.detail.actions') })
    expect(within(actions).getByRole('link', { name: t('common.edit') })).toBeInTheDocument()
    expect(within(actions).queryByRole('button', { name: t('common.delete') })).toBeNull()
  })

  it('keeps the expense when deleting is refused', async () => {
    db().respond('rpc:delete_expense', { error: { message: 'not_allowed' } })
    const { router } = renderDetail()
    fireEvent.click(await screen.findByRole('button', { name: t('common.delete') }))
    const dialog = await screen.findByRole('dialog', { name: t('common.delete') })
    fireEvent.click(within(dialog).getByRole('button', { name: t('common.delete') }))
    expect(await screen.findByText(t('expenses.errors.not_allowed'))).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/expenses/${ID}`)
  })

  it('restores a deleted expense', async () => {
    renderDetail({ deleted_at: '2026-11-05T00:00:00Z' })
    expect(await screen.findByRole('status')).toHaveTextContent(t('expenses.detail.deletedBanner'))
    fireEvent.click(screen.getByRole('button', { name: t('expenses.restore') }))
    expect(await screen.findByText(t('expenses.restored'))).toBeInTheDocument()
    expect(db().rpcArgs('restore_expense')).toEqual([{ id: ID }])
  })

  it('reports a failed restore', async () => {
    db().respond('rpc:restore_expense', { error: { message: 'Server error' } })
    renderDetail({ deleted_at: '2026-11-05T00:00:00Z' })
    fireEvent.click(await screen.findByRole('button', { name: t('expenses.restore') }))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
  })

  it('links the receipt, as an image or a PDF', async () => {
    db().respond('storage:receipts.createSignedUrl', {
      data: { signedUrl: 'https://files.test/r.jpg' },
    })
    const first = renderDetail({ receipt_path: `${GROUP_ID}/r.jpg` })
    expect(
      await screen.findByRole('link', { name: t('expenses.receiptUpload.open') }),
    ).toHaveAttribute('href', 'https://files.test/r.jpg')
    first.unmount()

    resetDb()
    db().respond('storage:receipts.createSignedUrl', {
      data: { signedUrl: 'https://files.test/r.pdf' },
    })
    renderDetail({ receipt_path: `${GROUP_ID}/r.PDF` })
    expect(
      await screen.findByRole('link', { name: t('expenses.receiptUpload.pdf') }),
    ).toHaveAttribute('href', 'https://files.test/r.pdf')
  })

  it('says when the expense cannot be found', async () => {
    resetDb({ tables: { expenses: [] } })
    const client = seededClient()
    renderWithProviders(<ExpenseDetail expenseId="missing" />, { client })
    expect(await screen.findByText(t('expenses.detail.notFound'))).toBeInTheDocument()
  })
})

describe('ExpenseComments', () => {
  beforeEach(() => {
    resetDb({ tables: { comments: [] } })
  })

  it('posts a comment with Enter', async () => {
    renderDetail()
    const box = await screen.findByRole('textbox', { name: t('expenses.comments.placeholder') })
    fireEvent.change(box, { target: { value: 'Worth it' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    expect(await screen.findByText('Worth it')).toBeInTheDocument()
    const insert = db()
      .queries('comments')
      .map((call) => payloadOf(call, 'insert'))
      .find(Boolean)
    expect(insert).toEqual({ expense_id: ID, body: 'Worth it' })
  })

  it('leaves Enter alone while an input method is composing', async () => {
    renderDetail()
    const box = await screen.findByRole('textbox', { name: t('expenses.comments.placeholder') })
    fireEvent.change(box, { target: { value: 'かんぱい' } })
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box, { key: 'Enter', keyCode: 229 })
    expect(box).toHaveValue('かんぱい')
    expect(db().queries('comments').some((call) => payloadOf(call, 'insert'))).toBe(false)
  })

  it('gives the text back when posting fails', async () => {
    db().respond('from:comments', { error: { message: 'Server error' } })
    renderDetail()
    const box = await screen.findByRole('textbox', { name: t('expenses.comments.placeholder') })
    fireEvent.change(box, { target: { value: 'Hello' } })
    fireEvent.click(screen.getByRole('button', { name: t('expenses.comments.send') }))
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument()
    await waitFor(() => expect(box).toHaveValue('Hello'))
  })

  it('lets you delete your own comments, and admins anyone', async () => {
    resetDb({
      tables: {
        comments: [{ ...comment('c-1', BEN, 'Ben says hi'), deleted_at: null }],
      },
    })
    const view = renderDetail({}, { comments: [comment('c-1', BEN, 'Ben says hi')] })
    const mine = (await screen.findByText('Ben says hi')).closest('li')!
    expect(within(mine).queryByRole('button', { name: t('common.delete') })).toBeNull()
    view.unmount()

    renderDetail(
      { paid_by: BEN, created_by: BEN },
      { comments: [comment('c-1', BEN, 'Ben says hi')], role: 'admin' },
    )
    const thread = (await screen.findByRole('heading', { name: /Comments/ })).closest('section')!
    fireEvent.click(within(thread).getByRole('button', { name: t('common.delete') }))
    expect(await screen.findByText(t('expenses.comments.deleted'))).toBeInTheDocument()
    const update = db()
      .queries('comments')
      .find((call) => payloadOf(call, 'update'))
    expect(update?.ops).toContainEqual({ method: 'eq', args: ['id', 'c-1'] })
  })
})
