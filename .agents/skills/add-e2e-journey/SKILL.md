---
name: add-e2e-journey
description: Write or extend a Playwright end-to-end journey in apps/web/e2e for Potluck, with per-test users, i18n-based selectors and the shared local stack. Use when a user flow spans screens or needs realtime between two people.
---

# Add an e2e journey

Keep e2e to journeys; anything a unit or pgTAP test can cover belongs there. Specs and what they
cover: `docs/testing.md`, "End-to-end tests".

## Prerequisites

- Local stack running (`pnpm exec supabase status`) and `.env.local` pointing at it.
- Browsers once: `pnpm --filter @potluck/web exec playwright install chromium webkit`.
- Port 4173 free, or another checkout's server will be reused. Use `E2E_PORT=4174` to run beside it.
- e2e writes to the shared dev database (new users, today's EUR to USD rate set to 1.1).

## Write it

```ts
import { formatMoney, t } from '@potluck/i18n'
import { addEqualExpense, groupWith } from './support/api'
import { expect, test, unique } from './support/fixtures'

test('a member sees what they owe', async ({ newUser, openAs }) => {
  const [me, ben] = await Promise.all([
    newUser({ name: unique('Ava') }),
    newUser({ name: unique('Ben') }),
  ])
  const group = await groupWith(me, [ben])
  await addEqualExpense(ben, group, [me, ben], 6000, unique('Pizza'))

  const page = await openAs(me)
  await page.goto(`/groups/${group.id}/balances`)
  await expect(
    page.getByText(t('balances.youOwe', { name: ben.name, amount: formatMoney(3000, 'USD') })),
  ).toBeVisible()
})
```

- Users: `newUser()` fixture (fresh, confirmed, onboarded), `unique(prefix)` for names; pages:
  `openAs(user)`, `openAs(null)` for signed out (`e2e/support/fixtures.ts`).
- Setup through `e2e/support/api.ts` (`groupWith`, `addEqualExpense`: real `@potluck/api` calls as
  that user), not through the UI.
- Selectors: roles and labels from `t()`. No CSS classes, no test ids, no seed rows; unique names per test.
- Two people and realtime: open two pages and assert the second updates without a reload.

## Run

```sh
pnpm --filter @potluck/web exec playwright test e2e/<spec>.spec.ts --project=desktop-chromium
pnpm --filter @potluck/web exec playwright test e2e/<spec>.spec.ts --project=mobile-chromium
pnpm --filter @potluck/web exec playwright show-report   # after a failure
```

The config builds the app and serves it with `vite preview`. After changing app code with a server
still running, stop it (or rebuild) before rerunning. Add the spec to the table in `docs/testing.md`.
