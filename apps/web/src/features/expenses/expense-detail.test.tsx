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
    expect(
      screen.getByText(t('expenses.detail.paidAndShare', { paid: '$30.00', share: '$10.00' })),
    ).toBeVisible()
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
      fx_rate: '1.100000000000',
      split_type: 'shares',
      expense_splits: [
        { user_id: ME, share_cents: 2000, weight: 2, adjustment_cents: null },
        { user_id: BEN, share_cents: 1000, weight: 1, adjustment_cents: null },
      ],
    })
    expect(
      await screen.findByText(
        t('expenses.detail.converted', { amount: '$33.00', currency: 'USD', rate: '1.1' }),
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/\(2 shares\)/)).toBeInTheDocument()
  })

  it('lists every payer, and a payer who is not in the split', async () => {
    renderDetail({
      amount_cents: 9000,
      paid_by: ME,
      created_by: CLEO,
      expense_payers: [
        { user_id: ME, paid_cents: 6000 },
        { user_id: BEN, paid_cents: 3000 },
      ],
      expense_splits: [
        { user_id: ME, share_cents: 4500, weight: null, adjustment_cents: null },
        { user_id: CLEO, share_cents: 4500, weight: null, adjustment_cents: null },
      ],
    })
    expect(
      await screen.findByText(t('expenses.detail.paidByMany', { names: 'you and Ben' })),
    ).toBeVisible()
    expect(
      screen.getByText(t('expenses.detail.paidAndShare', { paid: '$60.00', share: '$45.00' })),
    ).toBeVisible()
    expect(screen.getByText(t('expenses.detail.paidOnly', { amount: '$30.00' }))).toBeVisible()
    // Paying part of it is enough to edit it.
    expect(screen.getByRole('group', { name: t('expenses.detail.actions') })).toBeVisible()
  })

  it('marks a refund and says who got the money back', async () => {
    renderDetail({
      is_refund: true,
      paid_by: BEN,
      expense_payers: [{ user_id: BEN, paid_cents: 3000 }],
    })
    expect(await screen.findByText(t('expenses.detail.receivedBy', { name: 'Ben' }))).toBeVisible()
    expect(screen.getAllByText(t('expenses.refund.badge')).length).toBeGreaterThan(0)
    expect(screen.getAllByText(t('expenses.detail.getsBack', { amount: '$10.00' }))).toHaveLength(2)
  })

  it('shows stored items with tax, tip and discount, and adjustments', async () => {
    renderDetail({
      split_type: 'itemized',
      amount_cents: 3300,
      tax_cents: 300,
      tip_cents: 200,
      discount_cents: 200,
      expense_items: [
        { position: 1, description: 'Dumplings', amount_cents: 2000, user_ids: [ME, BEN] },
        { position: 0, description: 'Noodles', amount_cents: 1000, user_ids: [ME] },
      ],
    })
    const items = await screen.findByRole('region', { name: t('expenses.detail.items') })
    expect(
      within(items)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Noodles'), expect.stringContaining('Dumplings')])
    expect(within(items).getByText(t('expenses.itemized.discount'))).toBeVisible()
    expect(
      within(items).getByText(t('expenses.detail.itemPeople', { names: 'you and Ben' })),
    ).toBeVisible()
  })

  it('shows the adjustment next to a share', async () => {
    renderDetail({
      split_type: 'adjustment',
      expense_splits: [
        { user_id: ME, share_cents: 1500, weight: null, adjustment_cents: 500 },
        { user_id: BEN, share_cents: 1000, weight: null, adjustment_cents: 0 },
        { user_id: CLEO, share_cents: 500, weight: null, adjustment_cents: -500 },
      ],
    })
    expect(await screen.findByText(/\(\+\$5\.00\)/)).toBeVisible()
    expect(screen.getByText(/\(−\$5\.00\)/)).toBeVisible()
  })

  it('shows who added and edited it, with the amount change', async () => {
    resetDb({
      tables: {
        activity: [
          {
            id: 'a1',
            subject_id: ID,
            actor_id: BEN,
            verb: 'expense.created',
            data: { amount_cents: 2000, currency: 'USD' },
            created_at: '2026-11-04T18:00:00Z',
          },
          {
            id: 'a2',
            subject_id: ID,
            actor_id: ME,
            verb: 'expense.updated',
            data: { amount_cents: 3000, currency: 'USD' },
            created_at: '2026-11-05T18:00:00Z',
          },
          {
            id: 'a3',
            subject_id: ID,
            actor_id: ME,
            verb: 'comment.created',
            data: {},
            created_at: '2026-11-05T19:00:00Z',
          },
        ],
      },
    })
    renderDetail()
    const history = await screen.findByRole('region', { name: t('expenses.history.title') })
    expect(within(history).getAllByRole('listitem')).toHaveLength(2)
    expect(within(history).getByText(t('expenses.history.created', { name: 'Ben' }))).toBeVisible()
    expect(within(history).getByText(t('expenses.history.self.updated'))).toBeVisible()
    expect(within(history).getByText(/\$20\.00 to \$30\.00/)).toBeVisible()
  })

  it('lists what each edit changed, old and new', async () => {
    resetDb({
      tables: {
        activity: [
          {
            id: 'a1',
            subject_id: ID,
            actor_id: BEN,
            verb: 'expense.updated',
            data: {
              amount_cents: 3000,
              currency: 'USD',
              changes: {
                description: { from: 'Taco', to: 'Tacos' },
                payers: { from: { [ME]: 3000 }, to: { [ME]: 2000, [BEN]: 1000 } },
              },
            },
            created_at: '2026-11-05T18:00:00Z',
          },
        ],
      },
    })
    renderDetail()
    const history = await screen.findByRole('region', { name: t('expenses.history.title') })
    expect(within(history).getByText(t('expenses.history.updated', { name: 'Ben' }))).toBeVisible()
    expect(
      within(history).getByText(
        t('expenses.history.change.description', { from: 'Taco', to: 'Tacos' }),
      ),
    ).toBeVisible()
    expect(
      within(history).getByText(
        t('expenses.history.change.payers', { from: 'you', to: 'you $20.00 and Ben $10.00' }),
      ),
    ).toBeVisible()
  })

  it('keeps a payer share neutral and shows their net in its own colour', async () => {
    renderDetail({
      amount_cents: 3000,
      paid_by: BEN,
      expense_payers: [{ user_id: BEN, paid_cents: 3000 }],
    })
    const ben = (
      await screen.findByText(
        t('expenses.detail.paidAndShare', { paid: '$30.00', share: '$10.00' }),
      )
    ).closest('li')!
    expect(ben.querySelector('[data-tone="neutral"]')).not.toBeNull()
    expect(within(ben).getByText(t('expenses.detail.getsBack', { amount: '$20.00' }))).toBeVisible()
    // My line: my share is what I owe.
    const mine = screen
      .getAllByText(t('expenses.detail.owes', { amount: '$10.00' }))[0]!
      .closest('li')!
    expect(mine.querySelector('[data-tone="owe"]')).not.toBeNull()
  })

  it('is read only in an archived group', async () => {
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.expense(ID), expense({ id: ID }))
      c.setQueryData(moneyKeys.comments(ID), [])
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
        ...group,
        archived_at: '2026-10-01T00:00:00Z',
      })
    })
    renderWithProviders(<ExpenseDetail expenseId={ID} />, {
      path: '/expenses/$expenseId',
      url: `/expenses/${ID}`,
      client,
    })
    expect(
      await screen.findByText(t('expenses.form.archived', { group: 'Hike crew' })),
    ).toBeVisible()
    expect(
      screen.queryByRole('group', { name: t('expenses.detail.actions') }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('textbox', { name: t('expenses.comments.placeholder') }),
    ).not.toBeInTheDocument()
    // No comments and no way to add one: no empty heading either.
    expect(
      screen.queryByRole('heading', { name: t('expenses.comments.title') }),
    ).not.toBeInTheDocument()
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
        { user_id: ME, share_cents: 1500, weight: null, adjustment_cents: null },
        {
          user_id: 'dddddddd-0000-4000-8000-000000000004',
          share_cents: 1500,
          weight: null,
          adjustment_cents: null,
        },
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
    expect(
      db()
        .queries('comments')
        .some((call) => payloadOf(call, 'insert')),
    ).toBe(false)
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
