import { t } from '@potluck/i18n'
import { expect, test, unique } from './support/fixtures'

test('create a group, share an invite, and a signed out friend joins', async ({
  newUser,
  openAs,
}) => {
  const [owner, friend] = await Promise.all([newUser(), newUser()])
  const page = await openAs(owner)

  await page.goto('/groups')
  await expect(page.getByRole('heading', { level: 1, name: t('groups.title') })).toBeVisible()
  await page
    .getByRole('button', { name: t('groups.new') })
    .filter({ visible: true })
    .first()
    .click()

  const groupName = unique('Cabin trip')
  const sheet = page.getByRole('dialog', { name: t('groups.create.title') })
  await sheet.getByLabel(t('groups.create.nameLabel')).fill(groupName)
  await sheet.getByLabel(t('groups.create.currencyLabel')).selectOption('USD')
  await sheet.getByRole('button', { name: t('groups.create.submit') }).click()

  // A new group opens on its members tab with the invite panel right there. One tap makes a
  // link with the default settings, and the newest link sits on top ready to copy.
  await expect(page).toHaveURL(/\/groups\/[^/]+\/members$/)
  await expect(page.getByRole('heading', { name: groupName })).toBeVisible()
  const invites = page.getByRole('region', { name: t('members.alone.title') })
  await expect(invites.getByRole('button', { name: t('invites.settings') })).toBeVisible()
  await invites.getByRole('button', { name: t('invites.create') }).click()
  const latest = invites.getByRole('region', { name: t('invites.latest') })
  const link = latest.getByText(/\/join\//)
  await expect(link).toBeVisible()
  await expect(latest.getByRole('button', { name: t('invites.copyLink') })).toBeVisible()
  const code = /\/join\/(\S+)/.exec((await link.textContent()) ?? '')?.[1]
  expect(code).toBeTruthy()

  // The friend opens the link signed out, signs in and accepts.
  const guest = await openAs(null)
  await guest.goto(`/join/${code}`)
  await expect(guest.getByText(groupName).first()).toBeVisible()
  await guest.getByRole('link', { name: t('invites.join.signInToJoin') }).click()

  await expect(guest).toHaveURL(/\/sign-in/)
  await guest.getByLabel(t('auth.fields.email')).fill(friend.email)
  await guest.getByLabel(t('auth.fields.password'), { exact: true }).fill(friend.password)
  await guest.getByRole('button', { name: t('auth.signIn.submit') }).click()

  await expect(guest).toHaveURL(new RegExp(`/join/${code}`))
  await guest.getByRole('button', { name: t('invites.join.accept', { group: groupName }) }).click()
  await expect(guest).toHaveURL(/\/groups\/[^/]+$/, { timeout: 15_000 })

  // The owner sees the new member.
  await page.reload()
  await expect(page.getByText(friend.name).first()).toBeVisible()
})
