---
name: add-screen-route
description: Add a new screen or URL to the Potluck web app (TanStack Router file route plus a feature screen, data hooks, strings and tests). Use when creating or moving a page in apps/web.
---

# Add a screen and route

Read `apps/web/AGENTS.md`. Existing routes and their files: `docs/agent-map.json` (`routes`).

## 1. Route file

- Signed in: `apps/web/src/routes/_app/<path>.tsx`. Signed out: `apps/web/src/routes/<path>.tsx`.
- `$param` segments are params (`_app/groups/$groupId/balances.tsx` is `/groups/:groupId/balances`);
  `a.$code.tsx` is `/a/:code`. Files and folders starting with `-` are ignored.
- Keep it thin:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { RecurringScreen } from '@/features/recurring/recurring-screen'

export const Route = createFileRoute('/_app/groups/$groupId/recurring')({
  component: RecurringScreen,
})
```

- Search params: validate with helpers from `src/lib/search.ts` (no zod in route files).
- Optional `loader: ({ params }) => { prefetch.<screen>(params) }` from `src/lib/prefetch.ts`; never
  await it.

## 2. Regenerate the route tree

```sh
pnpm gen:routes   # writes apps/web/src/routeTree.gen.ts (never edit it by hand)
```

## 3. Screen and data

- `apps/web/src/features/<feature>/<name>-screen.tsx` plus hooks in the same folder.
- Data: a function in `packages/api/src/<domain>.ts`, query keys and `queryOptions` there; the screen
  uses `useQuery(moneyQueries.x(supabase, ...))` or similar.
- Live data: `useRealtime` with invalidation (`src/lib/realtime.ts`).
- Copy: keys in `packages/i18n/src/en/<feature>.ts` (load `add-i18n-strings-and-error-code`).
- Signed-out page: add its prefix to the public list in `src/features/shell/use-auth-redirects.ts`,
  or signing out there sends people to `/sign-in`.
- Design rules: `docs/design.md` (phone first, 44px targets, both themes).

## 4. Tests

- Screen test next to it with `vi.mock('@/lib/supabase', () => import('@/test/supabase'))` and the
  render helpers in `src/test/render.tsx`.
- A journey across screens: load `add-e2e-journey`.
- Help link? Anchors in `src/features/help/topics.ts` must match a heading in the user guide repo
  ([Fermulate/potluck-docs](https://github.com/Fermulate/potluck-docs)).

## 5. Check

```sh
pnpm --filter @potluck/web exec vitest run src/features/<feature>
pnpm verify
```
