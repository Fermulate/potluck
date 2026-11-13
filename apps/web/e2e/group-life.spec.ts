import { acceptInvite, createExpense, createInvite } from '@potluck/api'
import { firstName } from '@potluck/core'
import { formatDate, t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

// A 2x2 PNG, enough for the browser to decode and shrink like a real photo.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGP4z8DwHwyBNAMDA8N/ADnAB/mLzVZ9AAAAAElFTkSuQmCC',
  'base64',
)

test('a trip with dates and a cover that members and the join page show', async ({
  newUser,
  openAs,
}) => {
  const [owner, friend] = await Promise.all([newUser(), newUser()])
  const page = await openAs(owner)
  await page.goto('/groups')
  await page
    .getByRole('button', { name: t('groups.new') })
    .filter({ visible: true })
    .first()
    .click()

  const name = unique('Lisbon')
  const sheet = page.getByRole('dialog', { name: t('groups.create.title') })
  await sheet.getByLabel(t('groups.create.nameLabel')).fill(name)
  await sheet.getByText(t('groups.types.trip'), { exact: true }).click()
  await sheet.getByLabel(t('groups.trip.starts')).fill('2026-06-03')
  await sheet.getByLabel(t('groups.trip.ends')).fill('2026-06-10')
  await sheet.getByRole('button', { name: t('groups.create.submit') }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+\/members$/)
  const day = (d: string) => formatDate(d, { timeZone: 'UTC', style: 'dayMonth' })
  await expect(
    page
      .getByText(t('groups.trip.range', { start: day('2026-06-03'), end: day('2026-06-10') }))
      .first(),
  ).toBeVisible()
  const groupId = /\/groups\/([^/]+)\//.exec(page.url())![1]!

  // The owner adds a cover in settings.
  await page.goto(`/groups/${groupId}/settings`)
  await page.getByLabel(t('groups.cover.add')).first().setInputFiles({
    name: 'beach.png',
    mimeType: 'image/png',
    buffer: PHOTO,
  })
  await expect(page.getByText(t('groups.cover.saved'))).toBeVisible()

  // A member sees it on the group header.
  const invite = await createInvite(owner.client, { groupId })
  await acceptInvite(friend.client, invite.code)
  const theirs = await openAs(friend)
  await theirs.goto(`/groups/${groupId}`)
  await expect(theirs.getByRole('heading', { name })).toBeVisible()
  // Decorative beside the group name (empty alt), so it is the page's one presentational image.
  await expect(theirs.getByRole('presentation').first()).toHaveAttribute('src', /group-covers\//)

  // So does the join page, signed out, and the invite can be shown as a QR code.
  const guest = await openAs(null)
  await guest.goto(`/join/${invite.code}`)
  await expect(
    guest.getByRole('img', { name: t('groups.cover.alt', { group: name }) }),
  ).toBeVisible()

  await page.goto(`/groups/${groupId}`)
  await page.getByRole('button', { name: t('groups.header.invite') }).click()
  const invites = page.getByRole('dialog', { name: t('invites.title') })
  await invites.getByRole('button', { name: t('invites.qr.show') }).click()
  await expect(
    invites.getByRole('img', { name: t('invites.qr.label', { group: name }) }),
  ).toBeVisible()
})

test('notes edited by one member show up live for another and in the activity', async ({
  newUser,
  openAs,
}) => {
  const [owner, friend] = await Promise.all([newUser(), newUser()])
  const group = await groupWith(owner, [friend])
  const mine = await openAs(owner)
  const theirs = await openAs(friend)
  await theirs.goto(`/groups/${group.id}/notes`)
  const theirBox = theirs.getByRole('textbox', { name: t('groups.notes.label') })
  await expect(theirBox).toHaveValue('')

  await mine.goto(`/groups/${group.id}`)
  await mine
    .getByRole('navigation', { name: t('groups.tabs.label') })
    .getByRole('link', { name: t('groups.tabs.notes') })
    .click()
  const text = `Wifi: ${unique('soup')}`
  await mine.getByRole('textbox', { name: t('groups.notes.label') }).fill(text)
  await expect(mine.getByText(t('groups.notes.saved'))).toBeVisible()

  // No reload: the change arrives over realtime.
  await expect(theirBox).toHaveValue(text)

  await theirs.goto('/activity')
  await expect(
    theirs.getByText(t('activity.group.notes_updated', { actor: firstName(owner.name) })).first(),
  ).toBeVisible()
})

test('a deleted group waits under recently deleted and any member brings it back', async ({
  newUser,
  openAs,
}) => {
  const [owner, friend] = await Promise.all([newUser(), newUser()])
  const group = await groupWith(owner, [friend])
  const page = await openAs(owner)
  await page.goto(`/groups/${group.id}/settings`)
  await page.getByRole('button', { name: t('groups.settings.delete') }).click()
  const dialog = page.getByRole('dialog', { name: t('groups.settings.delete') })
  await dialog.getByRole('button', { name: t('groups.settings.delete') }).click()
  await expect(page).toHaveURL(/\/groups$/)
  await expect(page.getByRole('heading', { name: group.name })).toHaveCount(0)

  const theirs = await openAs(friend)
  // The old address says what happened, and the inbox has a note from the owner.
  await theirs.goto(`/groups/${group.id}`)
  await expect(
    theirs.getByRole('heading', { name: t('groups.deleted.pageTitle', { group: group.name }) }),
  ).toBeVisible()
  await expect(
    theirs.getByRole('button', { name: t('groups.deleted.restoreLabel', { group: group.name }) }),
  ).toBeVisible()
  await theirs.goto('/notifications')
  await expect(
    theirs.getByText(t('notifications.types.group.deleted.title', { group: group.name })),
  ).toBeVisible()

  await theirs.goto('/groups')
  await theirs.getByRole('button', { name: t('groups.deleted.show', { count: 1 }) }).click()
  await expect(theirs.getByText(group.name)).toBeVisible()
  await expect(theirs.getByText(t('groups.deleted.daysLeft', { count: 30 }))).toBeVisible()
  await theirs
    .getByRole('button', { name: t('groups.deleted.restoreLabel', { group: group.name }) })
    .click()
  await expect(theirs).toHaveURL(new RegExp(`/groups/${group.id}$`))
  await expect(theirs.getByRole('heading', { name: group.name })).toBeVisible()

  await page.goto('/groups')
  await expect(page.getByRole('heading', { name: group.name })).toBeVisible()
})

test('the category follows the description: Uber is Transport, and the group habits win', async ({
  newUser,
  openAs,
}) => {
  const owner = await newUser()
  const group = await groupWith(owner)
  const roast = unique('Sunday roast')
  await createExpense(owner.client, {
    group_id: group.id,
    description: roast,
    amount_cents: 2400,
    currency: 'USD',
    paid_by: owner.id,
    split_type: 'equal',
    splits: [{ user_id: owner.id }],
    category: 'groceries',
    spent_at: new Date().toISOString().slice(0, 10),
  })
  await addEqualExpense(owner, group, [owner], 500, unique('Snacks'))

  const page = await openAs(owner)
  await page.goto(`/new/expense?groupId=${group.id}`)
  const description = page.getByRole('textbox', { name: t('expenses.fields.description') })
  await description.fill('Uber')
  const categories = page.getByRole('radiogroup', { name: t('categories.label') })
  await expect(categories.getByRole('radio', { name: t('categories.transport') })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.getByText(t('categories.suggested'))).toBeVisible()

  await description.fill(roast)
  await expect(categories.getByRole('radio', { name: t('categories.groceries') })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

test('a long group name keeps the groups page and its sheets on a phone screen', async ({
  newUser,
  openAs,
}) => {
  const owner = await newUser()
  const long = `${unique('Supercalifragilisticexpialidocious')}Weekendaway`
  await groupWith(owner, [], { name: long })
  const gone = await groupWith(owner, [], {
    name: `${unique('Gone')}Withaverylongnamethatneverbreaksanywhere`,
  })
  const page = await openAs(owner)
  // Against the layout width: a phone zooms out to show a wider page, which grows innerWidth too.
  const fits = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    )

  // The header and the delete note show the name; it wraps rather than widening the page.
  await page.goto(`/groups/${gone.id}/settings`)
  const remove = page.getByRole('button', { name: t('groups.settings.delete') })
  await expect(remove).toBeEnabled()
  expect(await fits()).toBe(true)
  await remove.click()
  await page
    .getByRole('dialog', { name: t('groups.settings.delete') })
    .getByRole('button', { name: t('groups.settings.delete') })
    .click()
  await expect(page).toHaveURL(/\/groups$/)
  await expect(page.getByRole('heading', { name: long })).toBeVisible()
  expect(await fits()).toBe(true)
  const toggle = page.getByRole('button', { name: t('groups.deleted.show', { count: 1 }) })
  await expect(toggle).toBeInViewport({ ratio: 1 })
  await toggle.click()
  expect(await fits()).toBe(true)
  await expect(
    page.getByRole('button', { name: t('groups.deleted.restoreLabel', { group: gone.name }) }),
  ).toBeInViewport({ ratio: 1 })

  const newGroup = page.getByRole('button', { name: t('groups.new') }).filter({ visible: true })
  await expect(newGroup.first()).toBeInViewport({ ratio: 1 })
  await newGroup.first().click()
  const sheet = page.getByRole('dialog', { name: t('groups.create.title') })
  await expect(sheet.getByRole('button', { name: t('groups.create.submit') })).toBeInViewport({
    ratio: 1,
  })
})
