import { t } from '@potluck/i18n'
import type { Page } from '@playwright/test'
import { expireGuestLink, groupWith, guestLinkFor, pollIn } from './support/api'
import { expect, test, unique } from './support/fixtures'

/** Paints the first two free cells of the guest grid with the keyboard. */
async function paintTwo(page: Page, title: string) {
  const painter = page.getByRole('grid', { name: t('guests.page.gridLabel', { event: title }) })
  await expect(painter).toBeVisible()
  await painter
    .getByRole('gridcell', { name: /not set/ })
    .first()
    .focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.getByText(t('availability.mySlots', { count: 2 }))).toBeVisible()
}

async function answerAsGuest(page: Page, code: string, title: string, name: string) {
  await page.goto(`/a/${code}`)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await page.getByLabel(t('guests.page.nameLabel')).fill(name)
  await paintTwo(page, title)
  await page.getByRole('button', { name: t('guests.page.submit') }).click()
  await expect(page.getByText(t('guests.page.sentTitle', { name }))).toBeVisible()
}

test('share a guest link, a guest adds their times without an account, the plan shows them', async ({
  newUser,
  openAs,
}) => {
  const [host, friend] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(host, [friend])
  const title = unique('Dumplings')
  const plan = await pollIn(host, group, title)

  // The host makes a link for up to 5 guests, open for 7 days, and copies it.
  const page = await openAs(host)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto(`/plans/${plan.id}`)
  await page.getByRole('button', { name: t('guests.panel.share') }).click()
  const sheet = page.getByRole('dialog', { name: t('guests.create.title') })
  await sheet.getByRole('radio', { name: '5', exact: true }).click()
  await expect(
    sheet.getByText(t('guests.create.summary', { max: 5, expiry: t('guests.create.expiry.week') })),
  ).toBeVisible()
  await page.getByRole('button', { name: t('guests.create.submit') }).click()
  const links = page.getByRole('list', { name: t('guests.panel.links') })
  await expect(links.getByText(t('guests.panel.usage', { used: 0, max: 5 }))).toBeVisible()
  await links.getByRole('button', { name: t('guests.panel.copy') }).click()
  await expect(page.getByText(t('guests.panel.copied')).first()).toBeVisible()
  const url = await page.evaluate(() => navigator.clipboard.readText())
  const code = url.split('/a/')[1]!
  expect(code).toMatch(/^[\w-]{16}$/)

  // Someone with no account opens it, types a name and paints two slots.
  const guest = await openAs(null)
  const name = unique('Cy')
  await answerAsGuest(guest, code, title, name)
  // They see how everyone looks as counts only.
  await expect(
    guest.getByRole('grid', { name: t('guests.page.heatGridLabel', { event: title }) }),
  ).toBeVisible()

  // The same browser comes back and can still change its answer.
  await guest.reload()
  await expect(guest.getByText(t('guests.page.sentTitle', { name }))).toBeVisible()
  await guest.getByRole('button', { name: t('guests.page.edit') }).click()
  await expect(guest.getByRole('button', { name: t('guests.page.update') })).toBeVisible()

  // The host's plan counts the guest, live, with a Guest tag.
  await expect(links.getByText(t('guests.panel.usage', { used: 1, max: 5 }))).toBeVisible()
  await expect(
    page.getByText(t('guests.panel.answered', { count: 1 })).filter({ visible: true }),
  ).toBeVisible()
  await page.getByRole('radio', { name: t('events.tabs.group') }).click()
  const heatmap = page.getByRole('grid', {
    name: t('availability.heatGridLabel', { event: title }),
  })
  await expect(heatmap.getByRole('gridcell', { name: /: 1 free, 0 maybe/ })).toHaveCount(2)
})

test('a full link turns new guests away but lets the guest who answered edit', async ({
  newUser,
  openAs,
}) => {
  const host = await newUser({ name: unique('Ava') })
  const group = await groupWith(host)
  const title = unique('Picnic')
  const plan = await pollIn(host, group, title)
  const link = await guestLinkFor(host, plan.id, 1)

  const first = await openAs(null)
  await answerAsGuest(first, link.code, title, unique('Dee'))

  const late = await openAs(null)
  await late.goto(`/a/${link.code}`)
  await expect(late.getByRole('heading', { name: t('guests.closed.fullTitle') })).toBeVisible()
  await expect(late.getByLabel(t('guests.page.nameLabel'))).toHaveCount(0)

  await first.reload()
  await first.getByRole('button', { name: t('guests.page.edit') }).click()
  await first.getByRole('button', { name: t('guests.page.update') }).click()
  await expect(first.getByRole('button', { name: t('guests.page.edit') })).toBeVisible()
})

test('an expired link says it has closed', async ({ newUser, openAs }) => {
  const host = await newUser({ name: unique('Ava') })
  const group = await groupWith(host)
  const plan = await pollIn(host, group, unique('Brunch'))
  const link = await guestLinkFor(host, plan.id)
  await expireGuestLink(link.id)

  const guest = await openAs(null)
  await guest.goto(`/a/${link.code}`)
  await expect(guest.getByRole('heading', { name: t('guests.closed.title') })).toBeVisible()
  await expect(guest.getByText(t('guests.closed.expired'))).toBeVisible()
  await expect(guest.getByRole('link', { name: t('guests.closed.action') })).toBeVisible()
})
