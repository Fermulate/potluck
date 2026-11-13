import type * as Api from '@potluck/api'
import { importExpenses, moneyKeys } from '@potluck/api'
import { formatMoney, t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderInRouter } from '@/features/expenses/router-test-utils'
import { BEN, CLEO, GROUP_ID, ME, group, seededClient } from '@/features/expenses/test-utils'
import { ImportScreen } from './import-screen'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  importExpenses: vi.fn(async () => ({ expenses: 3, payments: 1 })),
}))

const save = vi.mocked(importExpenses)
// Radix scrolls the picked option into view; jsdom cannot scroll.
Element.prototype.scrollIntoView ??= () => {}

const SPLITWISE = [
  'Date,Description,Category,Cost,Currency,Ava Smith,Ben Jones,Cleo Park',
  '2026-03-01,Dinner,Dining out,90.00,USD,60.00,-30.00,-30.00',
  '2026-03-02,Groceries,Groceries,45.00,USD,-15.00,30.00,-15.00',
  '2026-03-03,Ben J. paid Ava S.,Payment,30.00,USD,-30.00,30.00,0.00',
  '2026-03-04,Returned tickets,Movies,30.00,USD,-20.00,10.00,10.00',
  '',
  '2026-03-05,Total balance, , ,USD,-5.00,40.00,-35.00',
].join('\n')

function renderScreen(patch: Partial<Api.MoneyGroup> = {}) {
  return renderInRouter(
    <ImportScreen groupId={GROUP_ID} />,
    seededClient((c) => {
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), { ...group, ...patch })
      c.setQueryData(moneyKeys.balances(GROUP_ID), [
        { user_id: ME, net_cents: 1000 },
        { user_id: BEN, net_cents: -1000 },
      ])
    }),
  )
}

async function upload(text: string, name = 'splitwise.csv') {
  const input = await screen.findByLabelText(t('transfer.import.pick'))
  fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } })
}

describe('ImportScreen', () => {
  beforeEach(() => save.mockClear())

  it('reads a Splitwise export, matches people and previews the balances', async () => {
    renderScreen()
    await upload(SPLITWISE)
    expect(await screen.findByText('splitwise.csv')).toBeVisible()
    expect(screen.getByText(/Splitwise export, 4 rows/)).toBeVisible()
    // First names match Ava Chen and Ben Okafor; Cleo Park matches outright.
    expect(screen.getByRole('combobox', { name: 'Ava Smith' })).toHaveTextContent('Ava Chen')
    expect(screen.getByRole('combobox', { name: 'Cleo Park' })).toHaveTextContent('Cleo Park')
    expect(screen.getByText(t('transfer.import.expenses', { count: 3 }))).toBeVisible()
    expect(screen.getByText(t('transfer.import.payments', { count: 1 }))).toBeVisible()
    expect(screen.getByText(t('transfer.import.totalsMatch'))).toBeVisible()
    // Ava was owed 10 and the file takes 5 off; Cleo ends up owing 35.
    expect(
      screen.getByText(t('transfer.import.now', { amount: formatMoney(1000, 'USD') })),
    ).toBeVisible()
    expect(screen.getByText('$5.00')).toBeInTheDocument()
    expect(screen.getByText('$35.00')).toBeInTheDocument()
    expect(screen.getByText('Dinner')).toBeVisible()
  })

  it('imports every row in one go and goes back to the expenses', async () => {
    const { client } = renderScreen()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await upload(SPLITWISE)
    fireEvent.click(
      await screen.findByRole('button', { name: t('transfer.import.submit', { count: 4 }) }),
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const [, groupId, rows, source] = save.mock.calls[0]!
    expect(groupId).toBe(GROUP_ID)
    expect(source).toBe('splitwise')
    expect(rows.map((r) => r.kind)).toEqual(['expense', 'expense', 'payment', 'expense'])
    expect(rows[0]).toMatchObject({ payers: [{ user_id: ME, paid_cents: 9000 }] })
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
  })

  it('names the row the server refused', async () => {
    save.mockRejectedValueOnce({ message: 'split_member_not_in_group', hint: 'import_row:2' })
    renderScreen()
    await upload(SPLITWISE)
    fireEvent.click(
      await screen.findByRole('button', { name: t('transfer.import.submit', { count: 4 }) }),
    )
    expect(
      await screen.findByText(
        t('transfer.import.rowFailed', {
          line: 3,
          message: t('expenses.errors.split_member_not_in_group'),
        }),
      ),
    ).toBeVisible()
  })

  it('waits for everyone with money to be matched', async () => {
    renderScreen()
    await upload(SPLITWISE.replace('Cleo Park', 'Zed Quinn'))
    expect(
      await screen.findByText(t('transfer.import.issues.unmapped', { detail: 'Zed Quinn' })),
    ).toBeVisible()
    const submit = screen.getByRole('button', { name: t('transfer.import.submit', { count: 0 }) })
    expect(submit).toBeDisabled()

    const pick = screen.getByRole('combobox', { name: 'Zed Quinn' })
    fireEvent.keyDown(pick, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('option', { name: 'Cleo Park' }))
    expect(
      await screen.findByRole('button', { name: t('transfer.import.submit', { count: 4 }) }),
    ).toBeEnabled()
  })

  it('explains a file it cannot read, and starts over', async () => {
    renderScreen()
    await upload('name,age\nAva,30', 'people.csv')
    expect(await screen.findByText(t('transfer.import.issues.unknown_format'))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('transfer.import.another') }))
    expect(await screen.findByLabelText(t('transfer.import.pick'))).toBeInTheDocument()
  })

  it('lists rows that do not add up with their line', async () => {
    renderScreen()
    await upload(SPLITWISE.replace('60.00,-30.00,-30.00', '60.00,-30.00,-20.00'))
    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByText(
        t('transfer.import.rowFailed', {
          line: 2,
          message: t('transfer.import.issues.unbalanced'),
        }),
      ),
    ).toBeVisible()
  })

  it('reads a Potluck spreadsheet with several groups one group at a time', async () => {
    renderScreen()
    const header =
      'Date,Group,Type,Description,Category,Amount,Currency,Rate,Group currency,Amount in group currency,Paid by,' +
      'Ava Chen paid,Ava Chen share,Ava Chen balance,Cleo Park paid,Cleo Park share,Cleo Park balance,Notes,Items'
    await upload(
      [
        header,
        '2026-03-01,Hike crew,Expense,Snacks,Food,20.00,USD,1,USD,20.00,Ava Chen,20.00,10.00,10.00,,10.00,-10.00,,',
        '2026-03-02,Flat,Expense,Rent,Rent,900.00,USD,1,USD,900.00,Cleo Park,,450.00,-450.00,900.00,450.00,450.00,,',
      ].join('\n'),
      'potluck.csv',
    )
    expect(await screen.findByText(/Potluck spreadsheet/)).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: t('transfer.import.sourceGroup') }),
    ).toHaveTextContent('Hike crew')
    expect(
      screen.getByRole('button', { name: t('transfer.import.submit', { count: 1 }) }),
    ).toBeEnabled()
    expect(screen.getByText('Snacks')).toBeVisible()
    expect(screen.queryByText('Rent')).not.toBeInTheDocument()
    expect(CLEO).toBeTruthy()
  })

  it('says an archived group takes no imports', async () => {
    renderScreen({ archived_at: '2026-03-01T00:00:00Z' })
    expect(await screen.findByText(t('transfer.import.archived'))).toBeVisible()
    expect(screen.queryByLabelText(t('transfer.import.pick'))).not.toBeInTheDocument()
  })
})
