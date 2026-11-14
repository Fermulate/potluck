import { createRecoveryCodes, createSupabaseClient, recoverWithCode } from '@potluck/api'
import { formatMoney, LOCALES, setLocale, t } from '@potluck/i18n'
import type { Page } from '@playwright/test'
import { stackEnv } from './support/env'
import { expect, test, unique, type TestUser } from './support/fixtures'
import { inbox, landingFor, verifyLink } from './support/mail'
import { totp } from './support/totp'

function freshClient() {
  const env = stackEnv()
  return createSupabaseClient(env.url, env.publishableKey)
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in')
  await page.getByRole('textbox', { name: t('auth.fields.email') }).fill(email)
  await page.getByLabel(t('auth.fields.password'), { exact: true }).fill(password)
  await page.getByRole('button', { name: t('auth.signIn.submit'), exact: true }).click()
}

const security = (page: Page) => page.getByRole('region', { name: t('security.title') })

/** Turns two-step sign in on through the API, as the app does, and returns the secret. */
async function withAuthenticator(user: TestUser): Promise<{ secret: string; codes: string[] }> {
  const { data, error } = await user.client.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: unique('phone'),
  })
  if (error) throw error
  const verified = await user.client.auth.mfa.challengeAndVerify({
    factorId: data.id,
    code: totp(data.totp.secret),
  })
  if (verified.error) throw verified.error
  return { secret: data.totp.secret, codes: await createRecoveryCodes(user.client) }
}

test('changing the password signs out other devices and the new one works', async ({
  newUser,
  openAs,
}) => {
  const user = await newUser()
  const otherDevice = freshClient()
  await otherDevice.auth.signInWithPassword({ email: user.email, password: user.password })

  const page = await openAs(user)
  await page.goto('/me')
  await security(page)
    .getByRole('button', { name: t('security.password.change') })
    .click()
  const dialog = page.getByRole('dialog', { name: t('security.password.change') })
  await dialog.getByLabel(t('security.password.current'), { exact: true }).fill('not-my-password')
  await dialog.getByLabel(t('security.password.next'), { exact: true }).fill('brand-new-pass-1')
  await dialog.getByLabel(t('security.password.confirm'), { exact: true }).fill('brand-new-pass-1')
  await dialog.getByRole('button', { name: t('security.password.submit') }).click()
  await expect(dialog.getByText(t('security.password.wrongCurrent'))).toBeVisible()

  await dialog.getByLabel(t('security.password.current'), { exact: true }).fill(user.password)
  await dialog.getByRole('button', { name: t('security.password.submit') }).click()
  await expect(page.getByText(t('security.password.saved'))).toBeVisible()

  // The other device's refresh token is gone; this one keeps working.
  const refreshed = await otherDevice.auth.refreshSession()
  expect(refreshed.error).not.toBeNull()
  await page.reload()
  await expect(security(page)).toBeVisible()

  const old = await freshClient().auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  expect(old.error).not.toBeNull()
  const next = await freshClient().auth.signInWithPassword({
    email: user.email,
    password: 'brand-new-pass-1',
  })
  expect(next.error).toBeNull()

  // Supabase tells the account by email, in case it was not them.
  await expect
    .poll(async () => (await inbox(user.email)).map((m) => m.subject))
    .toContain('Your Potluck password was changed')
})

test('sign out everywhere ends every session', async ({ newUser, openAs }) => {
  const user = await newUser()
  // Another device, with its own session, that has a page open.
  const phone = await openAs(null)
  await signIn(phone, user.email, user.password)
  await expect(phone).toHaveURL(/\/home$/)
  const phoneToken = await phone.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k))
    return key ? (JSON.parse(localStorage.getItem(key)!) as { access_token: string }) : null
  })
  expect(phoneToken).not.toBeNull()

  const page = await openAs(user)
  await page.goto('/me')
  await security(page)
    .getByRole('button', { name: t('security.sessions.signOutAll') })
    .click()
  await page
    .getByRole('dialog', { name: t('security.sessions.confirmTitle') })
    .getByRole('button', { name: t('security.sessions.signOutAll') })
    .click()
  await expect(page).toHaveURL(/\/sign-in/)
  expect((await user.client.auth.refreshSession()).error).not.toBeNull()
  await page.goto('/home')
  await expect(page).toHaveURL(/\/sign-in/)

  // The other device's access token has not expired, but the database no longer takes it.
  const env = stackEnv()
  const refused = await fetch(`${env.url}/rest/v1/profiles?select=id`, {
    headers: { apikey: env.publishableKey, Authorization: `Bearer ${phoneToken!.access_token}` },
  })
  expect(refused.ok).toBe(false)
  expect(((await refused.json()) as { message?: string }).message).toBe('session_ended')

  // And the device itself leaves on its next look at the app.
  await phone.goto('/groups')
  await expect(phone).toHaveURL(/\/sign-in/)
})

test('two-step sign in: set up, asked at sign in, wrong code refused, off with a code', async ({
  newUser,
  openAs,
}) => {
  const user = await newUser()
  const page = await openAs(user)
  await page.goto('/me')

  await security(page)
    .getByRole('button', { name: t('security.twoFactor.enable') })
    .click()
  const setup = page.getByRole('dialog', { name: t('security.twoFactor.setup.title') })
  await expect(setup.getByRole('img', { name: t('security.twoFactor.setup.qr') })).toBeVisible()
  const secret = (await setup.locator('code').innerText()).replace(/\s/g, '')
  await setup.getByLabel(t('security.twoFactor.code')).fill(totp(secret))
  await setup.getByRole('button', { name: t('security.twoFactor.setup.submit') }).click()

  const codes = page
    .getByRole('dialog', { name: t('security.twoFactor.recovery.title') })
    .getByRole('list', { name: t('security.twoFactor.recovery.title') })
  await expect(codes.getByRole('listitem')).toHaveCount(10)
  // Shown once: Escape does not close it, only "I saved them" does.
  await page.keyboard.press('Escape')
  await expect(codes).toBeVisible()
  await page.getByRole('button', { name: t('security.twoFactor.recovery.done') }).click()
  await expect(security(page).getByText(t('security.twoFactor.on'), { exact: true })).toBeVisible()

  // A password alone gets nowhere, in the app or through the API.
  const elsewhere = await openAs(null)
  await signIn(elsewhere, user.email, user.password)
  await expect(elsewhere).toHaveURL(/\/two-factor/)
  const halfway = freshClient()
  await halfway.auth.signInWithPassword({ email: user.email, password: user.password })
  const refused = await halfway.from('profiles').select('id').eq('id', user.id)
  expect(refused.error?.message).toBe('mfa_required')
  const upload = await halfway.storage
    .from('avatars')
    .upload(`${user.id}/sneaky.png`, new Blob(['x'], { type: 'image/png' }))
  expect(upload.error).not.toBeNull()

  await elsewhere.getByLabel(t('security.twoFactor.code')).fill('000000')
  await elsewhere.getByRole('button', { name: t('security.challenge.submit') }).click()
  await expect(elsewhere.getByText(t('security.errors.mfa_verification_failed'))).toBeVisible()
  await elsewhere.getByLabel(t('security.twoFactor.code')).fill(totp(secret))
  await elsewhere.getByRole('button', { name: t('security.challenge.submit') }).click()
  await expect(elsewhere).toHaveURL(/\/home$/)

  // Turning it off takes a code too.
  await page.reload()
  await security(page)
    .getByRole('button', { name: t('security.twoFactor.disable') })
    .click()
  const off = page.getByRole('dialog', { name: t('security.twoFactor.disableTitle') })
  await off.getByLabel(t('security.twoFactor.code')).fill(totp(secret))
  await off.getByRole('button', { name: t('security.twoFactor.disable') }).click()
  await expect(page.getByText(t('security.twoFactor.disabled'))).toBeVisible()
  await expect(
    security(page).getByRole('button', { name: t('security.twoFactor.enable') }),
  ).toBeVisible()
  // The recovery codes went with it.
  expect((await user.client.rpc('mfa_recovery_codes_left')).data).toBe(0)
})

test('recovery codes stop after five wrong tries', async ({ newUser, openAs }) => {
  const user = await newUser()
  const { codes } = await withAuthenticator(user)
  const halfway = freshClient()
  await halfway.auth.signInWithPassword({ email: user.email, password: user.password })
  for (let i = 0; i < 5; i++) {
    await expect(recoverWithCode(halfway, 'ZZZZZ-ZZZZZ')).rejects.toThrow('invalid_recovery_code')
  }

  const page = await openAs(null)
  await signIn(page, user.email, user.password)
  await page.getByRole('button', { name: t('security.challenge.useRecovery') }).click()
  await page.getByLabel(t('security.challenge.recoveryCode')).fill(codes[0]!)
  await page.getByRole('button', { name: t('security.challenge.submit') }).click()
  await expect(page.getByText(t('security.errors.too_many_attempts'))).toBeVisible()
  await expect(page).toHaveURL(/\/two-factor/)
})

test('a recovery code gets someone in without their phone', async ({ newUser, openAs }) => {
  const user = await newUser()
  const { codes } = await withAuthenticator(user)

  const page = await openAs(null)
  await signIn(page, user.email, user.password)
  await expect(page).toHaveURL(/\/two-factor/)
  await page.getByRole('button', { name: t('security.challenge.useRecovery') }).click()
  await page.getByLabel(t('security.challenge.recoveryCode')).fill('ZZZZZ-ZZZZZ')
  await page.getByRole('button', { name: t('security.challenge.submit') }).click()
  await expect(page.getByText(t('security.challenge.wrongRecovery'))).toBeVisible()

  await page.getByLabel(t('security.challenge.recoveryCode')).fill(codes[3]!.toLowerCase())
  await page.getByRole('button', { name: t('security.challenge.submit') }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByText(t('security.challenge.recovered'))).toBeVisible()

  await page.goto('/me')
  await expect(
    security(page).getByRole('button', { name: t('security.twoFactor.enable') }),
  ).toBeVisible()
})

test('a pending email change can be called off', async ({ newUser, openAs }) => {
  const user = await newUser()
  const moved = `${unique('oops').toLowerCase()}@potluck.test`
  const page = await openAs(user)
  await page.goto('/me')
  await security(page)
    .getByRole('button', { name: t('security.email.change') })
    .click()
  const dialog = page.getByRole('dialog', { name: t('security.email.change') })
  await dialog.getByRole('textbox', { name: t('security.email.newEmail') }).fill(moved)
  await dialog.getByRole('button', { name: t('security.email.submit') }).click()
  const link = await verifyLink(moved)

  await security(page)
    .getByRole('button', { name: t('security.email.cancel') })
    .click()
  await expect(page.getByText(t('security.email.cancelled', { email: user.email }))).toBeVisible()
  await expect(security(page).getByText(t('security.email.pending', { email: moved }))).toBeHidden()

  // The link that was already sent no longer moves the account.
  await page.goto(await landingFor(link, new URL(page.url()).origin))
  await expect(page.getByRole('heading', { name: t('auth.callback.failed') })).toBeVisible()
  const { data } = await freshClient().auth.signInWithPassword({
    email: user.email,
    password: user.password,
  })
  expect(data.user?.email).toBe(user.email)
})

test('changing email waits for both inboxes, then the new address signs in', async ({
  newUser,
  openAs,
}) => {
  const user = await newUser()
  const moved = `${unique('moved').toLowerCase()}@potluck.test`
  const page = await openAs(user)
  await page.goto('/me')

  await security(page)
    .getByRole('button', { name: t('security.email.change') })
    .click()
  const dialog = page.getByRole('dialog', { name: t('security.email.change') })
  await dialog.getByRole('textbox', { name: t('security.email.newEmail') }).fill(moved)
  await dialog.getByRole('button', { name: t('security.email.submit') }).click()
  await expect(page.getByText(t('security.email.sent'))).toBeVisible()
  await expect(
    security(page).getByText(t('security.email.pending', { email: moved })),
  ).toBeVisible()

  // Production asks both inboxes (the first link only says "one down"). The local stack
  // auto-confirms email, and Supabase then takes either link as enough.
  const origin = new URL(page.url()).origin
  const [oldLink, newLink] = await Promise.all([verifyLink(user.email), verifyLink(moved)])
  await page.goto(await landingFor(oldLink, origin))
  const halfway = page.getByRole('heading', { name: t('security.email.halfConfirmed') })
  await expect(halfway.or(security(page))).toBeVisible()
  if (await halfway.isVisible()) await page.goto(await landingFor(newLink, origin))
  await expect(page).toHaveURL(/\/me$/)
  await expect(security(page).getByText(moved, { exact: true })).toBeVisible()

  const signedIn = await freshClient().auth.signInWithPassword({
    email: moved,
    password: user.password,
  })
  expect(signedIn.error).toBeNull()
})

test('the language switches every screen at once and follows the account', async ({
  newUser,
  openAs,
}) => {
  // The Spanish names to look for, from the same dictionary the app loads.
  await setLocale('es')
  const spanish = { me: t('settings.title'), groups: t('nav.groups'), home: t('nav.home') }
  await setLocale('en')

  const user = await newUser()
  const page = await openAs(user)
  await page.goto('/me')

  await page.getByRole('combobox', { name: t('security.language.label') }).click()
  await page.getByRole('option', { name: LOCALES.es.name }).click()
  // Same page, no reload: the heading and the navigation are Spanish now.
  await expect(page.getByRole('heading', { level: 1, name: spanish.me })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await page.getByRole('link', { name: spanish.groups }).first().click()
  await expect(page).toHaveURL(/\/groups/)

  // A fresh device starts in English, then picks up the saved choice after signing in.
  const other = await openAs(null)
  await signIn(other, user.email, user.password)
  await expect(other).toHaveURL(/\/home$/)
  await expect(other.locator('html')).toHaveAttribute('lang', 'es')
  await expect(other.getByRole('link', { name: spanish.home }).first()).toBeVisible()
  // Amounts follow the language too.
  const zero = formatMoney(0, 'USD', { locale: LOCALES.es.intl })
  await expect(other.getByText(zero).first()).toBeVisible()
})
