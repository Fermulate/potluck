import { fileURLToPath } from 'node:url'
import { fetchExpenseAttachments, fetchReceiptUrl } from '@potluck/api'
import { formatMoney, t } from '@potluck/i18n'
import type { Page } from '@playwright/test'
import { groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

// A printed till receipt: Corner Bistro, 11/08/2026, burger 14.00, fries 5.00, lemonade 4.50,
// tax 2.00, total 25.50.
const RECEIPT = fileURLToPath(new URL('./fixtures/receipt.png', import.meta.url))

async function choose(page: Page, button: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: button }).click()
  await (await chooser).setFiles(RECEIPT)
}

test.describe('receipts', () => {
  test('scan a receipt, split it by item, keep two photos and keep them in the group', async ({
    newUser,
    openAs,
  }) => {
    // The first scan fetches the reader (worker, core, model) from the preview server.
    test.setTimeout(150_000)
    const [me, ben, outsider] = await Promise.all([
      newUser({ name: unique('Ava') }),
      newUser({ name: unique('Ben') }),
      newUser({ name: unique('Oz') }),
    ])
    const group = await groupWith(me, [ben])
    const page = await openAs(me)
    await page.goto(`/new/expense?groupId=${group.id}`)

    await choose(page, t('expenses.scan.button'))
    const review = page.getByRole('dialog', { name: t('expenses.scan.reviewTitle') })
    await expect(review).toBeVisible({ timeout: 90_000 })
    await expect(review.getByText('Corner Bistro')).toBeVisible()
    await expect(review.getByText(t('expenses.scan.items', { count: 3 }))).toBeVisible()
    await expect(review.getByRole('img', { name: t('expenses.scan.photoAlt') })).toBeVisible()
    const priceOf = (label: string) =>
      review.getByRole('textbox', { name: `${t('expenses.itemized.itemAmount')}, ${label}` })
    await expect(priceOf(t('expenses.scan.total'))).toHaveValue('25.50')
    // A price corrected against the photo is checked against the total again.
    const warning = review.getByRole('status').filter({ hasText: t('expenses.scan.checkPrices') })
    await expect(warning).toHaveCount(0)
    await priceOf('Lemonade').fill('4.75')
    await expect(warning).toContainText(
      t('expenses.scan.itemsOff', {
        items: formatMoney(2575, 'USD'),
        total: formatMoney(2550, 'USD'),
      }),
    )
    await priceOf('Lemonade').fill('4.50')
    await expect(warning).toHaveCount(0)
    await review.getByRole('button', { name: t('expenses.scan.apply') }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Filled in, not saved: the person checks it and decides who had what.
    const name = page.getByRole('textbox', { name: t('expenses.fields.description') })
    await expect(name).toHaveValue('Corner Bistro')
    const description = unique('Bistro')
    await name.fill(description)
    await expect(page.getByLabel(t('expenses.fields.date'))).toHaveValue('2026-11-08')
    const items = page.getByRole('textbox', { name: t('expenses.itemized.itemName') })
    await expect(items).toHaveCount(3)
    await expect(items.nth(2)).toHaveValue('Lemonade')
    await page
      .getByRole('group', { name: t('expenses.itemizedEditor.assign', { item: 'Lemonade' }) })
      .getByRole('button', { name: t('common.you') })
      .click()
    await expect(page.getByText(t('expenses.form.itemizedTotal'))).toBeVisible()

    // The scanned photo is attached; add one more.
    const first = t('expenses.attachments.photo', { number: 1 })
    await expect(page.getByRole('img', { name: first })).toBeVisible()
    await choose(page, t('expenses.attachments.addLabel'))
    await expect(
      page.getByRole('img', { name: t('expenses.attachments.photo', { number: 2 }) }),
    ).toBeVisible()

    await page.getByRole('button', { name: t('expenses.form.save') }).click()
    await expect(page).toHaveURL(new RegExp(`/groups/${group.id}$`))
    await page.getByRole('link', { name: new RegExp(description) }).click()
    await expect(page.getByRole('heading', { level: 1, name: description })).toBeVisible()
    const expenseId = page.url().split('/expenses/')[1]!.split(/[/?#]/)[0]!

    // Both photos, each full screen.
    await expect(page.getByRole('heading', { name: t('expenses.attachments.label') })).toBeVisible()
    await page
      .getByRole('button', { name: t('expenses.attachments.open', { name: first }) })
      .click()
    const viewer = page.getByRole('dialog', {
      name: t('expenses.attachments.position', { number: 1, count: 2 }),
    })
    await expect(viewer).toBeVisible()
    const shown = viewer.getByRole('img')
    await expect(shown).toBeVisible()
    // Zoom in to read the small print, then back out.
    await viewer.getByRole('button', { name: t('expenses.attachments.zoomIn') }).click()
    await expect(shown).toHaveAttribute('style', /scale\(1\.5\)/)
    await viewer.getByRole('button', { name: t('expenses.attachments.zoomOut') }).click()
    await expect(shown).toHaveAttribute('style', /scale\(1\)/)
    await viewer.getByRole('button', { name: t('expenses.attachments.next') }).click()
    await expect(
      page.getByRole('dialog', {
        name: t('expenses.attachments.position', { number: 2, count: 2 }),
      }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Group members read the files; nobody else does.
    const files = await fetchExpenseAttachments(ben.client, expenseId)
    expect(files).toHaveLength(2)
    expect(files.every((f) => f.path.startsWith(`${group.id}/`))).toBe(true)
    await expect(fetchReceiptUrl(ben.client, files[0]!.path)).resolves.toContain('token=')
    expect(await fetchExpenseAttachments(outsider.client, expenseId)).toEqual([])
    await expect(fetchReceiptUrl(outsider.client, files[0]!.path)).rejects.toBeTruthy()
  })
})
