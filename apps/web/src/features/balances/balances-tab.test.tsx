import { moneyKeys } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { BEN, CLEO, GROUP_ID, ME, expense, group, seededClient } from '../expenses/test-utils'
import { BalancesTab } from './balances-tab'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))

function renderTab({
  nets,
  simplified = [] as { from_user: string; to_user: string; amount_cents: number }[],
  simplify = true,
  expenses = [] as ReturnType<typeof expense>[],
}: {
  nets: [string, number][]
  simplified?: { from_user: string; to_user: string; amount_cents: number }[]
  simplify?: boolean
  expenses?: ReturnType<typeof expense>[]
}) {
  const client = seededClient((c) => {
    c.setQueryData(moneyKeys.groupInfo(GROUP_ID), { ...group, simplify_debts: simplify })
    c.setQueryData(
      moneyKeys.balances(GROUP_ID),
      nets.map(([user_id, net_cents]) => ({ group_id: GROUP_ID, user_id, net_cents })),
    )
    c.setQueryData(moneyKeys.simplified(GROUP_ID), simplified)
    c.setQueryData(moneyKeys.expenses(GROUP_ID), expenses)
    c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
  })
  return renderWithProviders(<BalancesTab groupId={GROUP_ID} />, {
    path: '/groups/$groupId/balances',
    url: `/groups/${GROUP_ID}/balances`,
    client,
  })
}

function section(name: string) {
  return screen.getByRole('heading', { name }).closest('section')!
}

describe('BalancesTab', () => {
  it('shows what you owe and a settle up for your one debt', async () => {
    renderTab({
      nets: [
        [ME, -4750],
        [BEN, 6000],
        [CLEO, -1250],
      ],
      simplified: [
        { from_user: ME, to_user: BEN, amount_cents: 4750 },
        { from_user: CLEO, to_user: BEN, amount_cents: 1250 },
      ],
    })
    expect(await screen.findByText(t('balances.youOweTotal'))).toBeInTheDocument()
    const settle = screen.getAllByRole('link', { name: t('balances.settleUp') })
    expect(settle[0]).toHaveAttribute(
      'href',
      `/new/settle?groupId=${GROUP_ID}&to=${BEN}&amount=4750`,
    )

    const debts = section(t('balances.debts'))
    expect(within(debts).getByText(t('balances.simplifiedHint'))).toBeInTheDocument()
    expect(
      within(debts).getByText(t('balances.youOwe', { name: 'Ben', amount: '$47.50' })),
    ).toBeInTheDocument()
    expect(
      within(debts).getByText(t('balances.owes', { from: 'Cleo', to: 'Ben', amount: '$12.50' })),
    ).toBeInTheDocument()

    const everyone = section(t('balances.members'))
    const rows = within(everyone).getAllByRole('listitem')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Ben'),
      expect.stringContaining('Cleo'),
      expect.stringContaining('You'),
    ])
    expect(within(rows[0]!).getByText(t('balances.isOwedShort'))).toBeInTheDocument()
  })

  it('lists the debts you can act on before everyone else’s', async () => {
    renderTab({
      nets: [
        [ME, -1000],
        [BEN, 3000],
        [CLEO, -2000],
      ],
      simplified: [
        { from_user: CLEO, to_user: BEN, amount_cents: 2000 },
        { from_user: ME, to_user: BEN, amount_cents: 1000 },
      ],
    })
    const list = (await screen.findByRole('heading', { name: t('balances.debts') }))
      .closest('section')!
      .querySelector('ul')!
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('You owe Ben $10.00')
    expect(rows[1]).toHaveTextContent('Cleo owes Ben $20.00')
  })

  it('lets a creditor remind who owes them, or record that they paid', async () => {
    renderTab({
      nets: [
        [ME, 3000],
        [BEN, -3000],
        [CLEO, 0],
      ],
      simplified: [{ from_user: BEN, to_user: ME, amount_cents: 3000 }],
    })
    expect(await screen.findByText(t('balances.youAreOwedTotal'))).toBeInTheDocument()
    expect(
      screen.getByText(t('balances.owesYou', { name: 'Ben', amount: '$30.00' })),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: t('balances.remindLabel', { name: 'Ben' }) }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('balances.settleUp') })).toHaveAttribute(
      'href',
      `/new/settle?groupId=${GROUP_ID}`,
    )
    expect(screen.queryByRole('button', { name: t('balances.settleAll') })).not.toBeInTheDocument()
    expect(screen.getByText(t('balances.settledShort'))).toBeInTheDocument()
  })

  it('hides payment actions in an archived group', async () => {
    const client = seededClient((c) => {
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), {
        ...group,
        archived_at: '2026-11-01T00:00:00Z',
      })
      c.setQueryData(moneyKeys.balances(GROUP_ID), [
        { group_id: GROUP_ID, user_id: ME, net_cents: 3000 },
        { group_id: GROUP_ID, user_id: BEN, net_cents: -3000 },
      ])
      c.setQueryData(moneyKeys.simplified(GROUP_ID), [
        { from_user: BEN, to_user: ME, amount_cents: 3000 },
      ])
    })
    renderWithProviders(<BalancesTab groupId={GROUP_ID} />, {
      path: '/groups/$groupId/balances',
      url: `/groups/${GROUP_ID}/balances`,
      client,
    })
    expect(await screen.findByText(t('balances.youAreOwedTotal'))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: t('balances.settleUp') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remind/ })).not.toBeInTheDocument()
  })

  it('lists every pair when simplifying is off', async () => {
    renderTab({
      simplify: false,
      nets: [
        [ME, 2000],
        [BEN, -1000],
        [CLEO, -1000],
      ],
      expenses: [expense({ paid_by: ME })],
    })
    const debts = (await screen.findByRole('heading', { name: t('balances.everyDebt') })).closest(
      'section',
    )!
    expect(within(debts).getByText(t('balances.everyDebtHint'))).toBeInTheDocument()
    expect(
      within(debts).getByText(t('balances.owesYou', { name: 'Ben', amount: '$10.00' })),
    ).toBeInTheDocument()
    expect(
      within(debts).getByText(t('balances.owesYou', { name: 'Cleo', amount: '$10.00' })),
    ).toBeInTheDocument()
  })

  it('celebrates an all square group', async () => {
    renderTab({
      nets: [
        [ME, 0],
        [BEN, 0],
      ],
    })
    expect(await screen.findByText(t('balances.youAreSquare'))).toBeInTheDocument()
    expect(screen.getByText(t('empty.balances.title'))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t('empty.balances.action') })).toHaveAttribute(
      'href',
      `/new/expense?groupId=${GROUP_ID}`,
    )
  })

  it('offers settling with the whole group when you owe several people', async () => {
    renderTab({
      nets: [
        [ME, -2000],
        [BEN, 1000],
        [CLEO, 1000],
      ],
      simplified: [
        { from_user: ME, to_user: BEN, amount_cents: 1000 },
        { from_user: ME, to_user: CLEO, amount_cents: 1000 },
      ],
    })
    const [hero] = await screen.findAllByRole('link', { name: t('balances.settleUp') })
    expect(hero).toHaveAttribute('href', `/new/settle?groupId=${GROUP_ID}`)

    // Settle everything lists both payments before recording them.
    fireEvent.click(screen.getByRole('button', { name: t('balances.settleAll') }))
    const sheet = await screen.findByRole('dialog', { name: t('settle.settleAllTitle') })
    expect(within(sheet).getAllByRole('listitem')).toHaveLength(2)
    expect(within(sheet).getByText('You paid Ben $10.00')).toBeInTheDocument()
    expect(
      within(sheet).getByRole('button', { name: t('settle.settleAllRecord', { count: 2 }) }),
    ).toBeInTheDocument()
  })
})
