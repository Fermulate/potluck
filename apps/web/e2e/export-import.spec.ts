import { readFile } from 'node:fs/promises'
import {
  createExpense,
  fetchGroupBalances,
  fetchGroupExpenses,
  leaveGroup,
  settleUp,
} from '@potluck/api'
import { backupSchema } from '@potluck/core'
import { t } from '@potluck/i18n'
import type { Download, Page } from '@playwright/test'
import { addEqualExpense, groupWith, type TestGroup } from './support/api'
import { expect, test, unique, type TestUser } from './support/fixtures'

async function text(download: Download): Promise<string> {
  return (await readFile((await download.path())!, 'utf8')).replace(String.fromCharCode(0xfeff), '')
}

async function balancesOf(user: TestUser, group: TestGroup) {
  const rows = await fetchGroupBalances(user.client, group.id)
  return Object.fromEntries(
    rows.filter((r) => r.net_cents !== 0).map((r) => [r.user_id, r.net_cents]),
  )
}

async function threePeople(newUser: (o?: { name?: string }) => Promise<TestUser>) {
  const [me, ben, cleo] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
    newUser({ name: unique('Cleo') }),
  ])
  return { me, ben, cleo }
}

async function importFile(page: Page, group: TestGroup, name: string, content: string) {
  await page.goto(`/groups/${group.id}/settings`)
  await page.getByRole('link', { name: t('transfer.group.import'), exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/groups/${group.id}/import$`))
  await page
    .getByLabel(t('transfer.import.pick'))
    .setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(content) })
  await expect(page.getByText(name)).toBeVisible()
}

/** A Splitwise export of `count` groceries rows, each paid by one of three and split three ways. */
function splitwiseFile(people: TestUser[], count: number) {
  // Splitwise writes full names as the person columns; ours match the members exactly.
  const rows = ['Date,Description,Category,Cost,Currency,' + people.map((p) => p.name).join(',')]
  const totals = [0, 0, 0]
  for (let i = 0; i < count; i++) {
    const nets = [-1000, -1000, -1000]
    nets[i % 3] = 2000
    nets.forEach((cents, p) => (totals[p]! += cents))
    const day = `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`
    const cells = nets.map((c) => (c / 100).toFixed(2)).join(',')
    rows.push(`${day},Groceries ${i + 1},Groceries,30.00,USD,${cells}`)
  }
  const sums = totals.map((c) => (c / 100).toFixed(2)).join(',')
  rows.push('', `2026-09-30,Total balance, , ,USD,${sums}`)
  return { csv: rows.join('\n'), totals }
}

test.describe('export and import', () => {
  test('a group exported to a spreadsheet and imported into an empty group keeps its balances', async ({
    newUser,
    openAs,
  }) => {
    const { me, ben, cleo } = await threePeople(newUser)
    const trip = await groupWith(me, [ben, cleo], { name: unique('Trip') })
    // Two payers, a refund, an equal split and a payment.
    await createExpense(me.client, {
      group_id: trip.id,
      description: unique('Dinner'),
      amount_cents: 9000,
      currency: 'USD',
      paid_by: me.id,
      payers: [
        { user_id: me.id, paid_cents: 6000 },
        { user_id: ben.id, paid_cents: 3000 },
      ],
      split_type: 'equal',
      splits: [{ user_id: me.id }, { user_id: ben.id }, { user_id: cleo.id }],
      spent_at: '2026-03-01',
    })
    await createExpense(cleo.client, {
      group_id: trip.id,
      description: unique('Returned tickets'),
      amount_cents: 3000,
      currency: 'USD',
      paid_by: cleo.id,
      is_refund: true,
      split_type: 'equal',
      splits: [{ user_id: me.id }, { user_id: cleo.id }],
      spent_at: '2026-03-02',
    })
    await addEqualExpense(ben, trip, [me, ben, cleo], 1000, unique('Coffee'))
    await settleUp(cleo.client, { groupId: trip.id, toUser: me.id, amountCents: 1000 })
    const before = await balancesOf(me, trip)

    const page = await openAs(me)
    await page.goto(`/groups/${trip.id}/settings`)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: t('transfer.group.export') }).click()
    const csv = await text(await download)
    await expect(page.getByText(/^Saved .*\.csv\.$/)).toBeVisible()

    // The balance row says what the balances screen says, to the cent.
    const lines = csv.trim().split('\r\n')
    const header = lines[0]!.split(',')
    const balance = lines.at(-1)!.split(',')
    expect(balance[2]).toBe(t('transfer.csv.kinds.balance'))
    for (const person of [me, ben, cleo]) {
      const col = header.indexOf(t('transfer.csv.balance', { name: person.name }))
      expect(Math.round(Number(balance[col] || 0) * 100)).toBe(before[person.id] ?? 0)
    }

    const empty = await groupWith(me, [ben, cleo], { name: unique('Copy') })
    await importFile(page, empty, 'trip.csv', csv)
    await expect(
      page.getByText(`${t('transfer.import.format.potluck')}, 4 rows`, { exact: false }),
    ).toBeVisible()
    await expect(page.getByText(t('transfer.import.totalsMatch'))).toBeVisible()
    await page.getByRole('button', { name: t('transfer.import.submit', { count: 4 }) }).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${empty.id}$`))
    expect(await balancesOf(me, empty)).toEqual(before)
    const copied = await fetchGroupExpenses(me.client, empty.id)
    expect(copied.find((e) => e.is_refund)?.expense_payers).toEqual([
      { user_id: cleo.id, paid_cents: 3000 },
    ])
  })

  test('a 5,000 row Splitwise export is previewed, then written all at once', async ({
    newUser,
    openAs,
  }) => {
    // Reading, previewing and writing 5,000 rows can take over a minute on a busy CI runner.
    test.setTimeout(180_000)
    const { me, ben, cleo } = await threePeople(newUser)
    const flat = await groupWith(me, [ben, cleo], { name: unique('Flat') })
    const { csv, totals } = splitwiseFile([me, ben, cleo], 5000)
    const page = await openAs(me)
    await importFile(page, flat, 'splitwise.csv', csv)

    await expect(page.getByText(t('transfer.import.expenses', { count: 5000 }))).toBeVisible()
    await expect(page.getByText(t('transfer.import.totalsMatch'))).toBeVisible()
    await expect(page.getByText(t('transfer.import.more', { count: 4994 }))).toBeVisible()
    // Nothing is written by the preview.
    expect(await fetchGroupExpenses(me.client, flat.id)).toHaveLength(0)

    await page.getByRole('button', { name: t('transfer.import.submit', { count: 5000 }) }).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${flat.id}$`), { timeout: 120_000 })
    expect(await fetchGroupExpenses(me.client, flat.id)).toHaveLength(5000)
    expect(await balancesOf(me, flat)).toEqual({
      [me.id]: totals[0],
      [ben.id]: totals[1],
      [cleo.id]: totals[2],
    })
  })

  test('a typed exchange rate keeps every digit it was given', async ({ newUser, openAs }) => {
    const { me, ben, cleo } = await threePeople(newUser)
    const trip = await groupWith(me, [ben, cleo], { name: unique('Trip') })
    // A day long before Potluck's first stored rate, and a name nobody in the group has.
    const csv = [
      `Date,Description,Category,Cost,Currency,${me.name},${ben.name},Zed Quinn`,
      '2020-01-05,Museum,General,30.00,EUR,20.00,-10.00,-10.00',
    ].join('\n')
    const page = await openAs(me)
    await importFile(page, trip, 'old.csv', csv)

    // Picking someone keeps the keyboard on the picker.
    const zed = page.getByRole('combobox', { name: 'Zed Quinn' })
    await zed.click()
    await page.getByRole('option', { name: cleo.name }).click()
    await expect(zed).toBeFocused()

    const label = t('transfer.import.rates.typed', { currency: 'EUR', group: 'USD' })
    const rate = page.getByRole('textbox', { name: label })
    await rate.pressSequentially('0.9091')
    // Nothing is applied mid-typing, so the field stays and keeps focus.
    await expect(rate).toBeFocused()
    await expect(rate).toHaveValue('0.9091')
    await rate.press('Enter')
    await expect(
      page.getByText(
        t('transfer.import.rates.using', { currency: 'EUR', rate: '0.9091', group: 'USD' }),
      ),
    ).toBeVisible()
    await page.getByRole('button', { name: t('transfer.import.submit', { count: 1 }) }).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${trip.id}$`))
    const [museum] = await fetchGroupExpenses(me.client, trip.id)
    expect(museum!.fx_rate).toBe('0.909100000000')
  })

  test('when someone leaves before the import, nothing is written and the row is named', async ({
    newUser,
    openAs,
  }) => {
    const { me, ben, cleo } = await threePeople(newUser)
    const flat = await groupWith(me, [ben, cleo], { name: unique('Flat') })
    const page = await openAs(me)
    await importFile(page, flat, 'splitwise.csv', splitwiseFile([me, ben, cleo], 3000).csv)
    await expect(page.getByText(t('transfer.import.expenses', { count: 3000 }))).toBeVisible()

    await leaveGroup(cleo.client, flat.id)
    await page.getByRole('button', { name: t('transfer.import.submit', { count: 3000 }) }).click()
    await expect(page.getByText(t('transfer.import.errors.left', { line: 2 }))).toBeVisible()
    expect(await fetchGroupExpenses(me.client, flat.id)).toHaveLength(0)
  })

  test('Your data downloads a backup and every group as one spreadsheet', async ({
    newUser,
    openAs,
  }) => {
    const { me, ben } = await threePeople(newUser)
    const group = await groupWith(me, [ben], { name: unique('Backup') })
    await addEqualExpense(me, group, [me, ben], 2000, unique('Pizza'))
    const page = await openAs(me)
    await page.goto('/me')
    const section = page.getByRole('region', { name: t('transfer.yourData.title') })

    const json = page.waitForEvent('download')
    await section.getByRole('button', { name: t('transfer.yourData.backup') }).click()
    const backup = backupSchema.parse(JSON.parse(await text(await json)))
    expect(backup.profile.id).toBe(me.id)
    const exported = backup.groups.find((g) => g.id === group.id)!
    expect(exported.expenses[0]!.splits.map((s) => s.share_cents)).toEqual([1000, 1000])

    const csv = page.waitForEvent('download')
    await section.getByRole('button', { name: t('transfer.yourData.everything') }).click()
    const everything = await text(await csv)
    expect(everything).toContain(`,${group.name},${t('transfer.csv.kinds.balance')},`)
  })
})
