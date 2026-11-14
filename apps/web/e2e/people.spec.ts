import { readFile } from 'node:fs/promises'
import {
  addFriend,
  addPlaceholderMember,
  blockUser,
  createExpense,
  fetchMyFriendLink,
  getOrCreateDirectGroup,
  removePlaceholder,
} from '@potluck/api'
import { formatMoney, t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, PASSWORD, test, unique } from './support/fixtures'

test('add Sam by name, split with him, and Sam signs up through his invite to find it all', async ({
  newUser,
  openAs,
}) => {
  const ava = await newUser({ name: unique('Ava') })
  const group = await groupWith(ava, [], { name: unique('Roommates') })
  const samName = unique('Sam')
  const samEmail = `${samName.toLowerCase()}@potluck.test`

  // Ava adds Sam, who is not on Potluck yet.
  const page = await openAs(ava)
  await page.goto(`/groups/${group.id}/members`)
  await page.getByRole('button', { name: new RegExp(t('people.placeholder.add')) }).click()
  const sheet = page.getByRole('dialog', { name: t('people.placeholder.addTitle') })
  await sheet.getByLabel(t('people.placeholder.nameLabel')).fill(samName)
  await sheet.getByLabel(t('people.placeholder.emailLabel')).fill(samEmail)
  await sheet.getByRole('button', { name: t('people.placeholder.submit'), exact: true }).click()
  await expect(
    page.getByText(t('people.placeholder.addedInvited', { name: samName })),
  ).toBeVisible()
  const row = page.getByRole('listitem').filter({ hasText: samName })
  await expect(row.getByText(t('people.placeholder.badge'))).toBeVisible()

  // Split with him right away.
  const { data: seat } = await ava.client
    .from('placeholders')
    .select('profile_id')
    .eq('group_id', group.id)
    .single()
  const samSeat = seat!.profile_id
  const rent = unique('Rent')
  await createExpense(ava.client, {
    group_id: group.id,
    description: rent,
    amount_cents: 3000,
    currency: 'USD',
    paid_by: ava.id,
    split_type: 'equal',
    splits: [{ user_id: ava.id }, { user_id: samSeat }],
    spent_at: new Date().toISOString().slice(0, 10),
  })
  const half = formatMoney(1500, 'USD')
  await page.goto(`/groups/${group.id}/balances`)
  await expect(page.getByText(t('balances.owesYou', { name: samName, amount: half }))).toBeVisible()

  // Sam opens the link from his invite email and signs up with that address.
  const { data: link } = await ava.client
    .from('group_invites')
    .select('code')
    .eq('placeholder_id', samSeat)
    .is('revoked_at', null)
    .single()
  const sam = await openAs(null)
  await sam.goto(`/join/${link!.code}`)
  await expect(sam.getByText(t('people.claim.title'))).toBeVisible()
  await expect(sam.getByRole('heading', { name: group.name })).toBeVisible()
  await sam.getByRole('link', { name: t('people.claim.signUp') }).click()
  await expect(sam).toHaveURL(/\/sign-up/)
  await sam.getByLabel(t('auth.fields.name')).fill(samName)
  await sam.getByLabel(t('auth.fields.email')).fill(samEmail)
  await sam.getByLabel(t('auth.fields.password'), { exact: true }).fill(PASSWORD)
  await sam.getByRole('button', { name: t('auth.signUp.submit') }).click()
  await expect(sam).toHaveURL(/\/welcome/)
  await sam.getByRole('button', { name: t('onboarding.profile.save') }).click()

  // Confirming the email took the seat: he is already in, with his history.
  await expect(sam.getByText(t('invites.join.alreadyMember', { group: group.name }))).toBeVisible()
  await sam.getByRole('link', { name: t('invites.join.open') }).click()
  await expect(sam).toHaveURL(new RegExp(`/groups/${group.id}`))
  await expect(sam.getByRole('link', { name: new RegExp(rent) })).toBeVisible()
  await sam.goto(`/groups/${group.id}/balances`)
  await expect(sam.getByText(t('balances.youOwe', { name: ava.name, amount: half }))).toBeVisible()

  // Ava sees Sam as a member now, no longer a saved seat.
  await page.goto(`/groups/${group.id}/members`)
  const member = page.getByRole('listitem').filter({ hasText: samName })
  await expect(member).toBeVisible()
  await expect(member.getByText(t('people.placeholder.badge'))).toHaveCount(0)
})

test('a friend link makes friends; blocking ends it and Unblock is on Me', async ({
  newUser,
  openAs,
}) => {
  const [ava, cleo] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Cleo') }),
  ])
  const code = await fetchMyFriendLink(ava.client)

  const page = await openAs(cleo)
  await page.goto(`/friend/${code}`)
  await expect(
    page.getByRole('heading', { name: t('people.friendJoin.title', { name: ava.name }) }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: t('people.friendJoin.accept', { name: ava.name }) })
    .click()
  await expect(page).toHaveURL(new RegExp(`/friends/${ava.id}`))
  await expect(page.getByRole('heading', { name: ava.name, level: 1 })).toBeVisible()
  await expect(page.getByText(t('people.friendPage.historyEmpty'))).toBeVisible()

  await page.getByRole('button', { name: t('people.friendPage.menu', { name: ava.name }) }).click()
  await page
    .getByRole('button', { name: new RegExp(t('people.friendPage.block', { name: ava.name })) })
    .click()
  await page
    .getByRole('dialog', { name: t('people.friendPage.block', { name: ava.name }) })
    .getByRole('button', { name: t('members.block') })
    .click()
  await expect(page).toHaveURL(/\/friends$/)
  await expect(page.getByText(t('friends.empty.title'))).toBeVisible()

  await page.goto('/me')
  await page
    .getByRole('button', { name: t('people.blocked.unblockName', { name: ava.name }) })
    .click()
  await expect(page.getByText(t('people.blocked.unblocked', { name: ava.name }))).toBeVisible()
  await expect(page.getByText(t('settings.privacy.noneBlocked'))).toBeVisible()
})

test('Ava records that Pat, not on Potluck yet, paid her, then removes the settled seat', async ({
  newUser,
  openAs,
}) => {
  const ava = await newUser({ name: unique('Ava') })
  const group = await groupWith(ava, [], { name: unique('Cabin') })
  const patName = unique('Pat')
  const pat = await addPlaceholderMember(ava.client, { groupId: group.id, displayName: patName })
  await createExpense(ava.client, {
    group_id: group.id,
    description: unique('Firewood'),
    amount_cents: 2000,
    currency: 'USD',
    paid_by: ava.id,
    split_type: 'equal',
    splits: [{ user_id: ava.id }, { user_id: pat }],
    spent_at: new Date().toISOString().slice(0, 10),
  })

  const page = await openAs(ava)
  await page.goto(`/groups/${group.id}/balances`)
  const owed = t('balances.owesYou', { name: patName, amount: formatMoney(1000, 'USD') })
  const row = page.getByRole('listitem').filter({ hasText: owed })
  await row.getByRole('link', { name: t('settle.recordPayment') }).click()
  await expect(page).toHaveURL(/\/new\/settle/)
  await page.getByRole('button', { name: t('settle.recordPayment') }).click()

  await page.goto(`/groups/${group.id}/balances`)
  await expect(page.getByText(t('balances.youAreSquare'))).toBeVisible()
  await removePlaceholder(ava.client, pat)
  await page.goto(`/groups/${group.id}/members`)
  await expect(page.getByRole('listitem').filter({ hasText: patName })).toHaveCount(0)
})

test("a friend's page shows only what is between you two, exports it, and a block stops new expenses", async ({
  newUser,
  openAs,
}) => {
  const [ava, jules, owen] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Jules') }),
    newUser({ name: unique('Owen') }),
  ])
  const group = await groupWith(ava, [jules, owen])
  await addFriend(ava.client, jules.id)
  // Ava paid 90 for the three of them: she is up 60, but only 30 of it is Jules's.
  const dinner = unique('Dinner')
  await addEqualExpense(ava, group, [ava, jules, owen], 9000, dinner)
  // Owen paid 60 for the three: Ava and Jules each owe Owen, not each other.
  const taxi = unique('Taxi')
  await addEqualExpense(owen, group, [ava, jules, owen], 6000, taxi)

  const page = await openAs(ava)
  await page.goto(`/friends/${jules.id}`)
  const history = page.getByRole('region', { name: t('people.friendPage.history') })
  await expect(
    history
      .getByRole('link', { name: new RegExp(dinner) })
      .getByText(t('expenses.youLent', { amount: formatMoney(3000, 'USD') })),
  ).toBeAttached()
  await expect(
    history
      .getByRole('link', { name: new RegExp(taxi) })
      .getByText(t('people.friendPage.nothingBetween')),
  ).toBeVisible()

  await page
    .getByRole('button', { name: t('people.friendPage.menu', { name: jules.name }) })
    .click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: new RegExp(t('people.friendPage.export')) }).click()
  const csv = await readFile((await (await download).path())!, 'utf8')
  expect(csv).toContain(t('transfer.csv.between', { name: jules.name }))
  expect(csv).toContain(dinner)

  // Their 1:1 tab, from before the block: Jules covered lunch, so Ava owes him.
  const tab = await getOrCreateDirectGroup(ava.client, jules.id)
  await addEqualExpense(jules, { id: tab, name: '' }, [ava, jules], 2000, unique('Lunch'))

  await blockUser(jules.client, ava.id)
  await page.reload()
  const add = page.getByRole('button', { name: t('people.friendPage.addExpense') })
  await expect(add).toBeDisabled()
  await expect(page.getByText(t('errors.codes.not_a_friend'))).toBeVisible()

  // The tab itself offers no new expense either, with the same reason, but settling up stays.
  await page.goto(`/groups/${tab}`)
  await expect(page.getByText(t('errors.codes.not_a_friend'))).toBeVisible()
  await expect(page.getByRole('link', { name: t('expenses.add') })).toHaveCount(0)
  await page
    .getByRole('button', { name: t('nav.add') })
    .filter({ visible: true })
    .click()
  const quickAdd = page.getByRole('dialog', { name: t('nav.quickAdd.title') })
  await expect(
    quickAdd.getByRole('link', { name: new RegExp(t('nav.quickAdd.expense')) }),
  ).toHaveAttribute('aria-disabled', 'true')
  await expect(
    quickAdd.getByRole('link', { name: new RegExp(t('nav.quickAdd.settle')) }),
  ).toHaveAttribute('href', `/new/settle?groupId=${tab}`)
  await page.keyboard.press('Escape')
  await page.goto(`/groups/${tab}/balances`)
  await expect(page.getByRole('link', { name: t('balances.settleUp') })).toBeVisible()

  // In the group they share, someone else splitting with both of them is told so on the form.
  const owenPage = await openAs(owen)
  await owenPage.goto(`/new/expense?groupId=${group.id}`)
  await owenPage.getByRole('textbox', { name: t('expenses.fields.amount') }).fill('30')
  await owenPage
    .getByRole('textbox', { name: t('expenses.fields.description') })
    .fill(unique('Brunch'))
  await owenPage.getByRole('button', { name: t('expenses.form.save') }).click()
  await expect(owenPage.getByText(t('expenses.errors.blocked_person'))).toBeVisible()
})
