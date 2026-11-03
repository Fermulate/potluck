import { t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

test('owner promotes an admin and removes a settled member; others see less', async ({
  newUser,
  openAs,
}) => {
  const [owner, ben, cleo, dev] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
    newUser({ name: unique('Cleo') }),
    newUser({ name: unique('Dev') }),
  ])
  const group = await groupWith(owner, [ben, cleo, dev])
  // Ben owes money, so he cannot be removed; Cleo is settled.
  await addEqualExpense(owner, group, [owner, ben], 2000)

  const page = await openAs(owner)
  await page.goto(`/groups/${group.id}/members`)
  const rowOf = (name: string) =>
    page.getByRole('main').getByRole('listitem').filter({ hasText: name })

  // Promote Ben.
  await page.getByRole('button', { name: t('members.actions', { name: ben.name }) }).click()
  const benSheet = page.getByRole('dialog', { name: ben.name })
  await expect(
    benSheet.getByRole('button', { name: new RegExp(t('members.remove')) }),
  ).toBeDisabled()
  await benSheet.getByRole('button', { name: new RegExp(t('members.makeAdmin')) }).click()
  await page
    .getByRole('dialog', { name: t('members.makeAdmin') })
    .getByRole('button', { name: t('common.confirm') })
    .click()
  await expect(rowOf(ben.name)).toContainText(t('roles.admin.label'))

  // Remove Cleo.
  await page.getByRole('button', { name: t('members.actions', { name: cleo.name }) }).click()
  await page
    .getByRole('dialog', { name: cleo.name })
    .getByRole('button', { name: new RegExp(t('members.remove')) })
    .click()
  await page
    .getByRole('dialog', { name: t('members.remove') })
    .getByRole('button', { name: t('common.remove') })
    .click()
  await expect(page.getByText(t('members.removed', { name: cleo.name }))).toBeVisible()
  await expect(rowOf(cleo.name)).toHaveCount(0)

  // An admin can manage members but cannot hand over the group.
  const admin = await openAs(ben)
  await admin.goto(`/groups/${group.id}/members`)
  await admin.getByRole('button', { name: t('members.actions', { name: dev.name }) }).click()
  const devSheet = admin.getByRole('dialog', { name: dev.name })
  await expect(devSheet).toBeVisible()
  await expect(
    devSheet.getByRole('button', { name: new RegExp(t('members.makeOwner')) }),
  ).toHaveCount(0)

  // A plain member gets no member actions, and no way to delete the group.
  const member = await openAs(dev)
  await member.goto(`/groups/${group.id}/members`)
  await expect(member.getByText(owner.name).first()).toBeVisible()
  await expect(
    member.getByRole('button', {
      name: new RegExp(`^${t('members.actions', { name: '' }).trim()}`),
    }),
  ).toHaveCount(0)
  await member.goto(`/groups/${group.id}/settings`)
  await expect(member.getByText(t('groups.settings.readOnly'))).toBeVisible()
  await expect(member.getByRole('button', { name: t('groups.settings.delete') })).toHaveCount(0)
})
