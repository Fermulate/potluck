import { t } from '@potluck/i18n'
import { expect, test, unique } from './support/fixtures'

test('landing page leads to sign up, onboarding and home', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    t('app.landing.title').split('.')[0]!,
  )

  await page.getByRole('link', { name: t('app.landing.getStarted') }).click()
  await expect(page).toHaveURL(/\/sign-up/)

  const name = unique('Ola')
  await page.getByLabel(t('auth.fields.name')).fill(name)
  await page.getByLabel(t('auth.fields.email')).fill(`${name.toLowerCase()}@potluck.test`)
  await page.getByLabel(t('auth.fields.password'), { exact: true }).fill('potluck-e2e-pass')
  await page.getByRole('button', { name: t('auth.signUp.submit') }).click()

  // Onboarding, step 1: name, time zone, currency.
  await expect(page).toHaveURL(/\/welcome/)
  await expect(page.getByRole('heading', { name: t('onboarding.profile.title') })).toBeVisible()
  const nameField = page.getByLabel(t('onboarding.profile.nameLabel'))
  await expect(nameField).toHaveValue(name)
  await nameField.fill(`${name} Okafor`)
  await page.getByLabel(t('onboarding.profile.timezoneLabel')).selectOption('Europe/Lisbon')
  await page.getByLabel(t('onboarding.profile.currencyLabel')).selectOption('EUR')
  await page.getByRole('button', { name: t('onboarding.profile.save') }).click()

  // Step 2: first group, which can be skipped.
  await expect(page.getByRole('heading', { name: t('onboarding.firstGroup.title') })).toBeVisible()
  await page.getByRole('button', { name: t('onboarding.firstGroup.skip') }).click()

  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { level: 1 })).toContainText(name)
})
