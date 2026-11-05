import { createSupabaseClient, type PotluckClient } from '@potluck/api'
import { test as base, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import { createClient, type Session } from '@supabase/supabase-js'
import { stackEnv } from './env'

export interface TestUser {
  id: string
  email: string
  password: string
  name: string
  /** Signed in as this user, for setup through the API. */
  client: PotluckClient
  session: Session
}

export interface NewUserOptions {
  name?: string
  /** Leave false to go through onboarding in the browser. */
  onboarded?: boolean
  currency?: string
}

export const PASSWORD = 'potluck-e2e-pass'

let counter = 0

/** Unique per run, worker and call, so parallel tests never share rows. */
export function unique(prefix: string): string {
  counter += 1
  const stamp = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 6)
  return `${prefix}-${stamp}${rand}${counter}`
}

function adminClient() {
  const env = stackEnv()
  return createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function storageKey(url: string): string {
  return `sb-${new URL(url).hostname.split('.')[0]}-auth-token`
}

export async function createUser(options: NewUserOptions = {}): Promise<TestUser> {
  const env = stackEnv()
  const name = options.name ?? unique('Tester')
  const email = `${unique('e2e').toLowerCase()}@potluck.test`
  const admin = adminClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      display_name: name,
      timezone: 'UTC',
      ...(options.onboarded === false ? {} : { onboarded: true }),
    },
  })
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`)
  if (options.currency) {
    const { error: profileError } = await admin
      .from('profiles')
      .update({ default_currency: options.currency })
      .eq('id', data.user.id)
    if (profileError) throw new Error(profileError.message)
  }

  const client = createSupabaseClient(env.url, env.publishableKey)
  const signIn = await client.auth.signInWithPassword({ email, password: PASSWORD })
  if (signIn.error || !signIn.data.session) {
    throw new Error(`signIn failed: ${signIn.error?.message}`)
  }
  return { id: data.user.id, email, password: PASSWORD, name, client, session: signIn.data.session }
}

/** Context options from the running project, so extra users get the same device. */
function deviceOptions(testInfo: TestInfo) {
  const use = testInfo.project.use
  return {
    baseURL: use.baseURL,
    viewport: use.viewport,
    hasTouch: use.hasTouch,
    isMobile: use.isMobile,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    locale: use.locale,
    timezoneId: use.timezoneId,
    serviceWorkers: use.serviceWorkers,
    colorScheme: use.colorScheme,
  }
}

export async function pageAs(
  browser: Browser,
  testInfo: TestInfo,
  user: TestUser | null,
): Promise<Page> {
  const options = deviceOptions(testInfo)
  const origin = new URL(options.baseURL ?? 'http://localhost:4173').origin
  const context = await browser.newContext({
    ...options,
    acceptDownloads: true,
    storageState: user
      ? {
          cookies: [],
          origins: [
            {
              origin,
              localStorage: [
                { name: storageKey(stackEnv().url), value: JSON.stringify(user.session) },
              ],
            },
          ],
        }
      : undefined,
  })
  return context.newPage()
}

interface Fixtures {
  /** Creates a fresh, onboarded user (or not, with `onboarded: false`). */
  newUser: (options?: NewUserOptions) => Promise<TestUser>
  /** Opens a new browser context signed in as `user` (signed out with null). */
  openAs: (user: TestUser | null) => Promise<Page>
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  newUser: async ({}, provide) => {
    await provide((options) => createUser(options))
  },
  openAs: async ({ browser }, provide, testInfo) => {
    const pages: Page[] = []
    await provide(async (user) => {
      const page = await pageAs(browser, testInfo, user)
      pages.push(page)
      return page
    })
    const failed = testInfo.status !== testInfo.expectedStatus
    for (const [i, page] of pages.entries()) {
      if (failed && !page.isClosed()) {
        await testInfo
          .attach(`page-${i + 1}`, { body: await page.screenshot(), contentType: 'image/png' })
          .catch(() => undefined)
      }
      await page.context().close()
    }
  },
})

export { expect }
