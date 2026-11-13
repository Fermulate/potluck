import { formatMoney, t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

const usd = (cents: number) => formatMoney(cents, 'USD')

function daysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

test('recording "Ben paid me" on a past day moves both balances and tells Ben', async ({
  newUser,
  openAs,
}) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])
  // I paid 40 for both of us, so Ben owes me 20.
  await addEqualExpense(me, group, [me, ben], 4000, unique('Groceries'))

  const page = await openAs(me)
  await page.goto(`/new/settle?groupId=${group.id}`)
  await page.getByRole('button', { name: new RegExp(ben.name) }).click()
  await expect(
    page.getByRole('heading', { name: t('settle.receiving', { name: ben.name }) }),
  ).toBeVisible()
  await expect(page.getByRole('textbox', { name: t('settle.amount') })).toHaveValue('20')

  await page.getByLabel(t('settle.date')).fill(daysAgo(3))
  await page.getByRole('button', { name: t('settle.recordPayment') }).click()
  await expect(page.getByText(t('settle.settledTitle', { name: ben.name }))).toBeVisible()

  await page.goto(`/groups/${group.id}/balances`)
  await expect(page.getByText(t('balances.youAreSquare'))).toBeVisible()

  const bens = await openAs(ben)
  await bens.goto('/notifications')
  await expect(
    bens.getByText(
      t('notifications.types.settlement.sent.body', { payee: me.name, amount: usd(2000) }),
    ),
  ).toBeVisible()
})

test('a payment can be commented on, deleted and restored from its page', async ({
  newUser,
  openAs,
}) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])
  await addEqualExpense(ben, group, [me, ben], 3000, unique('Pizza'))

  const page = await openAs(me)
  await page.goto(`/new/settle?groupId=${group.id}&to=${ben.id}`)
  await page.getByRole('button', { name: t('settle.recordPayment') }).click()
  await expect(page.getByText(t('settle.settledTitle', { name: ben.name }))).toBeVisible()

  await page.goto(`/groups/${group.id}`)
  await page
    .getByRole('link', {
      name: new RegExp(t('settle.youPaid', { name: ben.name, amount: '' }).trim()),
    })
    .click()
  await expect(page).toHaveURL(/\/payments\//)
  const paymentUrl = page.url()
  await expect(page.getByRole('heading', { level: 1 })).toContainText(ben.name)

  await page.getByRole('textbox', { name: t('expenses.comments.placeholder') }).fill('Paid in cash')
  await page.getByRole('button', { name: t('expenses.comments.send') }).click()
  await expect(page.getByText('Paid in cash')).toBeVisible()

  await page.getByRole('button', { name: t('settle.delete') }).click()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: t('settle.delete') })
    .click()
  await expect(page.getByText(t('settle.deleted'))).toBeVisible()
  await page.goto(`/groups/${group.id}/balances`)
  await expect(page.getByText(t('balances.youAreSquare'))).toBeHidden()

  await page.goto(paymentUrl)
  await expect(page.getByText(t('settle.detail.deletedBanner'))).toBeVisible()
  await expect(page.getByText('Paid in cash')).toBeVisible()
  await page.getByRole('button', { name: t('settle.restore') }).click()
  await expect(page.getByText(t('settle.restored'))).toBeVisible()
  await expect(page.getByText(t('settle.detail.deletedBanner'))).toBeHidden()

  await page.goto(`/groups/${group.id}/balances`)
  await expect(page.getByText(t('balances.youAreSquare'))).toBeVisible()
})

test('a saved PayPal.me handle becomes a prefilled pay button for whoever owes', async ({
  newUser,
  openAs,
}) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])
  await addEqualExpense(ben, group, [me, ben], 4000, unique('Tickets'))
  const handle = `ben${Date.now().toString(36)}`.slice(0, 20)

  // Ben saves his handle on Me.
  const bens = await openAs(ben)
  await bens.goto('/me')
  await bens.getByRole('button', { name: t('settings.paymentMethods.add') }).click()
  const sheet = bens.getByRole('dialog', { name: t('settings.paymentMethods.add') })
  await sheet.getByRole('radio', { name: t('settle.apps.paypal') }).click()
  await sheet.getByLabel(t('settings.paymentMethods.handle.paypal')).fill(`paypal.me/${handle}`)
  await sheet.getByRole('button', { name: t('settings.paymentMethods.save') }).click()
  await expect(
    bens.getByText(t('settings.paymentMethods.saved', { app: t('settle.apps.paypal') })),
  ).toBeVisible()
  await expect(bens.getByText(`paypal.me/${handle}`)).toBeVisible()

  // I owe Ben 20: the settle screen offers his PayPal with the amount filled in.
  const page = await openAs(me)
  await page.context().route(/paypal\.me/, (route) => route.abort())
  await page.goto(`/new/settle?groupId=${group.id}&to=${ben.id}`)
  const pay = page.getByRole('link', {
    name: t('settle.payWith', { app: t('settle.apps.paypal') }),
  })
  await expect(pay).toHaveAttribute('href', `https://paypal.me/${handle}/20.00USD`)
  await pay.click()
  const confirm = page.getByRole('dialog', { name: t('settle.confirmTitle') })
  await confirm.getByRole('button', { name: t('settle.confirmYes') }).click()
  await expect(page.getByText(t('settle.settledTitle', { name: ben.name }))).toBeVisible()
})

test('Remind sends one nudge a day and says so the second time', async ({ newUser, openAs }) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])
  await addEqualExpense(me, group, [me, ben], 5000, unique('Rent'))

  const page = await openAs(me)
  await page.goto(`/groups/${group.id}/balances`)
  const remind = page.getByRole('button', { name: t('balances.remindLabel', { name: ben.name }) })
  await remind.click()
  await expect(page.getByText(t('balances.remindSent', { name: ben.name }))).toBeVisible()
  await expect(remind).toContainText(t('balances.reminded'))
  await remind.click()
  await expect(page.getByText(t('balances.alreadyReminded', { name: ben.name }))).toBeVisible()

  const bens = await openAs(ben)
  await bens.goto('/notifications')
  await expect(bens.getByText(t('notifications.types.debt.reminder.title'))).toBeVisible()
})

test('settling with a friend across three groups records three payments', async ({
  newUser,
  openAs,
}) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const groups = await Promise.all([
    groupWith(me, [ben]),
    groupWith(me, [ben]),
    groupWith(me, [ben]),
  ])
  for (const [i, group] of groups.entries()) {
    await addEqualExpense(me, group, [me, ben], 1000 * (i + 1), unique('Dinner'))
  }

  const page = await openAs(ben)
  await page.goto('/friends')
  await page
    .getByRole('button', { name: t('friends.settle.actionLabel', { name: me.name }) })
    .click()
  const sheet = page.getByRole('dialog', { name: t('friends.settle.title', { name: me.name }) })
  await sheet.getByRole('button', { name: t('friends.settle.record', { count: 3 }) }).click()
  await expect(page.getByText(t('friends.settle.done', { name: me.name }))).toBeVisible()

  for (const group of groups) {
    await page.goto(`/groups/${group.id}/balances`)
    await expect(page.getByText(t('balances.youAreSquare'))).toBeVisible()
  }
})
