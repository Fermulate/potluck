import { formatMoney, t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

test('balances follow expenses and settling up squares them', async ({ newUser, openAs }) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])
  // Ben paid 60 for both of us, so I owe him 30.
  await addEqualExpense(ben, group, [me, ben], 6000, unique('Pizza'))
  const owed = formatMoney(3000, 'USD')

  const page = await openAs(me)
  await page.goto(`/groups/${group.id}/balances`)
  // The group header also reads "You owe ..."; the total is the paragraph on the tab.
  await expect(
    page.getByRole('paragraph').filter({ hasText: new RegExp(`^${t('balances.youOweTotal')}$`) }),
  ).toBeVisible()
  await expect(page.getByText(t('balances.youOwe', { name: ben.name, amount: owed }))).toBeVisible()

  await page
    .getByRole('link', { name: t('balances.settleUp') })
    .first()
    .click()
  await expect(page).toHaveURL(/\/new\/settle/)
  await expect(
    page.getByRole('heading', { name: t('settle.paying', { name: ben.name }) }),
  ).toBeVisible()
  await page.getByRole('button', { name: t('settle.recordPayment') }).click()

  await expect(page.getByText(t('settle.settledTitle', { name: ben.name }))).toBeVisible()
  await page.getByRole('button', { name: t('settle.backToGroup', { group: group.name }) }).click()

  await page.goto(`/groups/${group.id}/balances`)
  await expect(page.getByText(t('balances.youAreSquare'))).toBeVisible()
  await expect(page.getByText(formatMoney(0, 'USD')).first()).toBeVisible()

  await page.goto('/activity')
  await expect(
    page.getByRole('link', { name: new RegExp(`paid ${ben.name}.*\\${owed}`, 'i') }).first(),
  ).toBeVisible()
})
