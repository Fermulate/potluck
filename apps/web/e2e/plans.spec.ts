import { setAvailability } from '@potluck/api'
import { t } from '@potluck/i18n'
import { readFile } from 'node:fs/promises'
import { groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

test('plan an event: paint times, watch the heatmap, lock it in, RSVP, add to calendar', async ({
  newUser,
  openAs,
}) => {
  const [host, guest] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(host, [guest])
  const title = unique('Picnic')

  // The host creates the plan with the default window (tomorrow onward, 10:00 to 22:00).
  const page = await openAs(host)
  await page.goto(`/new/plan?groupId=${group.id}`)
  await page.getByLabel(t('events.create.titleLabel')).fill(title)
  await page.getByRole('button', { name: t('events.create.submit') }).click()
  await expect(page).toHaveURL(/\/plans\/[0-9a-f-]+$/)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  const eventId = page.url().split('/').pop()!

  // The host is free tomorrow 10:00 to 12:00 (UTC, like everyone here).
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const slots = ['10:00', '10:30', '11:00', '11:30'].map((time) => ({
    slot_start: `${tomorrow}T${time}:00Z`,
    level: 'yes' as const,
  }))
  await setAvailability(host.client, eventId, slots)
  await page.reload()
  const heatmap = page.getByRole('grid', {
    name: t('availability.heatGridLabel', { event: title }),
  })
  await expect(heatmap).toBeVisible()
  await expect(heatmap.getByRole('gridcell', { name: /: 1 free, 0 maybe/ })).toHaveCount(4)

  // The guest paints the same two hours with the keyboard.
  const other = await openAs(guest)
  await other.goto(`/plans/${eventId}`)
  const painter = other.getByRole('grid', { name: t('availability.gridLabel', { event: title }) })
  await expect(painter).toBeVisible()
  const first = painter.getByRole('gridcell', { name: /not set/ }).first()
  await first.focus()
  await other.keyboard.press('Space')
  for (let i = 0; i < 3; i++) await other.keyboard.press('Shift+ArrowDown')
  await expect(other.getByText(t('availability.mySlots', { count: 4 }))).toBeVisible()
  await expect(other.getByText(t('availability.savedState'))).toBeVisible()

  // The host's heatmap updates live, without a reload.
  await expect(heatmap.getByRole('gridcell', { name: /: 2 free, 0 maybe/ })).toHaveCount(4)

  // Best time: tomorrow at 10:00, everyone can make it. Lock it in.
  const best = page.getByRole('region', { name: t('bestTime.title') })
  await expect(best.getByText(t('bestTime.everyoneCanMake')).first()).toBeVisible()
  await best.getByRole('button', { name: t('events.lock'), exact: true }).click()
  await page
    .getByRole('dialog', { name: t('events.lockTitle') })
    .getByRole('button', { name: t('events.lock') })
    .click()
  await expect(page.getByText(t('events.locked'))).toBeVisible()

  // RSVP and add it to a calendar.
  const rsvp = page.getByRole('radiogroup', { name: t('rsvp.title') })
  await rsvp.getByRole('radio', { name: t('rsvp.status.going') }).click()
  await expect(rsvp.getByRole('radio', { name: t('rsvp.status.going') })).toHaveAttribute(
    'aria-checked',
    'true',
  )

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: t('events.addToCalendar') }).click(),
  ])
  expect(download.suggestedFilename()).toMatch(/\.ics$/)
  const ics = await readFile((await download.path())!, 'utf8')
  expect(ics).toContain('BEGIN:VCALENDAR')
  expect(ics).toContain(title)
  expect(ics).toContain(`DTSTART:${tomorrow.replaceAll('-', '')}T100000Z`)
})
