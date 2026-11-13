import { updateGroup } from '@potluck/api'
import { formatMoney, t } from '@potluck/i18n'
import type { Page } from '@playwright/test'
import { addEqualExpense, groupWith, type TestGroup } from './support/api'
import { expect, test, unique, type TestUser } from './support/fixtures'

const usd = (cents: number) => formatMoney(cents, 'USD')

async function startExpense(page: Page, group: TestGroup, amount: string, description: string) {
  await page.goto(`/new/expense?groupId=${group.id}`)
  await page.getByRole('textbox', { name: t('expenses.fields.amount') }).fill(amount)
  await page.getByRole('textbox', { name: t('expenses.fields.description') }).fill(description)
}

async function save(page: Page, group: TestGroup) {
  await page.getByRole('button', { name: t('expenses.form.save') }).click()
  await expect(page).toHaveURL(new RegExp(`/groups/${group.id}$`))
}

async function openExpense(page: Page, description: string) {
  await page.getByRole('link', { name: new RegExp(description) }).click()
  await expect(page.getByRole('heading', { level: 1, name: description })).toBeVisible()
}

async function threePeople(newUser: (o?: { name?: string }) => Promise<TestUser>) {
  const [me, ben, cleo] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
    newUser({ name: unique('Cleo') }),
  ])
  const group = await groupWith(me, [ben, cleo])
  return { me, ben, cleo, group }
}

test.describe('expense entry', () => {
  test('two people pay one bill, and every screen agrees', async ({ newUser, openAs }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const page = await openAs(me)
    const description = unique('Dinner')

    // 90 paid 60 by me and 30 by Ben, split equally between three.
    await startExpense(page, group, '90', description)
    // Escape closes the sheet and puts focus back on "Paid by".
    const paidByButton = page.getByRole('button', { name: t('expenses.fields.paidBy') })
    await paidByButton.click()
    await page.getByRole('dialog', { name: t('expenses.payers.title') }).waitFor()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(paidByButton).toBeFocused()

    await paidByButton.click()
    const sheet = page.getByRole('dialog', { name: t('expenses.payers.title') })
    await sheet.getByRole('radio', { name: t('expenses.payers.several') }).click()
    const paidBy = (name: string) =>
      sheet.getByRole('textbox', { name: t('expenses.payers.amountOf', { name }) })
    await paidBy(t('common.you')).fill('60')
    await expect(sheet.getByText(t('expenses.remaining', { amount: usd(3000) }))).toBeVisible()
    await sheet.getByRole('button', { name: t('expenses.payers.done') }).click()

    // Not adding up blocks saving.
    await page.getByRole('button', { name: t('expenses.form.save') }).click()
    await expect(page.getByRole('alert')).toHaveText(t('errors.payers.payers_sum_mismatch'))

    await page.getByRole('button', { name: t('expenses.fields.paidBy') }).click()
    await paidBy(ben.name).fill('30')
    await expect(sheet.getByText(t('expenses.allAssigned'))).toBeVisible()
    await sheet.getByRole('button', { name: t('expenses.payers.done') }).click()
    await save(page, group)

    // The row.
    const row = page.getByRole('link', { name: new RegExp(description) })
    await expect(row).toContainText(
      t('expenses.payers.paidMany', {
        names: `${t('common.you')} ${t('common.and')} ${ben.name}`,
        amount: usd(9000),
      }),
    )
    await expect(row).toContainText(usd(3000))

    // The detail page.
    await openExpense(page, description)
    await expect(
      page.getByText(
        t('expenses.detail.paidByMany', {
          names: `${t('common.youLower')} ${t('common.and')} ${ben.name}`,
        }),
      ),
    ).toBeVisible()
    await expect(
      page.getByText(t('expenses.detail.paidAndShare', { paid: usd(6000), share: usd(3000) })),
    ).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: ben.name })).toContainText(
      t('expenses.detail.paidAndShare', { paid: usd(3000), share: usd(3000) }),
    )

    // The balances: Cleo owes 30, I am owed 30, Ben is square.
    await page.goto(`/groups/${group.id}/balances`)
    await expect(
      page.getByText(t('balances.owesYou', { name: cleo.name, amount: usd(3000) })),
    ).toBeVisible()
    const everyone = page.getByRole('region', { name: t('balances.members') })
    await expect(everyone.getByRole('listitem').filter({ hasText: ben.name })).toContainText(
      t('balances.settledShort'),
    )
    // The CSV.
    await page.goto(`/groups/${group.id}`)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: t('expenses.exportCsv') }).click()
    const file = await download
    const csv = await (await file.createReadStream()).toArray()
    const text = Buffer.concat(csv).toString('utf8')
    // Paid by, then what each of us paid, our share and the balance it leaves.
    expect(text).toContain(
      `,90.00,USD,1,USD,90.00,"${me.name} 60.00; ${ben.name} 30.00",60.00,30.00,30.00,30.00,30.00,0.00,,30.00,-30.00,`,
    )
  })

  test('adjustment split, then the edit shows in the history', async ({ newUser, openAs }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const page = await openAs(me)
    const description = unique('Cabin')

    // 100 between three with +10 on me: 40, 30, 30.
    await startExpense(page, group, '100', description)
    await page.getByRole('radio', { name: t('splitTypes.adjustment.short') }).click()
    await page
      .getByRole('textbox', { name: t('expenses.adjust.of', { name: t('common.you') }) })
      .fill('10')
    await expect(page.getByText(t('expenses.adjust.rest', { amount: usd(9000) }))).toBeVisible()
    await save(page, group)
    await openExpense(page, description)
    await expect(
      page.getByText(t('expenses.detail.paidAndShare', { paid: usd(10000), share: usd(4000) })),
    ).toBeVisible()
    for (const person of [ben, cleo]) {
      await expect(page.getByRole('listitem').filter({ hasText: person.name })).toContainText(
        t('expenses.detail.owes', { amount: usd(3000) }),
      )
    }

    // Edit the amount: the adjustment carries over and the history says what changed.
    await page.getByRole('link', { name: t('common.edit') }).click()
    await expect(page.getByRole('radio', { name: t('splitTypes.adjustment.short') })).toBeChecked()
    await page.getByRole('textbox', { name: t('expenses.fields.amount') }).fill('130')
    await page.getByRole('button', { name: t('expenses.form.saveChanges') }).click()
    await expect(page.getByRole('heading', { level: 1, name: description })).toBeVisible()
    const history = page.getByRole('region', { name: t('expenses.history.title') })
    await expect(
      history.getByText(t('expenses.history.created', { name: t('common.you') })),
    ).toBeVisible()
    await expect(
      history.getByText(t('expenses.history.updated', { name: t('common.you') })),
    ).toBeVisible()
    await expect(
      history.getByText(t('expenses.history.change.amount', { from: usd(10000), to: usd(13000) })),
    ).toBeVisible()
  })

  test('a refund cuts what someone owes', async ({ newUser, openAs }) => {
    const [me, ben] = await Promise.all([
      newUser({ name: unique('Ava') }),
      newUser({ name: unique('Ben') }),
    ])
    const group = await groupWith(me, [ben])
    // I paid 100 for both of us: Ben owes me 50.
    await addEqualExpense(me, group, [me, ben], 10000, unique('Hotel'))
    const page = await openAs(me)
    const description = unique('Deposit back')

    // A 40 refund I received, split between us.
    await startExpense(page, group, '40', description)
    await page.getByRole('switch', { name: t('expenses.refund.label') }).click()
    await expect(page.getByRole('button', { name: t('expenses.payers.receivedBy') })).toBeVisible()
    await expect(
      page
        .getByRole('group', { name: t('expenses.quick.label') })
        .getByRole('button', { name: t('expenses.quick.youPaidEqual') }),
    ).toHaveAttribute('aria-pressed', 'true')
    await save(page, group)

    const row = page.getByRole('link', { name: new RegExp(description) })
    await expect(row).toContainText(t('expenses.refund.youGotBack', { amount: usd(4000) }))
    await expect(row).toContainText(t('expenses.refund.youOweLabel'))

    await page.goto(`/groups/${group.id}/balances`)
    await expect(
      page.getByText(t('balances.owesYou', { name: ben.name, amount: usd(3000) })),
    ).toBeVisible()
  })

  test('an archived group is read only', async ({ newUser, openAs }) => {
    const me = await newUser({ name: unique('Ava') })
    const group = await groupWith(me)
    const old = await addEqualExpense(me, group, [me], 1200, unique('Ferry'))
    await updateGroup(me.client, group.id, { archived_at: new Date().toISOString() })
    const page = await openAs(me)
    await page.goto(`/new/expense?groupId=${group.id}`)
    await expect(page.getByText(t('expenses.form.archivedTitle'))).toBeVisible()
    await expect(page.getByRole('textbox', { name: t('expenses.fields.amount') })).toHaveCount(0)

    // The expense page: no edit, delete or comment box, and the same notice.
    await page.goto(`/expenses/${old.id}`)
    await expect(page.getByText(t('expenses.form.archived', { group: group.name }))).toBeVisible()
    await expect(page.getByRole('link', { name: t('common.edit') })).toHaveCount(0)
    await expect(
      page.getByRole('textbox', { name: t('expenses.comments.placeholder') }),
    ).toHaveCount(0)
    await expect(page.getByRole('heading', { name: t('expenses.comments.title') })).toHaveCount(0)
  })

  test('a slow last currency never changes what was typed', async ({ newUser, openAs }) => {
    const me = await newUser({ name: unique('Ava') })
    const group = await groupWith(me)
    // Last time I paid in euros.
    await addEqualExpense(me, group, [me], 1000, unique('Gelato'), { currency: 'EUR' })
    const page = await openAs(me)
    await page.route('**/rest/v1/expenses?select=currency*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2500))
      await route.continue()
    })
    const description = unique('Bus')
    await page.goto(`/new/expense?groupId=${group.id}`)
    await page.getByRole('textbox', { name: t('expenses.fields.amount') }).fill('25')
    await page.getByRole('textbox', { name: t('expenses.fields.description') }).fill(description)
    await page.waitForTimeout(3000)
    await expect(
      page.getByRole('button', { name: `${t('expenses.fields.currency')}, USD` }),
    ).toBeVisible()
    await save(page, group)
    await expect(page.getByRole('link', { name: new RegExp(description) })).toContainText(usd(2500))
  })

  test('two people: one tap says who owes it all', async ({ newUser, openAs }) => {
    const [me, ben] = await Promise.all([
      newUser({ name: unique('Ava') }),
      newUser({ name: unique('Ben') }),
    ])
    const group = await groupWith(me, [ben])
    const page = await openAs(me)
    const description = unique('Concert')

    await startExpense(page, group, '80', description)
    await page
      .getByRole('group', { name: t('expenses.quick.label') })
      .getByRole('button', { name: t('expenses.quick.theyOweAll', { name: ben.name }) })
      .click()
    await save(page, group)
    await page.goto(`/groups/${group.id}/balances`)
    await expect(
      page.getByText(t('balances.owesYou', { name: ben.name, amount: usd(8000) })),
    ).toBeVisible()
  })

  test('by item reopens with its items, tax and discount', async ({ newUser, openAs }) => {
    const { me, ben, group } = await threePeople(newUser)
    const page = await openAs(me)
    const description = unique('Ramen')

    await page.goto(`/new/expense?groupId=${group.id}`)
    await page.getByRole('textbox', { name: t('expenses.fields.description') }).fill(description)
    await page.getByRole('radio', { name: t('splitTypes.itemized.short') }).click()
    await page
      .getByRole('textbox', { name: t('expenses.itemized.itemName'), exact: true })
      .fill('Tonkotsu')
    await page
      .getByRole('textbox', { name: `${t('expenses.itemized.itemAmount')}, Tonkotsu` })
      .fill('20')
    await page.getByRole('textbox', { name: t('expenses.itemized.tax') }).fill('2')
    await page.getByRole('textbox', { name: t('expenses.itemized.discount') }).fill('1')
    await save(page, group)
    await openExpense(page, description)
    const items = page.getByRole('region', { name: t('expenses.detail.items') })
    await expect(items.getByText('Tonkotsu')).toBeVisible()

    await page.getByRole('link', { name: t('common.edit') }).click()
    await expect(page.getByRole('radio', { name: t('splitTypes.itemized.short') })).toBeChecked()
    await expect(
      page.getByRole('textbox', { name: t('expenses.itemized.itemName'), exact: true }),
    ).toHaveValue('Tonkotsu')
    await expect(page.getByRole('textbox', { name: t('expenses.itemized.tax') })).toHaveValue('2')
    await expect(page.getByRole('textbox', { name: t('expenses.itemized.discount') })).toHaveValue(
      '1',
    )
    void ben
  })

  test('a saved default split and the last currency carry to the next expense', async ({
    newUser,
    openAs,
  }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const other = await groupWith(me, [ben, cleo])
    const page = await openAs(me)

    // Shares 2:1:1, saved as the default; paid in euros.
    await startExpense(page, group, '40', unique('Groceries'))
    await page.getByRole('button', { name: `${t('expenses.fields.currency')}, USD` }).click()
    await page
      .getByRole('dialog', { name: t('expenses.currencyPicker.title') })
      .getByRole('button', { name: /^EUR/ })
      .click()
    await page.getByRole('radio', { name: t('splitTypes.shares.short') }).click()
    await page
      .getByRole('button', { name: t('expenses.splitEditor.more', { name: t('common.you') }) })
      .click()
    await page.getByRole('checkbox', { name: t('expenses.defaultSplit.save') }).click()
    await save(page, group)
    await expect(page.getByText(t('expenses.defaultSplit.saved'))).toBeVisible()

    await page.goto(`/new/expense?groupId=${group.id}`)
    await expect(page.getByRole('radio', { name: t('splitTypes.shares.short') })).toBeChecked()
    await expect(
      page.getByRole('status', {
        name: t('expenses.splitEditor.sharesOf', { name: t('common.you') }),
      }),
    ).toHaveText('2')
    await expect(page.getByText(t('expenses.defaultSplit.active'))).toBeVisible()
    await expect(
      page.getByRole('button', { name: `${t('expenses.fields.currency')}, EUR` }),
    ).toBeVisible()

    // Another group is untouched.
    await page.goto(`/new/expense?groupId=${other.id}`)
    await expect(page.getByRole('radio', { name: t('splitTypes.equal.short') })).toBeChecked()
    await expect(
      page.getByRole('button', { name: `${t('expenses.fields.currency')}, USD` }),
    ).toBeVisible()
  })
})
