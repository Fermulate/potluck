import type * as Api from '@potluck/api'
import { importExpenses, moneyKeys, transferKeys } from '@potluck/api'
import { ledgerCsv } from '@potluck/core'
import { formatMoney, setLocale, t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderInRouter } from '@/features/expenses/router-test-utils'
import {
  BEN,
  GROUP_ID,
  ME,
  expense,
  group,
  members,
  seededClient,
} from '@/features/expenses/test-utils'
import { ImportScreen } from './import-screen'
import { ledgerLabels } from './labels'
import { fingerprint } from './read-file'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  importExpenses: vi.fn(async () => ({ expenses: 3, payments: 1 })),
}))

const save = vi.mocked(importExpenses)
// Radix scrolls the picked option into view; jsdom cannot scroll.
Element.prototype.scrollIntoView ??= () => {}

const GONE = 'dddddddd-0000-4000-8000-000000000004'
const HEADER = 'Date,Description,Category,Cost,Currency,Ava Smith,Ben Jones,Cleo Park'
const SPLITWISE = [
  HEADER,
  '2026-03-01,Dinner,Dining out,90.00,USD,60.00,-30.00,-30.00',
  '2026-03-02,Groceries,Groceries,45.00,USD,-15.00,30.00,-15.00',
  '2026-03-03,Ben J. paid Ava S.,Payment,30.00,USD,-30.00,30.00,0.00',
  '2026-03-04,Returned tickets,Movies,30.00,USD,-20.00,10.00,10.00',
  '',
  '2026-03-05,Total balance, , ,USD,-5.00,40.00,-35.00',
].join('\n')

interface Seed {
  group?: Partial<Api.MoneyGroup>
  expenses?: Api.ExpenseWithSplits[]
  imports?: Api.PastImport[]
  people?: Api.MoneyPerson[]
  /** Stored rates per currency into USD. */
  rates?: Record<string, Api.FxHistory>
}

function renderScreen(seed: Seed = {}) {
  return renderInRouter(
    <ImportScreen groupId={GROUP_ID} />,
    seededClient((c) => {
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), { ...group, ...seed.group })
      c.setQueryData(moneyKeys.balances(GROUP_ID), [
        { user_id: ME, net_cents: 1000 },
        { user_id: BEN, net_cents: -1000 },
      ])
      c.setQueryData(moneyKeys.expenses(GROUP_ID), seed.expenses ?? [])
      c.setQueryData(moneyKeys.settlements(GROUP_ID), [])
      c.setQueryData(transferKeys.imports(GROUP_ID), seed.imports ?? [])
      if (seed.people) c.setQueryData(moneyKeys.people(), seed.people)
      for (const [from, history] of Object.entries(seed.rates ?? {})) {
        c.setQueryData(transferKeys.fx(from, 'USD'), history)
      }
    }),
  )
}

async function upload(text: string, name = 'splitwise.csv') {
  const input = await screen.findByLabelText(t('transfer.import.pick'))
  fireEvent.change(input, { target: { files: [new File([text], name, { type: 'text/csv' })] } })
  await screen.findByText(name)
}

const submitButton = (count: number) =>
  screen.findByRole('button', { name: t('transfer.import.submit', { count }) })

async function pick(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('combobox', { name: label }), { key: 'Enter' })
  fireEvent.click(await screen.findByRole('option', { name: option }))
}

describe('ImportScreen', () => {
  beforeEach(() => save.mockClear())

  it('reads a Splitwise export, matches people and previews everyone after the import', async () => {
    renderScreen()
    await upload(SPLITWISE)
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
    // Rows about the viewer say so.
    expect(screen.getByText(t('transfer.import.rowPaidYou'))).toBeVisible()
    expect(screen.getByText(t('transfer.import.rowPaid', { names: 'Ben' }))).toBeVisible()
    expect(screen.getByText(t('transfer.import.rowPaymentToYou', { from: 'Ben' }))).toBeVisible()
    // The keyboard lands on the preview.
    expect(screen.getByRole('heading', { name: t('transfer.import.preview') })).toHaveFocus()
  })

  it('imports every row in one go and goes back to the expenses', async () => {
    const { client } = renderScreen()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await upload(SPLITWISE)
    fireEvent.click(await submitButton(4))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    const [, groupId, rows, source, options] = save.mock.calls[0]!
    expect(groupId).toBe(GROUP_ID)
    expect(source).toBe('splitwise')
    expect(options?.fingerprint).toBe(await fingerprint(SPLITWISE))
    expect(rows.map((r) => r.kind)).toEqual(['expense', 'expense', 'payment', 'expense'])
    expect(rows[3]).toMatchObject({ is_refund: false })
    expect(rows[0]).toMatchObject({ payers: [{ user_id: ME, paid_cents: 9000 }] })
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
  })

  it('keeps Import and Choose another file shut while a long import is on its way', async () => {
    let finish: (value: { expenses: number; payments: number }) => void = () => {}
    save.mockImplementationOnce((_client, _group, _rows, _source, options) => {
      options?.onProgress?.(2, 4)
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    renderScreen()
    await upload(SPLITWISE)
    fireEvent.click(await submitButton(4))
    const sending = await screen.findByRole('button', {
      name: t('transfer.import.progress', { sent: 2, total: 4 }),
    })
    expect(sending).toBeDisabled()
    fireEvent.click(sending)
    expect(save).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: t('transfer.import.another') })).toBeDisabled()
    finish({ expenses: 3, payments: 1 })
  })

  it('names the row the server refused, in words about imports', async () => {
    save.mockRejectedValueOnce({
      message: 'split_member_not_in_group',
      hint: 'import_row:2',
      imported: { expenses: 0, payments: 0 },
    })
    renderScreen()
    await upload(SPLITWISE)
    fireEvent.click(await submitButton(4))
    expect(await screen.findByText(t('transfer.import.errors.left', { line: 3 }))).toBeVisible()

    save.mockRejectedValueOnce({
      message: 'canceling statement due to statement timeout',
      code: '57014',
      imported: { expenses: 5000, payments: 0 },
    })
    fireEvent.click(await submitButton(4))
    expect(
      await screen.findByText(
        `${t('transfer.import.errors.timeout')} ${t('transfer.import.errors.partly', { count: 5000 })}`,
      ),
    ).toBeVisible()

    save.mockRejectedValueOnce({ message: 'invalid_currency', hint: 'import_row:1' })
    fireEvent.click(await submitButton(4))
    expect(
      await screen.findByText(t('transfer.import.errors.currency', { line: 2, currency: 'USD' })),
    ).toBeVisible()

    save.mockRejectedValueOnce({ message: 'payers_sum_mismatch', hint: 'import_row:1' })
    fireEvent.click(await submitButton(4))
    expect(
      await screen.findByText(
        t('transfer.import.rowFailed', {
          line: 2,
          message: t('expenses.errors.payers_sum_mismatch'),
        }),
      ),
    ).toBeVisible()
  })

  it('waits for everyone with money to be matched, and says Import without a count until then', async () => {
    renderScreen()
    await upload(SPLITWISE.replace('Cleo Park', 'Zed Quinn'))
    expect(
      await screen.findByText(t('transfer.import.issues.unmapped', { detail: 'Zed Quinn' })),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: t('transfer.import.submitBlocked') })).toBeDisabled()
    await pick('Zed Quinn', 'Cleo Park')
    expect(await submitButton(4)).toBeEnabled()
  })

  it('shows who has left, and can leave their rows out', async () => {
    renderScreen({
      people: [
        ...members,
        { id: GONE, display_name: 'Dee Gone', avatar_path: null, deleted_at: null },
      ],
      expenses: [
        expense({
          paid_by: GONE,
          expense_payers: [{ user_id: GONE, paid_cents: 3000 }],
        }),
      ],
    })
    await upload(SPLITWISE.replace('Cleo Park', 'Dee Gone'))
    const left = t('transfer.import.left', { name: 'Dee Gone', group: group.name })
    expect(await screen.findByText(left)).toBeVisible()
    expect(screen.getByRole('button', { name: t('transfer.import.submitBlocked') })).toBeDisabled()
    await pick('Dee Gone', t('transfer.import.skipPerson'))
    expect(screen.getByText(t('transfer.import.skippedPerson', { count: 3 }))).toBeVisible()
    fireEvent.click(await submitButton(1))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![2]).toHaveLength(1)
  })

  it('asks for a rate Potluck does not have, or leaves those rows out', async () => {
    renderScreen({
      rates: { EUR: { direct: [{ day: '2026-11-01', rate: '1.08' }], inverse: [], known: true } },
    })
    await upload(`${HEADER}\n2024-01-05,Museum,General,10.00,EUR,10.00,-5.00,-5.00`)
    expect(
      await screen.findByText(
        t('transfer.import.rates.missing', {
          currency: 'EUR',
          group: 'USD',
          count: 1,
          from: 'Jan 5, 2024',
          to: 'Jan 5, 2024',
        }),
      ),
    ).toBeVisible()
    const rate = screen.getByRole('textbox', {
      name: t('transfer.import.rates.typed', { currency: 'EUR', group: 'USD' }),
    })
    fireEvent.change(rate, { target: { value: '1,1' } })
    fireEvent.blur(rate)
    expect(
      await screen.findByText(
        t('transfer.import.rates.using', { currency: 'EUR', rate: '1.1', group: 'USD' }),
      ),
    ).toBeVisible()
    // Ava paid 10 EUR, 11 USD at 1.1, for Ben and Cleo: owed 10 before, 21 after.
    expect(await screen.findByText('$21.00')).toBeInTheDocument()
    fireEvent.click(await submitButton(1))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![2][0]).toMatchObject({ fx_rate: '1.1' })
  })

  it('keeps the rate field while typing, applies it on Enter with every digit, and asks to confirm a far one', async () => {
    renderScreen({
      // Held against the stored rate nearest the row's day, not the latest one.
      rates: {
        JPY: {
          direct: [
            { day: '2026-11-01', rate: '0.067' },
            { day: '2024-02-01', rate: '0.0067' },
          ],
          inverse: [],
          known: true,
        },
      },
    })
    await upload(`${HEADER}\n2024-01-05,Sushi,General,9000,JPY,6000,-3000,-3000`)
    const label = t('transfer.import.rates.typed', { currency: 'JPY', group: 'USD' })
    const rate = await screen.findByRole('textbox', { name: label })
    rate.focus()
    for (const text of ['0', '0.', '0.0', '0.00', '0.009', '0.0091']) {
      fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value: text } })
    }
    // Nothing is applied while typing: the field stays put and keeps focus.
    expect(screen.getByRole('textbox', { name: label })).toBe(rate)
    expect(rate).toHaveFocus()
    expect(rate).toHaveValue('0.0091')
    fireEvent.keyDown(rate, { key: 'Enter' })
    expect(
      await screen.findByText(
        t('transfer.import.rates.using', { currency: 'JPY', rate: '0.0091', group: 'USD' }),
      ),
    ).toBeVisible()
    fireEvent.click(await submitButton(1))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![2][0]).toMatchObject({ fx_rate: '0.0091' })
    expect(save.mock.calls[0]![2][0]).not.toHaveProperty('fx_rate_confirmed')

    // Ten times Potluck's rate: warned, and blocked until confirmed.
    fireEvent.change(rate, { target: { value: '0.067' } })
    fireEvent.click(screen.getByRole('button', { name: t('transfer.import.rates.apply') }))
    expect(
      await screen.findByText(
        t('transfer.import.rates.far', {
          currency: 'JPY',
          rate: '0.067',
          reference: '0.0067',
          group: 'USD',
        }),
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: t('transfer.import.submitBlocked') })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: t('transfer.import.rates.confirm') }))
    fireEvent.click(await submitButton(1))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
    expect(save.mock.calls[1]![2][0]).toMatchObject({ fx_rate: '0.067', fx_rate_confirmed: true })

    fireEvent.change(rate, { target: { value: 'abc' } })
    fireEvent.blur(rate)
    expect(
      await screen.findByText(t('transfer.import.rates.invalid', { example: '0.0091' })),
    ).toBeVisible()
  })

  it("asks to confirm a Potluck file's rate that is far from Potluck's own", async () => {
    renderScreen({
      rates: { EUR: { direct: [{ day: '2026-03-01', rate: '1.1' }], inverse: [], known: true } },
    })
    const csv = ledgerCsv(
      [
        {
          name: 'Trip',
          currency: 'USD',
          expenses: [
            {
              description: 'Museum',
              category: null,
              notes: null,
              spentAt: '2026-03-01',
              createdAt: '2026-03-01T10:00:00Z',
              amountCents: 1000,
              currency: 'EUR',
              fxRate: '11.000000000000',
              isRefund: false,
              payers: [{ userId: ME, paidCents: 1000 }],
              splits: [
                { userId: ME, shareCents: 500 },
                { userId: BEN, shareCents: 500 },
              ],
            },
          ],
          payments: [],
        },
      ],
      {
        labels: ledgerLabels(),
        people: [
          { id: ME, name: 'Ava Chen' },
          { id: BEN, name: 'Ben Okafor' },
        ],
        paymentText: () => '',
      },
    )
    await upload(csv, 'potluck.csv')
    // Ten times the stored rate: the server refuses it unless the person says it is right.
    expect(
      await screen.findByText(
        t('transfer.import.rates.fileFar', {
          currency: 'EUR',
          rate: '11',
          reference: '1.1',
          group: 'USD',
        }),
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: t('transfer.import.submitBlocked') })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: t('transfer.import.rates.confirm') }))
    fireEvent.click(await submitButton(1))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![2][0]).toMatchObject({ fx_rate: '11', fx_rate_confirmed: true })
  })

  it('uses stored rates for every currency, so the balances are the real ones', async () => {
    renderScreen({
      rates: { EUR: { direct: [{ day: '2026-02-27', rate: '1.2' }], inverse: [], known: true } },
    })
    await upload(`${HEADER}\n2026-03-01,Museum,General,10.00,EUR,10.00,-5.00,-5.00`)
    fireEvent.click(await submitButton(1))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![2][0]).toMatchObject({ fx_rate: '1.2' })
  })

  it('leaves rows out when there is no rate and the person says so', async () => {
    renderScreen({
      rates: { EUR: { direct: [], inverse: [], known: true } },
    })
    await upload(
      `${HEADER}\n2024-01-05,Museum,General,10.00,EUR,10.00,-5.00,-5.00\n2024-01-06,Lunch,General,10.00,USD,10.00,-5.00,-5.00`,
    )
    fireEvent.click(await screen.findByRole('checkbox', { name: t('transfer.import.rates.skip') }))
    expect(screen.getByText(t('transfer.import.skippedRate', { count: 1 }))).toBeVisible()
    expect(await submitButton(1)).toBeEnabled()
    // Leaving rows out means the file's own total will not match.
    expect(screen.queryByText(t('transfer.import.totalsMatch'))).not.toBeInTheDocument()
  })

  it('says when Potluck has no rates for a currency at all: leave the rows out or use another group', async () => {
    renderScreen({ rates: { XYZ: { direct: [], inverse: [], known: false } } })
    await upload(
      `${HEADER}\n2024-01-05,Museum,General,10.00,XYZ,10.00,-5.00,-5.00\n2024-01-06,Lunch,General,10.00,USD,10.00,-5.00,-5.00`,
    )
    expect(
      await screen.findByText(t('transfer.import.rates.unsupported', { currency: 'XYZ' })),
    ).toBeVisible()
    expect(
      screen.queryByRole('textbox', {
        name: t('transfer.import.rates.typed', { currency: 'XYZ', group: 'USD' }),
      }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('transfer.import.submitBlocked') })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: t('transfer.import.rates.skip') }))
    expect(screen.getByText(t('transfer.import.skippedRate', { count: 1 }))).toBeVisible()
    expect(await submitButton(1)).toBeEnabled()
  })

  it('shows rates with the language decimal mark and takes them typed that way', async () => {
    await setLocale('fr')
    try {
      renderScreen({
        rates: { EUR: { direct: [{ day: '2026-11-01', rate: '1.08' }], inverse: [], known: true } },
      })
      await upload(`${HEADER}\n2024-01-05,Museum,General,10.00,EUR,10.00,-5.00,-5.00`)
      const rate = await screen.findByRole('textbox', {
        name: t('transfer.import.rates.typed', { currency: 'EUR', group: 'USD' }),
      })
      fireEvent.change(rate, { target: { value: '1,09' } })
      fireEvent.blur(rate)
      expect(
        await screen.findByText(
          t('transfer.import.rates.using', { currency: 'EUR', rate: '1,09', group: 'USD' }),
        ),
      ).toBeVisible()
      // The field keeps what was typed.
      expect(rate).toHaveValue('1,09')
      fireEvent.change(rate, { target: { value: 'abc' } })
      fireEvent.blur(rate)
      expect(
        await screen.findByText(t('transfer.import.rates.invalid', { example: '0,0091' })),
      ).toBeVisible()
    } finally {
      await setLocale('en')
    }
  })

  it('holds back payments between two other people unless an owner or admin imports', async () => {
    const between = `${HEADER}\n2026-03-03,Cleo P. paid Ben J.,Payment,30.00,USD,0.00,-30.00,30.00`
    const issue = t('transfer.import.notAParty', { count: 1 })
    renderScreen()
    await upload(between)
    expect(await screen.findByText(issue)).toBeVisible()
    expect(screen.getByRole('button', { name: t('transfer.import.submitBlocked') })).toBeDisabled()
  })

  it('matches a name in the file to a seat for someone not on Potluck yet', async () => {
    const SEAT = 'eeeeeeee-0000-4000-8000-000000000005'
    renderScreen({
      group: {
        members: [
          ...members,
          {
            id: SEAT,
            display_name: 'Sam Seat',
            avatar_path: null,
            deleted_at: null,
            role: 'member',
            is_placeholder: true,
          },
        ],
      },
    })
    await upload(SPLITWISE.replace('Cleo Park', 'Sam Seat'))
    expect(screen.getByRole('combobox', { name: 'Sam Seat' })).toHaveTextContent(
      t('transfer.import.seatOption', { name: 'Sam Seat' }),
    )
    fireEvent.click(await submitButton(4))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![2][0]).toMatchObject({
      splits: expect.arrayContaining([{ user_id: SEAT, share_cents: 3000 }]),
    })
  })

  it('lets an admin import payments between two other people', async () => {
    const between = `${HEADER}\n2026-03-03,Cleo P. paid Ben J.,Payment,30.00,USD,0.00,-30.00,30.00`
    renderScreen({
      group: { members: members.map((m) => (m.id === ME ? { ...m, role: 'admin' as const } : m)) },
    })
    await upload(between)
    expect(await submitButton(1)).toBeEnabled()
    expect(screen.queryByText(t('transfer.import.notAParty', { count: 1 }))).not.toBeInTheDocument()
  })

  it('says when only part of a file went in before', async () => {
    renderScreen({
      imports: [
        {
          at: '2026-03-10T10:00:00Z',
          actorId: ME,
          fingerprint: (await fingerprint(SPLITWISE)) ?? null,
          expenses: 2,
          payments: 0,
        },
      ],
    })
    await upload(SPLITWISE)
    expect(screen.getByText(/^Part of this file went into/)).toBeVisible()
  })

  it('warns about rows and files already imported', async () => {
    renderScreen({
      expenses: [expense({ description: 'Dinner', amount_cents: 9000, spent_at: '2026-03-01' })],
      imports: [
        {
          at: '2026-03-10T10:00:00Z',
          actorId: ME,
          fingerprint: (await fingerprint(SPLITWISE)) ?? null,
          expenses: 4,
          payments: 0,
        },
      ],
    })
    await upload(SPLITWISE)
    expect(screen.getByText(/already went into/)).toBeVisible()
    expect(
      screen.getByText(t('transfer.import.duplicates.rows', { count: 1, group: group.name })),
    ).toBeVisible()
    fireEvent.click(
      screen.getByRole('checkbox', { name: t('transfer.import.duplicates.leaveOut') }),
    )
    expect(await submitButton(3)).toBeEnabled()
  })

  it('reads dates a spreadsheet rewrote, and can read them the other way round', async () => {
    renderScreen()
    await upload(`${HEADER}\n4/3/2026,Lunch,General,10.00,USD,10.00,-5.00,-5.00`)
    expect(screen.getByText(t('transfer.import.dates.mdy'))).toBeVisible()
    expect(screen.getByText('Apr 3, 2026')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('transfer.import.dates.toDmy') }))
    expect(await screen.findByText(t('transfer.import.dates.dmy'))).toBeVisible()
    expect(screen.getByText('Mar 4, 2026')).toBeVisible()
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
      'Ava Chen paid,Ava Chen share,Ava Chen balance,Cleo Park paid,Cleo Park share,Cleo Park balance,Zed paid,Zed share,Zed balance,Notes,Items'
    await upload(
      [
        header,
        '2026-03-01,Hike crew,Expense,Snacks,Food,20.00,USD,1,USD,20.00,Ava Chen,20.00,10.00,10.00,,10.00,-10.00,,,,,',
        '2026-03-02,Flat,Expense,Rent,Rent,900.00,USD,1,USD,900.00,Zed,,450.00,-450.00,,,,900.00,450.00,450.00,,',
      ].join('\n'),
      'potluck.csv',
    )
    expect(screen.getByText(/Potluck spreadsheet, 2 rows/)).toBeVisible()
    expect(
      screen.getByRole('combobox', { name: t('transfer.import.sourceGroup') }),
    ).toHaveTextContent('Hike crew')
    // Zed is only in the other group, so nobody has to say who Zed is.
    expect(screen.queryByRole('combobox', { name: 'Zed' })).not.toBeInTheDocument()
    expect(await submitButton(1)).toBeEnabled()
    expect(screen.getByText('Snacks')).toBeVisible()
    expect(screen.queryByText('Rent')).not.toBeInTheDocument()
  })

  it('says a long file goes in as several imports', async () => {
    renderScreen()
    const row = '2026-03-02,Lunch,General,10.00,USD,10.00,-5.00,-5.00'
    await upload([HEADER, ...Array.from({ length: 6000 }, () => row)].join('\n'))
    expect(
      await screen.findByText(t('transfer.import.parts', { count: 6000, parts: 2 })),
    ).toBeVisible()
  })

  it('says an archived group takes no imports', async () => {
    renderScreen({ group: { archived_at: '2026-03-01T00:00:00Z' } })
    expect(await screen.findByText(t('transfer.import.archived'))).toBeVisible()
    expect(screen.queryByLabelText(t('transfer.import.pick'))).not.toBeInTheDocument()
  })
})
