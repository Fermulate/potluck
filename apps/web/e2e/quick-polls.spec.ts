import { t } from '@potluck/i18n'
import type { Page } from '@playwright/test'
import { answerQuickPoll, clearQuickPollCreates, quickPoll } from './support/api'
import { expect, test, unique } from './support/fixtures'

/** Paints the first `count` free cells of the poll's grid with the keyboard. */
async function paint(page: Page, title: string, count: number) {
  const painter = page.getByRole('grid', { name: t('quickPolls.page.gridLabel', { title }) })
  await expect(painter).toBeVisible()
  await painter
    .getByRole('gridcell', { name: /not set/ })
    .first()
    .focus()
  await page.keyboard.press('Space')
  for (let i = 1; i < count; i++) await page.keyboard.press('Shift+ArrowDown')
  await expect(page.getByText(t('availability.mySlots', { count }))).toBeVisible()
}

async function answer(page: Page, title: string, name: string, count: number) {
  await page.getByLabel(t('quickPolls.page.nameLabel')).fill(name)
  await paint(page, title, count)
  await page.getByRole('button', { name: t('quickPolls.page.submit') }).click()
  await expect(page.getByText(t('quickPolls.page.sentTitle', { name }))).toBeVisible()
}

test('make a quick poll from the landing page, two people answer without accounts', async ({
  openAs,
}) => {
  clearQuickPollCreates()
  const title = unique('Board games')
  const ava = unique('Ava')
  const ben = unique('Ben')

  // Someone signed out finds the poll in the hero and makes one from the defaults.
  const creator = await openAs(null)
  // WebKit has no clipboard permissions to grant, so keep what the page copies instead.
  await creator.addInitScript(() => {
    const keep = (text: string) => {
      ;(window as unknown as { copied?: string }).copied = text
      return Promise.resolve()
    }
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: keep },
      configurable: true,
    })
  })
  await creator.goto('/')
  await creator
    .getByRole('link', { name: new RegExp(`^${t('app.landing.quickPoll.title')}`) })
    .click()
  await expect(
    creator.getByRole('heading', { level: 1, name: t('quickPolls.create.title') }),
  ).toBeVisible()
  await creator.getByLabel(t('quickPolls.create.titleLabel')).fill(title)
  await creator.getByRole('button', { name: t('quickPolls.create.submit') }).click()

  // The new poll puts sharing first.
  await expect(creator.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(creator.getByText(t('quickPolls.page.readyTitle'))).toBeVisible()
  await creator.getByRole('button', { name: t('quickPolls.page.copy') }).click()
  await expect(creator.getByText(t('quickPolls.page.copied')).first()).toBeVisible()
  const url = await creator.evaluate(() => (window as unknown as { copied?: string }).copied ?? '')
  expect(url).toMatch(/\/p\/[\w-]+$/)
  expect(new URL(url).pathname).toBe(new URL(creator.url()).pathname)

  // The creator answers like anyone else.
  await answer(creator, title, ava, 3)
  await expect(creator.getByText(t('quickPolls.page.readyTitle'))).toHaveCount(0)

  // A second person, also without an account, opens the link and adds their times.
  const friend = await openAs(null)
  await friend.goto(new URL(url).pathname)
  await expect(friend.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(friend.getByText(t('quickPolls.page.answered', { count: 1, max: 10 }))).toBeVisible()
  await answer(friend, title, ben, 2)
  const heatmap = friend.getByRole('grid', { name: t('quickPolls.page.heatGridLabel', { title }) })
  await expect(heatmap.getByRole('gridcell', { name: /: 2 free, 0 maybe/ })).toHaveCount(2)

  // The creator's page picks the new answer up without a reload.
  await expect(creator.getByText(t('quickPolls.page.answered', { count: 2, max: 10 }))).toBeVisible(
    { timeout: 25_000 },
  )
  await expect(
    creator
      .getByRole('region', { name: t('bestTime.title') })
      .getByText(t('bestTime.everyoneCanMake'))
      .first(),
  ).toBeVisible()

  // The friend comes back on the same browser and changes their answer.
  await friend.reload()
  await friend.getByRole('button', { name: t('quickPolls.page.edit') }).click()
  await paint(friend, title, 3)
  await friend.getByRole('button', { name: t('quickPolls.page.update') }).click()
  await expect(friend.getByText(t('quickPolls.page.sentTitle', { name: ben }))).toBeVisible()

  // The creator closes the poll; the friend sees it read only.
  await creator.getByRole('button', { name: t('quickPolls.page.close') }).click()
  await creator
    .getByRole('dialog', { name: t('quickPolls.page.closeTitle') })
    .getByRole('button', { name: t('quickPolls.page.close') })
    .click()
  await expect(
    creator.getByRole('heading', { name: t('quickPolls.page.closedTitle') }),
  ).toBeVisible()
  await friend.reload()
  await expect(
    friend.getByRole('heading', { name: t('quickPolls.page.closedTitle') }),
  ).toBeVisible()
  await expect(friend.getByRole('button', { name: t('quickPolls.page.edit') })).toHaveCount(0)
})

test('a full poll turns a new person away but shows the results', async ({ openAs }) => {
  const title = unique('Picnic')
  const poll = await quickPoll({ title, maxPeople: 2 })
  await answerQuickPoll(poll.code, unique('Cy'))
  await answerQuickPoll(poll.code, unique('Dee'))

  const late = await openAs(null)
  await late.goto(`/p/${poll.code}`)
  await expect(late.getByRole('heading', { name: t('quickPolls.page.fullTitle') })).toBeVisible()
  await expect(late.getByLabel(t('quickPolls.page.nameLabel'))).toHaveCount(0)
  await expect(
    late.getByRole('grid', { name: t('quickPolls.page.heatGridLabel', { title }) }),
  ).toBeVisible()
})
