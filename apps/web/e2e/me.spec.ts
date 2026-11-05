import { createSupabaseClient } from '@potluck/api'
import { t } from '@potluck/i18n'
import { stackEnv } from './support/env'
import { expect, test } from './support/fixtures'

test('theme choice survives a reload and the calendar feed link is shown', async ({
  newUser,
  openAs,
}) => {
  const page = await openAs(await newUser())
  await page.goto('/me')
  await expect(page.getByRole('heading', { level: 1, name: t('settings.title') })).toBeVisible()

  const theme = page.getByRole('radiogroup', { name: t('settings.preferences.theme') })
  await theme.getByRole('radio', { name: t('settings.preferences.themeDark') }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await expect(
    page
      .getByRole('radiogroup', { name: t('settings.preferences.theme') })
      .getByRole('radio', { name: t('settings.preferences.themeDark') }),
  ).toBeChecked()

  const feed = page.getByRole('textbox', { name: t('settings.calendar.feed') })
  await expect(feed).toHaveValue(/^https?:\/\/.+/)
  await expect(page.getByRole('button', { name: t('settings.calendar.copyFeed') })).toBeVisible()
})

test('deleting the account signs out for good', async ({ newUser, openAs }) => {
  const user = await newUser()
  const page = await openAs(user)
  await page.goto('/me')

  await page.getByRole('button', { name: t('account.delete.title') }).click()
  const dialog = page.getByRole('dialog', { name: t('account.delete.title') })
  const submit = dialog.getByRole('button', { name: t('account.delete.submit') })
  await expect(submit).toBeDisabled()
  await dialog.getByLabel(t('account.delete.confirmPhrase')).fill(t('account.delete.confirmWord'))
  await submit.click()

  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 })
  await expect(page.getByRole('link', { name: t('app.landing.getStarted') })).toBeVisible()
  await page.goto('/home')
  await expect(page).toHaveURL(/\/sign-in/)

  const env = stackEnv()
  const fresh = createSupabaseClient(env.url, env.publishableKey)
  const { error } = await fresh.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  expect(error).not.toBeNull()
})
