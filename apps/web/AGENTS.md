# apps/web

Vite + React 19 PWA, TanStack Router (file routes) and Query, Tailwind v4. Root rules: [../../AGENTS.md](../../AGENTS.md).

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
- After adding, moving or renaming a route file run `pnpm gen:routes` (typecheck fails until then).
  Signed-out routes must be added to the public list in `src/features/shell/use-auth-redirects.ts`.
- `/` is prerendered at build time (`prerender-landing.ts`): nothing on the landing page may touch
  `window` during render.
- Server data goes through `@potluck/api` functions and `queryOptions`; never call `supabase.from()` in
  a component.
- Realtime: subscribe with `useRealtime` / `useBatchedInvalidate` (`src/lib/realtime.ts`) and invalidate
  query keys; never patch the cache from the payload.
- Errors: show `errorMessage(error, scope)` from `src/lib/errors.ts` (scopes `expenses.errors`,
  `events.errors`, then `errors.codes`). Not found is `isNotFoundError()`.
- Dates: always pass the viewer's zone from `resolveTimeZone` (`src/lib/locale.ts`); calendar dates
  (`spent_at`, windows) render pinned to UTC.
- Money: `fx_rate` arrives as decimal text; pass it to `convert()` unchanged.
- UI copy: `t()` keys only. Visual rules: [docs/design.md](../../docs/design.md).

## Tests

- jsdom + Testing Library. Thresholds in `vite.config.ts` (70% lines, 75% branches, 85% functions).
- Screens that fetch: `vi.mock('@/lib/supabase', () => import('@/test/supabase'))`, then seed tables
  or queue RPC answers on the shared fake; `emitChange` replays a realtime change.
- Components fed from a seeded query cache, writes mocked at the `@potluck/api` boundary:
  `src/features/expenses/fake-supabase.ts`.
- Fixtures: `src/test/fixtures.ts`, `src/test/plan-fixtures.ts`, `src/features/expenses/test-utils.ts`.
  A new `expenses` column must be added to the hand-built fixtures.
- Render helpers with router and query client: `src/test/render.tsx`,
  `src/features/expenses/router-test-utils.ts`.

## e2e

- Needs the local stack and `.env.local`. `global-setup.ts` reads keys at run time; nothing is written
  to the repo.
- Each test makes its own users with `newUser()` and opens pages with `openAs(user)` (`openAs(null)` is
  signed out). Set up groups and expenses through `e2e/support/api.ts`, not the UI.
- Selectors are roles and labels built with `t()` from `@potluck/i18n`, never CSS classes or test ids.
- Keep e2e to journeys; anything testable lower in the pyramid goes there.
