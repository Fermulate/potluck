import { settleUp } from '@potluck/api'
import { t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

const pushSwitch = (category: 'payments' | 'expense_added') =>
  t('settings.notificationPrefs.channel', {
    category: t(`settings.notificationPrefs.categories.${category}.label`),
    channel: t('settings.notificationPrefs.push'),
  })

test('payment pushes turned off on the Me page stay off, and payments still reach the inbox', async ({
  newUser,
  openAs,
}) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])

  const page = await openAs(me)
  await page.goto('/me')
  await expect(
    page.getByRole('heading', { name: t('settings.notificationPrefs.title') }),
  ).toBeVisible()
  // Email is off on this server, so only push can be chosen for now.
  await expect(page.getByText(t('settings.notificationPrefs.emailSoon'))).toBeVisible()
  const payments = page.getByRole('switch', { name: pushSwitch('payments') })
  await expect(payments).toBeChecked()
  await payments.click()
  await expect(payments).not.toBeChecked()

  await page.reload()
  await expect(page.getByRole('switch', { name: pushSwitch('payments') })).not.toBeChecked()
  await expect(page.getByRole('switch', { name: pushSwitch('expense_added') })).toBeChecked()

  // Ben pays Ava back and adds an expense with her.
  await settleUp(ben.client, { groupId: group.id, toUser: me.id, amountCents: 1500 })
  const lunch = unique('Lunch')
  await addEqualExpense(ben, group, [me, ben], 2000, lunch)

  await page.goto('/notifications')
  await expect(
    page.getByText(t('notifications.types.settlement.created.title'), { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText(t('notifications.types.expense.created.title', { group: group.name })),
  ).toBeVisible()

  // The inbox has both, but only the expense went out as a push.
  const { data, error } = await me.client
    .from('notifications')
    .select('type, channels')
    .in('type', ['settlement.created', 'expense.created'])
    .order('type')
  expect(error).toBeNull()
  expect(data).toEqual([
    { type: 'expense.created', channels: ['push'] },
    { type: 'settlement.created', channels: [] },
  ])
})
