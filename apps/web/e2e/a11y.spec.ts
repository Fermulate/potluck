import AxeBuilder from '@axe-core/playwright'
import { createPlanEvent } from '@potluck/api'
import { t } from '@potluck/i18n'
import type { Page, TestInfo } from '@playwright/test'
import { addEqualExpense, groupWith, guestLinkFor, pollIn } from './support/api'
import { expect, test, unique, type TestUser } from './support/fixtures'

/** Serious and critical WCAG 2.1 A/AA violations fail the test; the rest are reported. */
async function audit(page: Page, testInfo: TestInfo) {
  // Sections fade in as their data lands; a half faded button reads as low contrast. Audit the
  // settled page (looping animations, like skeleton shimmer, are left alone).
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  await testInfo.attach('axe-results', {
    body: JSON.stringify(results.violations, null, 2),
    contentType: 'application/json',
  })
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 5).map((n) => n.target.join(' ')),
    }))
  expect(blocking, 'serious or critical accessibility violations').toEqual([])

  // Layout contract: never a sideways page scroll.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, 'horizontal page overflow in px').toBeLessThanOrEqual(0)
}

async function setup(newUser: () => Promise<TestUser>) {
  const [me, ben] = await Promise.all([newUser(), newUser()])
  const group = await groupWith(me, [ben], { name: unique('Book club') })
  await addEqualExpense(ben, group, [me, ben], 4200, unique('Snacks'))
  return { me, ben, group }
}

test.describe('accessibility', () => {
  test('landing', async ({ page }, testInfo) => {
    // The hero demo is decorative and loops fade-ins; audit its settled state.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    await expect(page.getByRole('link', { name: t('app.landing.getStarted') })).toBeVisible()
    await audit(page, testInfo)
  })

  test('home', async ({ newUser, openAs }, testInfo) => {
    const { me } = await setup(newUser)
    const page = await openAs(me)
    await page.goto('/home')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(me.name)
    await audit(page, testInfo)
  })

  test('group expenses', async ({ newUser, openAs }, testInfo) => {
    const { me, group } = await setup(newUser)
    const page = await openAs(me)
    await page.goto(`/groups/${group.id}`)
    await expect(page.getByRole('link', { name: /Snacks/ })).toBeVisible()
    await audit(page, testInfo)
  })

  test('group totals and charts', async ({ newUser, openAs }, testInfo) => {
    const { me, group } = await setup(newUser)
    const page = await openAs(me)
    await page.goto(`/groups/${group.id}/totals`)
    await expect(page.getByRole('region', { name: t('insights.totals.label') })).toBeVisible()
    await audit(page, testInfo)
  })

  test('spending across groups', async ({ newUser, openAs }, testInfo) => {
    const { me } = await setup(newUser)
    const page = await openAs(me)
    await page.goto('/insights')
    await expect(page.getByRole('list', { name: t('insights.byGroup.title') })).toBeVisible()
    await audit(page, testInfo)
  })

  test('search with results', async ({ newUser, openAs }, testInfo) => {
    const { me } = await setup(newUser)
    const page = await openAs(me)
    await page.goto('/search?q=Snacks')
    await expect(page.getByRole('link', { name: /Snacks/ })).toBeVisible()
    await audit(page, testInfo)
  })

  test('add expense', async ({ newUser, openAs }, testInfo) => {
    const { me, group } = await setup(newUser)
    const page = await openAs(me)
    await page.goto(`/new/expense?groupId=${group.id}`)
    await expect(page.getByRole('textbox', { name: t('expenses.fields.amount') })).toBeVisible()
    await page.getByRole('textbox', { name: t('expenses.fields.amount') }).fill('24')
    await audit(page, testInfo)
  })

  test('repeating expense and its posted copy', async ({ newUser, openAs }, testInfo) => {
    const { me, ben, group } = await setup(newUser)
    const rent = await addEqualExpense(me, group, [me, ben], 150000, unique('Rent'), {
      recurrence: 'biweekly',
    })
    const page = await openAs(me)
    await page.goto(`/expenses/${rent.id}`)
    await expect(
      page.getByRole('region', { name: t('expenses.recurring.card.title') }),
    ).toBeVisible()
    await audit(page, testInfo)
    await page.goto(`/recurring/${rent.recurring_id}`)
    await expect(page.getByRole('textbox', { name: t('expenses.fields.amount') })).toBeVisible()
    await audit(page, testInfo)
  })

  test('repeating list and make it repeat', async ({ newUser, openAs }, testInfo) => {
    const { me, ben, group } = await setup(newUser)
    await addEqualExpense(me, group, [me, ben], 150000, unique('Rent'), { recurrence: 'monthly' })
    const plain = await addEqualExpense(me, group, [me, ben], 6000, unique('Cleaner'))
    const page = await openAs(me)
    await page.goto(`/groups/${group.id}`)
    await page.getByRole('button', { name: new RegExp(t('expenses.recurring.title')) }).click()
    await expect(page.getByRole('button', { name: t('expenses.recurring.pause') })).toBeVisible()
    await audit(page, testInfo)
    await page.goto(`/expenses/${plain.id}`)
    await page.getByRole('button', { name: t('expenses.recurring.make.action') }).click()
    await expect(
      page.getByRole('radiogroup', { name: t('expenses.fields.recurring') }),
    ).toBeVisible()
    await audit(page, testInfo)
  })

  test('balances', async ({ newUser, openAs }, testInfo) => {
    const { me, group } = await setup(newUser)
    const page = await openAs(me)
    await page.goto(`/groups/${group.id}/balances`)
    // The group header also reads "You owe ..."; the total is the paragraph on the tab.
    await expect(
      page.getByRole('paragraph').filter({ hasText: new RegExp(`^${t('balances.youOweTotal')}$`) }),
    ).toBeVisible()
    await audit(page, testInfo)
  })

  test('friends, owing one way in one currency and the other way in another', async ({
    newUser,
    openAs,
  }, testInfo) => {
    const { me, ben } = await setup(newUser)
    const euros = await groupWith(me, [ben], { name: unique('Trip'), currency: 'EUR' })
    await addEqualExpense(me, euros, [me, ben], 3000, unique('Ferry'), { currency: 'EUR' })
    const page = await openAs(me)
    await page.goto('/friends')
    await expect(
      page.getByRole('button', { name: t('friends.settle.actionLabel', { name: ben.name }) }),
    ).toBeVisible()
    await audit(page, testInfo)
  })

  test('event page', async ({ newUser, openAs }, testInfo) => {
    const { me, group } = await setup(newUser)
    const day = (offset: number) =>
      new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
    const title = unique('Game night')
    const event = await createPlanEvent(me.client, {
      group_id: group.id,
      title,
      description: null,
      location: 'Ben and Cleo place',
      emoji: '🎲',
      window_start: day(1),
      window_end: day(5),
      day_start_minute: 18 * 60,
      day_end_minute: 23 * 60,
      slot_minutes: 30,
      duration_minutes: 120,
      min_attendees: 2,
      rsvp_deadline: null,
      timezone: 'UTC',
    })
    const page = await openAs(me)
    await page.goto(`/plans/${event.id}`)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page.getByRole('grid').first()).toBeVisible()
    await audit(page, testInfo)
  })

  test('guest link page, signed out', async ({ newUser, openAs }, testInfo) => {
    const { me, group } = await setup(newUser)
    const title = unique('Dumplings')
    const event = await pollIn(me, group, title)
    const link = await guestLinkFor(me, event.id)
    const page = await openAs(null)
    await page.goto(`/a/${link.code}`)
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    await expect(page.getByRole('grid').first()).toBeVisible()
    await audit(page, testInfo)
  })

  test('me', async ({ newUser, openAs }, testInfo) => {
    const page = await openAs(await newUser())
    await page.goto('/me')
    await expect(page.getByRole('textbox', { name: t('settings.calendar.feed') })).toBeVisible()
    await expect(page.getByRole('switch').nth(1)).toBeVisible()
    await audit(page, testInfo)
  })

  test('unsubscribe link that does not work', async ({ page }, testInfo) => {
    await page.goto('/unsubscribe?token=not-a-token')
    await expect(page.getByRole('heading', { name: t('unsubscribe.invalidTitle') })).toBeVisible()
    await audit(page, testInfo)
  })
})
