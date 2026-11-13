# apps/web

Vite + React 19 PWA, TanStack Router (file routes) and Query, Tailwind v4. Root rules: [../../AGENTS.md](../../AGENTS.md).
Per-feature notes (payers and refunds, repeating expenses, language, two-step sign in, payments):
[development](../../docs/development.md#web-feature-notes). Visual rules: [design](../../docs/design.md).

## Layout

- `src/routes/`: thin route files. Signed-in screens under `routes/_app/` (the layout redirects to
  `/sign-in` or `/welcome`). Files or folders starting with `-` are ignored by the router.
- `src/features/<feature>/`: screens, hooks and their tests. Import with the `@/` alias.
- `src/lib/`: shared app plumbing (`supabase.ts`, `errors.ts`, `realtime.ts`, `prefetch.ts`, `search.ts`).
- `e2e/`: Playwright specs and `support/` (fixtures, api setup).

## Rules

- Route files are in the first download: no schema libraries (search params use `src/lib/search.ts`),
  no feature imports beyond the screen. A `loader` may call `prefetch.<screen>()` from
  `src/lib/prefetch.ts` and must not await it.
- `/a/$code` (guest links) is signed out. `/` is prerendered (`prerender-landing.ts`): nothing on the
  landing page may touch `window` during render.
- Server data goes through `@potluck/api` functions and `queryOptions`; never `supabase.from()` in a component.
- Realtime: subscribe with `useRealtime` / `useBatchedInvalidate` (`src/lib/realtime.ts`) and invalidate
  query keys; never patch the cache from the payload.
- Errors: `errorMessage(error, scope)` from `src/lib/errors.ts` (scopes `expenses.errors`,
  `events.errors`, then `errors.codes`). Not found is `isNotFoundError()`.
- Dates: pass the viewer's zone from `resolveTimeZone` (`src/lib/locale.ts`); calendar dates
  (`spent_at`, windows) render pinned to UTC. Amounts and dates take `intlLocale()`, never `DEFAULT_LOCALE`
  (landing only).
- Money: pass `fx_rate` (decimal text) to `convert()` unchanged. Read who paid with `payersOf()`, never
  `paid_by` alone; the viewer's line comes from core `expenseEffect`.
- Categories: `CategoryPicker`; new expenses follow core `suggestCategory`; deleted groups and covers: ADR 20.

## Tests

- jsdom + Testing Library. Thresholds in `vite.config.ts` (70% lines, 75% branches, 85% functions).
- Screens that fetch: `vi.mock('@/lib/supabase', () => import('@/test/supabase'))`, then seed tables
  or queue RPC answers on the shared fake; `emitChange` replays a realtime change.
- Components fed from a seeded query cache, writes mocked at the `@potluck/api` boundary:
  `src/features/expenses/fake-supabase.ts`.
- Fixtures: `src/test/fixtures.ts`, `src/test/plan-fixtures.ts`, `src/features/expenses/test-utils.ts`.
- Render helpers with router and query client: `src/test/render.tsx`,
  `src/features/expenses/router-test-utils.ts`.

## e2e

- Needs the local stack and `.env.local`. `global-setup.ts` reads keys at run time; nothing is written
  to the repo.
- Each test makes its own users with `newUser()` and opens pages with `openAs(user)` (`openAs(null)` is
  signed out). Set up groups and expenses through `e2e/support/api.ts`, not the UI.
- Selectors are roles and labels built with `t()` from `@potluck/i18n`, never CSS classes or test ids.
- Keep e2e to journeys; anything testable lower in the pyramid goes there.
- `support/totp.ts` makes authenticator codes from a secret; `support/mail.ts` reads Mailpit and opens
  Supabase verify links on the test server's origin.
