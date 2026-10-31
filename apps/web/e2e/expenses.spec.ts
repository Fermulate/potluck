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

async function saveAndOpen(page: Page, group: TestGroup, description: string) {
  await page.getByRole('button', { name: t('expenses.form.save') }).click()
  await expect(page).toHaveURL(new RegExp(`/groups/${group.id}$`))
  await page.getByRole('link', { name: new RegExp(description) }).click()
  await expect(page.getByRole('heading', { level: 1, name: description })).toBeVisible()
}

/** Each person's line on the expense detail page. */
async function expectShares(page: Page, payer: TestUser, shares: [TestUser, number][]) {
  for (const [user, cents] of shares) {
    if (user.id === payer.id) {
      // The payer's own line reads "You".
      const line = t('expenses.detail.paidAndOwes', { amount: usd(cents) })
      await expect(page.getByRole('listitem').filter({ hasText: line })).toHaveCount(1)
    } else {
      const row = page.getByRole('listitem').filter({ hasText: user.name })
      await expect(row).toContainText(t('expenses.detail.owes', { amount: usd(cents) }))
    }
  }
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

test.describe('expenses', () => {
  test('equal split, then edit the amount', async ({ newUser, openAs }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const page = await openAs(me)
    const description = unique('Groceries')

    await startExpense(page, group, '90', description)
    await page.getByRole('radio', { name: t('splitTypes.equal.label') }).click()
    await saveAndOpen(page, group, description)
    await expectShares(page, me, [
      [me, 3000],
      [ben, 3000],
      [cleo, 3000],
    ])

    await page.getByRole('link', { name: t('common.edit') }).click()
    await expect(page.getByRole('heading', { name: t('expenses.form.editTitle') })).toBeVisible()
    await page.getByRole('textbox', { name: t('expenses.fields.amount') }).fill('120')
    await page.getByRole('button', { name: t('expenses.form.saveChanges') }).click()
    await expect(page.getByRole('heading', { level: 1, name: description })).toBeVisible()
    await expectShares(page, me, [
      [me, 4000],
      [ben, 4000],
      [cleo, 4000],
    ])
  })

  test('exact amounts', async ({ newUser, openAs }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const page = await openAs(me)
    const description = unique('Tickets')

    await startExpense(page, group, '100', description)
    await page.getByRole('radio', { name: t('splitTypes.exact.label') }).click()
    const amountOf = (name: string) =>
      page.getByRole('textbox', { name: t('expenses.splitEditor.amountOf', { name }) })
    await amountOf(t('common.you')).fill('50')
    await amountOf(ben.name).fill('30')
    await expect(page.getByText(t('expenses.remaining', { amount: usd(2000) }))).toBeVisible()
    await amountOf(cleo.name).fill('20')
    await expect(page.getByText(t('expenses.allAssigned'))).toBeVisible()
    await saveAndOpen(page, group, description)
    await expectShares(page, me, [
      [me, 5000],
      [ben, 3000],
      [cleo, 2000],
    ])
  })

  test('percentages', async ({ newUser, openAs }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const page = await openAs(me)
    const description = unique('Cabin')

    await startExpense(page, group, '200', description)
    await page.getByRole('radio', { name: t('splitTypes.percent.label') }).click()
    const mine = page.getByRole('textbox', {
      name: t('expenses.splitEditor.percentOf', { name: t('common.you') }),
    })
    await mine.fill('50')
    await mine.press('Tab')
    await expect(page.getByText('100% / 100%')).toBeVisible()
    await saveAndOpen(page, group, description)
    await expectShares(page, me, [
      [me, 10000],
      [ben, 5000],
      [cleo, 5000],
    ])
  })

  test('shares', async ({ newUser, openAs }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const page = await openAs(me)
    const description = unique('Gas')

    await startExpense(page, group, '60', description)
    await page.getByRole('radio', { name: t('splitTypes.shares.label') }).click()
    // Everyone starts on one share: Ben goes to two, Cleo to three.
    await page
      .getByRole('button', { name: t('expenses.splitEditor.more', { name: ben.name }) })
      .click()
    const cleoMore = page.getByRole('button', {
      name: t('expenses.splitEditor.more', { name: cleo.name }),
    })
    await cleoMore.click()
    await cleoMore.click()
    await expect(
      page.getByRole('status', { name: t('expenses.splitEditor.sharesOf', { name: cleo.name }) }),
    ).toHaveText('3')
    await saveAndOpen(page, group, description)
    await expectShares(page, me, [
      [me, 1000],
      [ben, 2000],
      [cleo, 3000],
    ])
  })

  test('itemized bill', async ({ newUser, openAs }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const page = await openAs(me)
    const description = unique('Dim sum')

    await page.goto(`/new/expense?groupId=${group.id}`)
    await page.getByRole('textbox', { name: t('expenses.fields.description') }).fill(description)
    await page.getByRole('radio', { name: t('splitTypes.itemized.label') }).click()

    // Dumplings for Ben only.
    await page
      .getByRole('textbox', { name: t('expenses.itemized.itemName'), exact: true })
      .fill('Dumplings')
    await page
      .getByRole('textbox', { name: `${t('expenses.itemized.itemAmount')}, Dumplings` })
      .fill('30')
    const dumplings = page.getByRole('group', {
      name: t('expenses.itemizedEditor.assign', { item: 'Dumplings' }),
    })
    await dumplings.getByRole('button', { name: t('common.you') }).click()
    await dumplings.getByRole('button', { name: cleo.name }).click()

    // Noodles shared by me and Cleo.
    await page.getByRole('button', { name: t('expenses.itemized.addItem') }).click()
    await page
      .getByRole('textbox', { name: t('expenses.itemized.itemName'), exact: true })
      .last()
      .fill('Noodles')
    await page
      .getByRole('textbox', { name: `${t('expenses.itemized.itemAmount')}, Noodles` })
      .fill('20')
    const noodles = page.getByRole('group', {
      name: t('expenses.itemizedEditor.assign', { item: 'Noodles' }),
    })
    await noodles.getByRole('button', { name: ben.name }).click()

    await saveAndOpen(page, group, description)
    await expectShares(page, me, [
      [me, 1000],
      [ben, 3000],
      [cleo, 1000],
    ])
  })

  test('delete with undo', async ({ newUser, openAs }) => {
    const { me, ben, cleo, group } = await threePeople(newUser)
    const description = unique('Firewood')
    await addEqualExpense(me, group, [me, ben, cleo], 4500, description)
    const page = await openAs(me)

    await page.goto(`/groups/${group.id}`)
    await page.getByRole('link', { name: new RegExp(description) }).click()
    await page.getByRole('button', { name: t('common.delete') }).click()
    await page
      .getByRole('dialog', { name: t('common.delete') })
      .getByRole('button', { name: t('common.delete') })
      .click()

    const toast = page.getByText(t('expenses.deleted'))
    await expect(toast).toBeVisible()
    await page.getByRole('button', { name: t('common.undo') }).click()
    await expect(page.getByText(t('expenses.restored'))).toBeVisible()

    await page.goto(`/groups/${group.id}`)
    await expect(page.getByRole('link', { name: new RegExp(description) })).toBeVisible()
  })
})
