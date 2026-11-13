import { firstName, nextOccurrence } from '@potluck/core'
import { formatDate, formatMoney, t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

const usd = (cents: number) => formatMoney(cents, 'USD')
const day = (date: string) => formatDate(date, { timeZone: 'UTC', style: 'weekday' })
const today = () => new Date().toISOString().slice(0, 10)

test.describe('repeating expenses', () => {
  test('rent goes up: the next ones change, the ones already added do not', async ({
    newUser,
    openAs,
  }) => {
    const [me, ben, cleo] = await Promise.all([
      newUser({ name: unique('Ava') }),
      newUser({ name: unique('Ben') }),
      newUser({ name: unique('Cleo') }),
    ])
    const group = await groupWith(me, [ben, cleo])
    const rent = unique('Rent')
    const posted = await addEqualExpense(me, group, [me, ben], 150000, rent, {
      recurrence: 'monthly',
    })

    const page = await openAs(me)
    await page.goto(`/groups/${group.id}`)
    await page.getByRole('button', { name: new RegExp(t('expenses.recurring.title')) }).click()
    await page
      // The series' row reads its name and schedule; the posted copy below reads only the name.
      .getByRole('link', {
        name: new RegExp(`^${rent}\\s*${t('expenses.recurring.every.monthly')},`),
      })
      .click()

    await expect(
      page.getByRole('heading', { name: t('expenses.recurring.editTitle') }),
    ).toBeVisible()
    await expect(page.getByText(t('expenses.recurring.futureOnly'))).toBeVisible()
    const amount = page.getByRole('textbox', { name: t('expenses.fields.amount') })
    await expect(amount).toHaveValue(/^1,?500(\.00)?$/)
    await amount.fill('1600')
    await page.getByRole('button', { name: t('expenses.form.saveChanges') }).click()
    await expect(
      page.getByText(t('expenses.recurring.savedToast', { description: rent })),
    ).toBeVisible()

    // Back on the group: the series is 1600, the expense already added is still 1500.
    await expect(page).toHaveURL(new RegExp(`/groups/${group.id}$`))
    await page.getByRole('button', { name: new RegExp(t('expenses.recurring.title')) }).click()
    await expect(
      page.getByText(
        `${t('expenses.recurring.every.monthly')}, ${t('expenses.paidSummary', {
          name: t('common.you'),
          amount: usd(160000),
        })}`,
      ),
    ).toBeVisible()
    await page.goto(`/expenses/${posted.id}`)
    await expect(page.getByRole('heading', { level: 1, name: rent })).toBeVisible()
    await expect(page.getByText(usd(150000)).first()).toBeVisible()
    const card = page.getByRole('region', { name: t('expenses.recurring.card.title') })
    await expect(card).toContainText(
      t('expenses.recurring.card.next', {
        every: t('expenses.recurring.every.monthly'),
        date: day(nextOccurrence(today(), 'monthly')),
      }),
    )

    // Cleo is in the group but not in the rent: she sees who pays and how it splits, read only.
    const cleoPage = await openAs(cleo)
    await cleoPage.goto(page.url())
    await cleoPage
      .getByRole('region', { name: t('expenses.recurring.card.title') })
      .getByRole('link', { name: t('expenses.recurring.card.view') })
      .click()
    await expect(cleoPage.getByText(t('expenses.recurring.readOnly'))).toBeVisible()
    await expect(
      cleoPage.getByText(
        t('expenses.paidSummary', { name: firstName(me.name), amount: usd(160000) }),
      ),
    ).toBeVisible()
    await expect(
      cleoPage
        .getByRole('region', { name: t('expenses.fields.splitBetween') })
        .getByRole('listitem'),
    ).toHaveCount(2)
    await expect(cleoPage.getByRole('textbox', { name: t('expenses.fields.amount') })).toHaveCount(
      0,
    )
  })

  test('an expense starts repeating every 2 weeks, then skips one', async ({ newUser, openAs }) => {
    const [me, ben] = await Promise.all([
      newUser({ name: unique('Ava') }),
      newUser({ name: unique('Ben') }),
    ])
    const group = await groupWith(me, [ben])
    const cleaner = unique('Cleaner')
    const expense = await addEqualExpense(me, group, [me, ben], 6000, cleaner)

    const page = await openAs(me)
    await page.goto(`/expenses/${expense.id}`)
    await page.getByRole('button', { name: t('expenses.recurring.make.action') }).click()
    const sheet = page.getByRole('dialog', { name: t('expenses.recurring.make.title') })
    await sheet.getByRole('radio', { name: t('expenses.recurrence.biweekly') }).click()
    const first = nextOccurrence(today(), 'biweekly')
    await expect(sheet).toContainText(t('expenses.recurring.make.first', { date: day(first) }))
    await sheet.getByRole('button', { name: t('expenses.recurring.make.confirm') }).click()
    await expect(
      page.getByText(
        t('expenses.recurring.make.doneToast', { description: cleaner, date: day(first) }),
      ),
    ).toBeVisible()

    const card = page.getByRole('region', { name: t('expenses.recurring.card.title') })
    await expect(card).toContainText(
      t('expenses.recurring.card.next', {
        every: t('expenses.recurring.every.biweekly'),
        date: day(first),
      }),
    )
    await card.getByRole('link', { name: t('expenses.recurring.card.edit') }).click()

    const actions = page.getByRole('group', { name: t('expenses.recurring.actions') })
    await actions.getByRole('button', { name: t('expenses.recurring.skip') }).click()
    const dialog = page.getByRole('dialog', { name: t('expenses.recurring.skipTitle') })
    const after = nextOccurrence(first, 'biweekly')
    await expect(dialog).toContainText(day(after))
    await dialog.getByRole('button', { name: t('expenses.recurring.skip') }).click()
    await expect(
      page.getByText(
        t('expenses.recurring.skippedToast', { description: cleaner, date: day(after) }),
      ),
    ).toBeVisible()
    await expect(page.getByLabel(t('expenses.recurring.nextLabel'), { exact: true })).toHaveValue(
      after,
    )
  })
})
