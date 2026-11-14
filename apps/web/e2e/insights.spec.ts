import { deleteExpense, deleteSettlement, fetchFxRate, settleUp } from '@potluck/api'
import { convert } from '@potluck/core'
import { formatMoney, t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

const exact = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)

test('search finds an expense in every group the viewer is in, and only those', async ({
  newUser,
  openAs,
}) => {
  const [me, ben, cleo, dan] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
    newUser({ name: unique('Cleo') }),
    newUser({ name: unique('Dan') }),
  ])
  const tag = unique('taco')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
  const flat = await groupWith(me, [ben], { name: unique('Flat') })
  const trip = await groupWith(me, [cleo], { name: unique('Trip') })
  const elsewhere = await groupWith(dan, [], { name: unique('Elsewhere') })
  await addEqualExpense(ben, flat, [me, ben], 4000, `Taco night ${tag}`)
  await addEqualExpense(cleo, trip, [me, cleo], 2400, `Taco truck ${tag}`)
  await addEqualExpense(dan, elsewhere, [dan], 900, `Taco secret ${tag}`)

  const page = await openAs(me)
  await page.goto('/home')
  await page
    .getByRole('link', { name: exact(t('search.open')) })
    .or(page.getByRole('link', { name: exact(t('search.title')) }))
    .locator('visible=true')
    .first()
    .click()
  await expect(page).toHaveURL(/\/search/)
  await page.getByRole('searchbox', { name: t('search.label') }).fill(tag)

  await expect(page.getByRole('region', { name: new RegExp(flat.name) })).toBeVisible()
  await expect(page.getByRole('region', { name: new RegExp(trip.name) })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`Taco night ${tag}`) })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`Taco truck ${tag}`) })).toBeVisible()
  await expect(page.getByText(t('search.results', { count: 2 }))).toBeVisible()
  await expect(page.getByText(`Taco secret ${tag}`)).toHaveCount(0)

  // A name finds what that person is part of.
  await page.getByRole('searchbox', { name: t('search.label') }).fill(cleo.name)
  await expect(page.getByRole('link', { name: new RegExp(`Taco truck ${tag}`) })).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(`Taco night ${tag}`) })).toHaveCount(0)

  // A number in the address (a shared link, a bookmark) is a search for that text, not a crash.
  await page.goto('/search?q=24')
  await expect(page.getByRole('searchbox', { name: t('search.label') })).toHaveValue('24')
  await expect(page.getByRole('heading', { name: t('errors.screen.title') })).toHaveCount(0)
})

test('filtering a group to one person, one month and one category shows a matching total', async ({
  newUser,
  openAs,
}) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])
  await addEqualExpense(ben, group, [me, ben], 3000, 'March tacos', {
    category: 'food',
    spent_at: '2026-03-10',
  })
  await addEqualExpense(ben, group, [me, ben], 1800, 'March wine', {
    category: 'drinks',
    spent_at: '2026-03-12',
  })
  await addEqualExpense(me, group, [me], 1500, 'Solo lunch', {
    category: 'food',
    spent_at: '2026-03-15',
  })
  await addEqualExpense(ben, group, [me, ben], 5000, 'April pizza', {
    category: 'food',
    spent_at: '2026-04-02',
  })

  const page = await openAs(me)
  await page.goto(`/groups/${group.id}`)
  await expect(page.getByText('April pizza')).toBeVisible()
  await page.getByRole('button', { name: t('filters.open') }).click()
  const sheet = page.getByRole('dialog', { name: t('filters.title') })
  await sheet.getByRole('button', { name: ben.name }).click()
  await sheet.getByRole('button', { name: t('filters.custom') }).click()
  await sheet.getByLabel(t('filters.from'), { exact: true }).fill('2026-03-01')
  await sheet.getByLabel(t('filters.to'), { exact: true }).fill('2026-03-31')
  await sheet.getByRole('button', { name: t('categories.food') }).click()
  await sheet.getByRole('button', { name: t('filters.done') }).click()

  await expect(page.getByText('March tacos')).toBeVisible()
  await expect(page.getByText('March wine')).toHaveCount(0)
  await expect(page.getByText('Solo lunch')).toHaveCount(0)
  await expect(page.getByText('April pizza')).toHaveCount(0)
  await expect(
    page.getByText(t('filters.summary', { count: 1, total: formatMoney(3000, 'USD') })),
  ).toBeVisible()
  await expect(
    page.getByText(t('filters.yourShare', { amount: formatMoney(1500, 'USD') })),
  ).toBeVisible()

  // The filters live in the address, so a trip to another tab and back keeps them.
  await expect(page).toHaveURL(/person=.*cats=food/)
  const tabs = page.getByRole('navigation', { name: t('groups.tabs.label') })
  await tabs.getByRole('link', { name: t('insights.tab') }).click()
  // Other tabs' addresses stay clean; the Expenses tab link brings the filters back.
  await expect(page).toHaveURL(/\/totals$/)
  await tabs.getByRole('link', { name: t('groups.tabs.balances') }).click()
  await expect(page).toHaveURL(/\/balances$/)
  await tabs.getByRole('link', { name: t('groups.tabs.expenses') }).click()
  await expect(page).toHaveURL(/person=.*cats=food/)
  await expect(page.getByText('March tacos')).toBeVisible()
  await expect(page.getByText('April pizza')).toHaveCount(0)
})

test('totals add up the viewer share, charts read by keyboard, deleted expenses come back', async ({
  newUser,
  openAs,
}) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])
  await addEqualExpense(ben, group, [me, ben], 3000, 'Tacos', {
    category: 'food',
    spent_at: '2026-03-10',
  })
  await addEqualExpense(me, group, [me, ben], 1200, 'Groceries', {
    category: 'groceries',
    spent_at: '2026-03-20',
  })
  const firewood = await addEqualExpense(me, group, [me, ben], 900, 'Firewood', {
    category: 'other',
    spent_at: '2026-03-21',
  })
  await deleteExpense(me.client, firewood.id)
  const payment = await settleUp(me.client, { groupId: group.id, toUser: ben.id, amountCents: 700 })
  await deleteSettlement(me.client, payment.id)

  const page = await openAs(me)
  await page.goto(`/groups/${group.id}`)
  await page.getByRole('link', { name: t('insights.tab') }).click()
  await expect(page).toHaveURL(/\/totals$/)
  await page.getByRole('radio', { name: t('insights.period.all') }).click()
  const totals = page.getByRole('region', { name: t('insights.totals.label') })
  // 15.00 of the tacos and 6.00 of the groceries; the deleted firewood does not count.
  await expect(totals.getByText(formatMoney(2100, 'USD'))).toBeVisible()
  await expect(totals.getByText(formatMoney(4200, 'USD'))).toBeVisible()

  const march = page.getByRole('button', {
    name: t('insights.byMonth.column', {
      month: 'March 2026',
      amount: formatMoney(2100, 'USD'),
    }),
  })
  await march.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByText('March 2026', { exact: true }).first()).toBeVisible()
  await page.getByText(t('insights.table.show')).first().click()
  await expect(
    page.getByRole('table', { name: t('insights.byMonth.title') }).getByRole('row', {
      name: `March 2026 ${formatMoney(2100, 'USD')}`,
    }),
  ).toBeVisible()

  await page.getByRole('link', { name: new RegExp(t('insights.links.deleted')) }).click()
  await expect(page.getByRole('heading', { name: t('deletedItems.title') })).toBeVisible()
  await expect(page.getByText(/^Deleted by you /).first()).toBeVisible()
  // The payment opens its own page and comes back with Restore too.
  const paymentTitle = t('search.paymentRow', { from: t('common.you'), to: ben.name })
  await expect(page.getByRole('link', { name: paymentTitle })).toHaveAttribute(
    'href',
    `/payments/${payment.id}`,
  )
  await page
    .getByRole('button', { name: t('deletedItems.restoreLabel', { description: paymentTitle }) })
    .click()
  await expect(page.getByRole('link', { name: paymentTitle })).toHaveCount(0)
  await page
    .getByRole('button', { name: t('deletedItems.restoreLabel', { description: 'Firewood' }) })
    .click()
  await expect(
    page.getByText(t('deletedItems.restored', { description: 'Firewood' })),
  ).toBeVisible()
  await expect(page.getByText(t('deletedItems.empty.title'))).toBeVisible()

  await page.getByRole('link', { name: t('groups.tabs.expenses') }).click()
  await expect(page.getByRole('link', { name: /Firewood/ })).toBeVisible()
})

test("a group's activity link shows only that group's entries", async ({ newUser, openAs }) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const flat = await groupWith(me, [ben], { name: unique('Flat') })
  const trip = await groupWith(me, [ben], { name: unique('Trip') })
  await addEqualExpense(ben, flat, [me, ben], 2000, unique('Rent'))
  const tripExpense = unique('Gas')
  await addEqualExpense(ben, trip, [me, ben], 2000, tripExpense)

  const page = await openAs(me)
  await page.goto(`/groups/${flat.id}`)
  await page.getByRole('link', { name: t('insights.links.activity') }).click()
  await expect(page).toHaveURL(new RegExp(`/activity\\?groupId=${flat.id}`))
  await expect(page.getByText(t('activityFilter.group', { group: flat.name }))).toBeVisible()
  await expect(page.getByRole('link', { name: /added/ }).first()).toBeVisible()
  await expect(page.getByText(tripExpense)).toHaveCount(0)

  await page.getByRole('link', { name: t('activityFilter.clear') }).click()
  await expect(page.getByText(new RegExp(tripExpense)).first()).toBeVisible()
})

test('activity with a friend shows what involves you both, payments included', async ({
  newUser,
  openAs,
}) => {
  const [me, fay, gus] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Fay') }),
    newUser({ name: unique('Gus') }),
  ])
  const group = await groupWith(me, [fay, gus])
  const shared = unique('Dinner')
  const notMine = unique('Fay and Gus taxi')
  await addEqualExpense(fay, group, [me, fay], 4000, shared)
  await addEqualExpense(fay, group, [fay, gus], 1800, notMine)
  await settleUp(me.client, { groupId: group.id, toUser: fay.id, amountCents: 2000 })

  const page = await openAs(me)
  await page.goto(`/activity?person=${fay.id}`)
  await expect(
    page.getByText(t('activityFilter.person', { name: fay.name.split(' ')[0]! })),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: new RegExp(shared) })).toBeVisible()
  await expect(page.getByRole('link', { name: /You paid/ }).first()).toBeVisible()
  await expect(page.getByText(notMine)).toHaveCount(0)
})

test('spending opens with everything in your currency, each converted at its date', async ({
  newUser,
  openAs,
}) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const home = await groupWith(me, [ben])
  const paris = await groupWith(me, [ben], { currency: 'EUR', name: unique('Paris') })
  await addEqualExpense(ben, home, [me, ben], 3000, unique('Pizza'))
  // EUR 10.00 split two ways: EUR 5.00, converted at today's rate.
  await addEqualExpense(ben, paris, [me, ben], 1000, unique('Croissants'), { currency: 'EUR' })

  // The rate e2e can rely on for today (the seed's, or the one global setup adds).
  const today = new Date().toISOString().slice(0, 10)
  const quote = await fetchFxRate(me.client, 'EUR', 'USD', today)
  const croissantsInUsd = convert(500, quote!.rate, { from: 'EUR', to: 'USD' })

  const page = await openAs(me)
  await page.goto('/insights')
  await expect(page.getByRole('combobox', { name: t('insights.view') })).toHaveText(
    t('insights.convertedTo', { currency: 'USD' }),
  )
  const totals = page.getByRole('region', { name: t('insights.totals.label') })
  await expect(totals.getByText(formatMoney(1500 + croissantsInUsd, 'USD')).first()).toBeVisible()

  await page.getByRole('combobox', { name: t('insights.view') }).click()
  await page.getByRole('option', { name: t('insights.onlyCurrency', { currency: 'EUR' }) }).click()
  await expect(totals.getByText(formatMoney(500, 'EUR')).first()).toBeVisible()
})
