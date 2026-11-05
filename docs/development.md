# Development

Everything you need to run Potluck on your machine and change it. For how changes get reviewed and merged, see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

| Tool    | Version                       | Notes                                                                    |
| ------- | ----------------------------- | ------------------------------------------------------------------------ |
| Node.js | 22.12 or newer (`.nvmrc`: 22) | `engine-strict=true` in `.npmrc`, so an older Node fails the install     |
| pnpm    | 9 (`packageManager` pins 9.15.9) | `corepack enable` picks the pinned version                               |
| Docker  | recent Docker Desktop or Engine | runs the local Supabase stack                                            |
| Git     | any recent                    | on Windows, see [Windows notes](#windows-notes)                          |

The Supabase CLI comes in as a dev dependency, so `pnpm db:start` works without a global install. `npx supabase <command>` runs the same binary for commands without a script.

## First run

```sh
git clone https://github.com/Fermulate/potluck.git
cd potluck
pnpm install
pnpm db:start                 # Postgres, Auth, Storage, Realtime, Studio in Docker
cp .env.example .env.local    # then paste the publishable key printed by db:start
pnpm dev                      # http://localhost:5173
```

`db:start` applies every migration and loads `supabase/seed.sql`, so you can sign in straight away with a [demo account](#demo-data).

## Environment variables

The web app reads `.env.local` from the repo root (`envDir` in `apps/web/vite.config.ts`). Only `VITE_*` variables reach the browser, and everything in them is public.

| Variable                        | Local value                                      | What it is                                                     |
| ------------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | `http://127.0.0.1:54321`                         | Supabase API URL                                               |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | printed by `pnpm db:start` (`npx supabase status`) | publishable (anon) key. RLS decides what it can do            |
| `VITE_APP_URL`                  | `http://localhost:5173`                          | base URL for links the app builds (invites, redirects)         |
| `VITE_VAPID_PUBLIC_KEY`         | empty, or your own key                           | web push public key. Leave empty to turn push off locally      |

`.env` and `.env.*` are git-ignored except `.env.example`. Server-side secrets never go in these files; see [deployment.md](deployment.md#edge-function-secrets).

## Local Supabase

`supabase/config.toml` drives the local stack. Ports:

| Service                          | URL                                                       |
| -------------------------------- | --------------------------------------------------------- |
| API (PostgREST, Auth, Storage)   | http://127.0.0.1:54321                                    |
| Postgres                         | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Studio                           | http://127.0.0.1:54323                                    |
| Email catcher (sign-up and magic link mail) | http://127.0.0.1:54324                         |

Local auth differs from production on purpose: email confirmation is off, the minimum password length is 6, and MFA is off. The production values are under `[remotes.production]` in the same file.

Useful commands:

```sh
pnpm db:start        # start the stack (no-op if it is already running)
npx supabase status  # URLs and keys again
pnpm db:reset        # drop and rebuild from migrations + seed
npx supabase stop    # stop containers, keep data
```

### Edge functions locally

Database hooks (`notify` on new notifications, the daily `fx-sync`) do nothing locally, because the Vault secrets `project_url` and `edge_secret` do not exist there. That keeps tests and seeding from making network calls.

To work on a function, serve it and call it yourself:

```sh
# supabase/functions/.env (git-ignored)
EDGE_SECRET=any-long-random-string
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
APP_URL=http://localhost:5173
```

```sh
npx supabase functions serve --env-file supabase/functions/.env
curl -X POST http://127.0.0.1:54321/functions/v1/fx-sync \
  -H "x-potluck-secret: any-long-random-string"
```

Generate a VAPID key pair with `npx web-push generate-vapid-keys`. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the runtime.

To exercise the hooks end to end, create the two Vault secrets in your local database, with `project_url` set to an address the database container can reach (for example `http://host.docker.internal:54321`), and `edge_secret` equal to `EDGE_SECRET`.

## Demo data

`supabase/seed.sql` writes through the real RPCs, so balances, activity and notifications look like production. All dates are relative to now.

| Email               | Name       | Role                                  |
| ------------------- | ---------- | ------------------------------------- |
| `ava@potluck.test`  | Ava Chen   | owns Hike crew                        |
| `ben@potluck.test`  | Ben Ortiz  | owns Roommates, admin of Hike crew    |
| `cleo@potluck.test` | Cleo Park  | admin of Roommates                    |
| `dev@potluck.test`  | Dev Patel  | admin of Dim sum club                 |
| `eli@potluck.test`  | Eli Novak  | member                                |
| `fay@potluck.test`  | Fay Okafor | owns Dim sum club, 1:1 with Ava       |

Password for all of them: `potluck-demo`. Open http://localhost:5173/join/hikecrew-demo to try the invite flow. The seed also has about 30 expenses across every split type (one in EUR), settlements, a polling hike with availability from five people and an open request, and a scheduled taco night with RSVPs.

## Scripts

Run from the repo root. Turbo runs the per-package scripts in dependency order and caches what it can.

| Command          | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| `pnpm dev`       | Vite dev server for `apps/web`                                  |
| `pnpm build`     | production build of every package that has one                 |
| `pnpm typecheck` | `tsc --noEmit` in every workspace                               |
| `pnpm lint`      | ESLint over the repo, zero warnings allowed                     |
| `pnpm test`      | Vitest in every workspace                                       |
| `pnpm format`    | Prettier over the repo                                          |
| `pnpm db:start`  | start local Supabase                                            |
| `pnpm db:reset`  | rebuild the local database from migrations and seed            |
| `pnpm db:types`  | regenerate `packages/api/src/database.types.ts`                 |
| `pnpm db:test`   | run the pgTAP tests in `supabase/tests`                         |

Filter to one package with `pnpm --filter @potluck/core test`, or run Vitest in watch mode inside a package with `pnpm vitest`.

## Windows notes

- **Path length.** pnpm's virtual store paths can pass the Windows limit, which shows up as `ERR_PACKAGE_IMPORT_NOT_DEFINED` from Vite or Vitest. The repo's `.npmrc` sets `virtual-store-dir-max-length=50` to prevent it. If you still hit it (an old `node_modules`, or a global config overriding it), delete `node_modules` and reinstall with the variable set:

  ```sh
  export npm_config_virtual_store_dir_max_length=50
  pnpm install
  ```

  `git config --global core.longpaths true` avoids the same problem in Git.

- **Line endings.** `.gitattributes` forces LF. If your editor writes CRLF, Prettier and ESLint will complain.
- **Shell.** The scripts assume a POSIX shell. Git Bash or WSL both work; `db:types` uses `>` redirection, which PowerShell also handles.
- **Docker.** Docker Desktop with the WSL 2 backend runs the Supabase stack. Give it at least 4 GB of memory.

## Regenerating database types

`packages/api/src/database.types.ts` is generated from the local database. After any migration:

```sh
pnpm db:reset   # apply the migration from scratch
pnpm db:types   # supabase gen types typescript --local, then prettier
```

Commit the regenerated file in the same PR as the migration. Do not edit it by hand.

## Writing a migration

1. `npx supabase migration new <short_name>` creates `supabase/migrations/<timestamp>_<short_name>.sql`.
2. Follow the existing patterns:
   - `revoke all ... from anon, authenticated`, then grant the exact columns clients need.
   - `alter table ... enable row level security` and policies for every new table in `public`. Use `(select auth.uid())` and the helpers in `private` (`my_group_ids()`, `is_group_admin()`, ...).
   - Functions: `security definer` only when they must bypass RLS, always `set search_path = ''`, schema-qualify every name, raise errors as `message = '<snake_case_code>', detail = '<English>', errcode = '<sqlstate>'`.
   - Helpers that clients must not call go in `private` and get an explicit `grant execute` only if a policy needs them.
   - Additive only. A breaking RPC change is a new `_v2` function ([ADR 8](adr/0008-additive-migrations-and-versioned-rpcs.md)).
3. If the change affects money or scheduling rules, change the matching function in `packages/core` too and test both.
4. Add error codes the client can show to the `errors` namespace in `packages/i18n/src/en/shell.ts`.
5. `pnpm db:reset`, `pnpm db:test`, `pnpm db:types`.
6. Update [architecture.md](architecture.md) if you added a table, RPC, bucket, channel or job.

Never change the schema in the Supabase dashboard. Production is only changed by `supabase db push` from the deploy workflow.

## Writing pgTAP tests

Tests live in `supabase/tests/*.test.sql` and run in file name order. `000_setup.test.sql` installs helpers in a `tests` schema:

| Helper                                               | Does                                                    |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `tests.create_user('alice')`                         | auth user `alice@test.local`, returns the id            |
| `tests.uid('alice')`                                 | that user's id                                          |
| `tests.login('alice')` / `tests.login_anon()`        | switch to the `authenticated` or `anon` role with JWT claims |
| `reset role`                                         | back to the superuser                                   |
| `tests.group_with(owner, members[], admins[], name, currency)` | builds a group directly, returns its id. Everything after `owner` is optional |
| `tests.remember('g', id)` / `tests.id('g')`          | stash ids between statements                            |
| `tests.people('alice', 'bob')`                       | split payload `[{user_id}, ...]`                        |

A test file is one transaction that rolls back:

```sql
begin;
select plan(3);

select tests.create_user('owner');
select tests.create_user('stranger');
select tests.remember('g', tests.group_with('owner'));

select tests.login('stranger');
select is((select count(*)::int from public.groups), 0, 'non-members see no groups');
select throws_ok(
  format($$ select public.create_invite(%L) $$, tests.id('g')),
  '42501', 'not_a_member', 'non-members cannot invite'
);

select tests.login('owner');
select lives_ok(
  format($$ select public.create_invite(%L) $$, tests.id('g')),
  'the owner can invite'
);

select * from finish();
rollback;
```

For every policy, test both sides: who can read or write, and who cannot. For every RPC, test the rejections, not only the happy path.

## Adding strings

1. Find the feature file in `packages/i18n/src/en/` (`groups.ts`, `money.ts`, `plans.ts`, ...). Add the key there, never in `en.ts`.
2. Use `{name}` placeholders and pass already formatted values (`formatMoney`, `formatDate`). For counts, add `_one` and `_other` (and optionally `_zero`) siblings and look up the base key with `{ count }`.
3. No em or en dashes in copy. The voice notes are at the top of `en.ts` and in [design.md](design.md).
4. In code: `t('expenses.paidSummary', { name, amount })`. A wrong key or a missing placeholder fails `pnpm typecheck`.

A new namespace needs one line in `en.ts` to add it to the dictionary.

## Adding a route

Routes are files under `apps/web/src/routes/`, picked up by the TanStack Router Vite plugin, which regenerates `routeTree.gen.ts` while `pnpm dev` or `pnpm build` runs. Do not edit that file.

- Signed-in screens go under `routes/_app/`. The `_app.tsx` layout redirects to `/sign-in` without a session and renders the navigation.
- `$param` segments become params: `routes/_app/groups/$groupId/balances.tsx` is `/groups/:groupId/balances`.
- Files and folders starting with `-` are ignored by the router (`routes/-dev-kit/`), so colocated helpers go there.
- Keep route files thin. Put screens and hooks in `apps/web/src/features/<feature>/` and import them.
- Code splitting is automatic (`autoCodeSplitting: true`).

```tsx
// apps/web/src/routes/_app/groups/$groupId/recurring.tsx
import { createFileRoute } from '@tanstack/react-router'
import { RecurringScreen } from '@/features/recurring/recurring-screen'

export const Route = createFileRoute('/_app/groups/$groupId/recurring')({
  component: RecurringScreen,
})
```

Deep links work in production because the Worker serves `index.html` for unknown paths.
