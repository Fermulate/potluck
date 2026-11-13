# AGENTS.md

Potluck: free (AGPL-3.0) Splitwise-style expense splitting plus group event planning.
A static Vite + React PWA talks straight to Supabase; Postgres RLS and `security definer` RPCs are the whole backend.
pnpm + turbo monorepo. Platform-neutral packages are kept for a future Expo app.

The nearest `AGENTS.md` to the file you edit adds rules for that directory:
[apps/web](apps/web/AGENTS.md), [packages/core](packages/core/AGENTS.md), [packages/api](packages/api/AGENTS.md),
[packages/i18n](packages/i18n/AGENTS.md), [supabase](supabase/AGENTS.md).

| Path                  | What                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`            | the PWA: routes, feature screens and hooks, Playwright e2e                                                                          |
| `packages/core`       | split math, balances, FX, slots, recurrence, roles (no DOM)                                                                         |
| `packages/api`        | typed Supabase queries and mutations (no DOM)                                                                                       |
| `packages/i18n`       | strings per feature, `t()`, money and date formatting                                                                               |
| `packages/tokens`     | design tokens (no DOM); `packages/ui`: web React components                                                                         |
| `supabase`            | migrations, pgTAP tests, edge functions, seed, schema snapshot                                                                      |
| `docs/agent-map.json` | generated index: routes, RPCs (args, grants, errors), tables (RLS, policies, realtime), error codes with i18n keys, i18n namespaces |

## Commands

Non-interactive shells need `export CI=true npm_config_virtual_store_dir_max_length=50` (pnpm prompts; Windows path length).

```sh
pnpm install
pnpm verify                     # = CI "check" job: prettier, eslint, generated files, typecheck,
                                #   test:coverage, test:functions, production build
pnpm verify --concurrency=1     # same, gentler on memory; --only=lint,typecheck runs a subset
pnpm verify:db                  # = CI "db" job: db lint, pgTAP, schema snapshot, db types
pnpm --filter @potluck/core exec vitest run src/currency/currency.test.ts   # one unit test file
pnpm --filter @potluck/web exec vitest run src/lib/errors.test.ts
pnpm exec supabase test db supabase/tests/000_setup.test.sql supabase/tests/06_expenses.test.sql
node --test supabase/functions/notify/message.test.ts                      # one edge fn test
pnpm --filter @potluck/web exec playwright test e2e/expenses.spec.ts --project=desktop-chromium
```

Regenerate (never hand-edit the outputs; a PreToolUse hook blocks it for Claude Code):

| Output                                         | Command           | Needs         | CI check         |
| ---------------------------------------------- | ----------------- | ------------- | ---------------- |
| `apps/web/src/routeTree.gen.ts`                | `pnpm gen:routes` | nothing       | `pnpm verify`    |
| `packages/api/src/database.types.ts`           | `pnpm db:types`   | local DB      | `pnpm verify:db` |
| `supabase/schema/current.sql`                  | `pnpm gen:schema` | local DB      | `pnpm verify:db` |
| `docs/agent-map.json`                          | `pnpm gen:map`    | the two above | `pnpm verify`    |
| `.claude/skills/**` (copy of `.agents/skills`) | `pnpm gen:skills` | nothing       | `pnpm verify`    |

`pnpm gen` runs the three without a database; `pnpm gen:db` runs types, snapshot and map.

Done means: `pnpm verify` passes; if `supabase/` changed, `pnpm db:reset` then `pnpm verify:db`
passes; if a journey changed, its e2e spec passes. Report the commands you ran and their result.

## Hard rules

- Money is integer minor units (`bigint` in SQL, safe integers in TS). No floats, no `toBeCloseTo`.
  Convert with `convert()` from `@potluck/core`; read `fx_rate` as text (`fx_rate::text`), never as a
  JSON number. A money or scheduling rule lives in SQL and in `packages/core`: change both, test both
  with the same cases.
- Lock order: an RPC that moves a balance takes `perform 1 from public.groups g where g.id = gid for share`
  before `private.require_member(gid)` and before touching any expense or payment row. Several groups:
  lock in id order.
- Departed members: nothing may move a former member's balance. Restore, delete, or editing amount,
  currency, payer or split of an expense that names someone who left raises `split_member_not_in_group`;
  payments raise `member_not_in_group`. Details stay editable.
- Archived groups: every write calls `private.require_unarchived(gid)` (money) or
  `private.require_group_open(gid)` (others) and raises `group_archived`. Direct-write tables use a trigger
  plus the same check in the policy.
- Errors: `raise exception using message = '<snake_code>', detail = '<English>', errcode = '<state>'`,
  state one of `42501` (auth), `PT404` (not found), `22023` (input), `23514` (business rule).
  Never `P0002` (HTTP 500); old migrations still show it, do not copy them.
- New public function: `security definer`, `set search_path = ''`, schema-qualify every name, then
  `revoke execute on function public.f(...) from public, anon;` and
  `grant execute on function public.f(...) to authenticated, service_role;`. Supabase's default
  privileges grant execute on every new public function to `anon`, so without this anon can call it. Only `invite_preview` and `email_unsubscribe` are anon-callable; adding one
  means updating `01_schema.test.sql`, ADR 4 and `docs/security.md`.
- Every new table in `public`: RLS on, policies with `(select auth.uid())` and
  `group_id = any (array(select private.my_group_ids()))`, revoke-all then column grants, an index per
  foreign key, pgTAP for who can and who cannot.
- Migrations are additive and immutable once on `main`. Breaking RPC change = new `_v2` function
  ([ADR 8](docs/adr/0008-additive-migrations-and-versioned-rpcs.md)). Create files with
  `pnpm exec supabase migration new <name>`; the timestamp must sort after the newest migration on `main`.
- Strings go through `packages/i18n` (`t('typed.key')`; a wrong key fails typecheck). Add keys to the
  feature file in `packages/i18n/src/en/`, never inline copy. Server error codes need wording (see
  `apps/web/src/lib/server-codes.test.ts`).
- `packages/core`, `api`, `tokens`, `i18n` must not import `react-dom`, `@potluck/ui` or use DOM globals.
- No em or en dashes anywhere: code, comments, copy, docs, commit messages.
- Tests go through public interfaces; no tests that snapshot or grep app source. Reading SQL migrations
  as a contract (as `server-codes.test.ts` does) is fine.

## Never

- Never write to production. The Supabase MCP server in `.mcp.json` is the local stack only; do not
  add the hosted one with write access, and never run `apply_migration` / `execute_sql` against project
  `mzotlkpghnrwbezcazld`. Production schema changes only via `supabase db push` in `deploy.yml`.
- Never edit a migration that is on `main`, a generated file, or `.claude/skills` (edit `.agents/skills`).
- Never run `pnpm db:reset` or `supabase stop` on a stack someone else is using (see below).
- Never push, open a PR, or deploy unless asked. Never commit `.env*` files or keys.

## Schema change checklist

`supabase/tests/01_schema.test.sql` pins the schema. Update it, and bump `plan(N)`, when you add:
a table (`tables_are`), a public RPC (`has_function`), an anon-callable RPC (anon allowlist), a realtime
table (publication `set_eq`), an `app_config` key (seed rows) or a cron job. Then:
`pnpm db:reset` -> `pnpm db:test` -> `pnpm gen:db` -> `pnpm verify`. Update `docs/architecture.md`
(tables, RPC table, error list, realtime) in the same PR. Making a table live also needs an RLS
`select` policy and a `useRealtime` subscription; `groups` is not published.

## Finding the live SQL

Functions are redefined across migrations (`settle_up` three times). Read the live version in
`supabase/schema/current.sql`, e.g. `grep -n 'FUNCTION "public"."settle_up"' supabase/schema/current.sql`.
`docs/agent-map.json` gives each function's `snapshotLine` and `definedIn` (newest migration that
defines it). To redefine one, copy that body and say so in the migration header.

## Shared local stack and worktrees

- One Supabase stack per machine: `project_id = "potluck"`, ports 54321 to 54324, shared by every
  checkout and worktree. `pnpm db:reset` drops all data and applies _your_ branch's migrations for
  everyone; pgTAP and `verify:db` run against whatever was reset last. Check `pnpm exec supabase status`.
- To isolate, copy `supabase/config.toml` with a new `project_id` and port block, and point `.env.local`
  at it.
- e2e builds and serves on 4173 and reuses a server already there (maybe another worktree's build).
  Set `E2E_PORT` to run beside another checkout. e2e creates users and sets today's EUR to USD rate to
  1.1 in the dev database; pgTAP files that need rates `delete from public.fx_rates` first.
- A new worktree needs its own `pnpm install` and a copy of `.env.local`. `.claude/worktrees/` is
  ignored by git, eslint and prettier.

## Traps

- `pnpm build` (production) refuses to run without `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_APP_URL`; `pnpm verify` supplies CI placeholders.
- A new route file fails typecheck until `pnpm gen:routes`. Signed-out routes must also be allowed in
  `apps/web/src/features/shell/use-auth-redirects.ts`.
- Expense and activity triggers compare explicit column lists: a new `expenses` column is not logged as
  `expense.updated` unless you add it there.
- Hand-built `Expense` fixtures (`apps/web/src/features/expenses/test-utils.ts` and friends) must gain
  any new column.
- The user guide lives in another repo, [Fermulate/potluck-docs](https://github.com/Fermulate/potluck-docs);
  anchors in `apps/web/src/features/help/topics.ts` must match its headings.

## Skills

Step-by-step recipes in `.agents/skills/` (copied to `.claude/skills/`). Load the one that fits:

| Skill                             | Use when                                                   |
| --------------------------------- | ---------------------------------------------------------- |
| `add-migration-and-rpc`           | any schema change: table, column, RPC, policy, trigger     |
| `write-pgtap-test`                | testing RLS, an RPC or a trigger in `supabase/tests`       |
| `money-change-checklist`          | anything touching amounts, splits, balances, FX, settle up |
| `add-i18n-strings-and-error-code` | new copy, a new namespace, or a new server error code      |
| `add-screen-route`                | a new screen or URL in `apps/web`                          |
| `add-e2e-journey`                 | a Playwright spec for a user journey                       |

## Deeper docs

[development](docs/development.md) (setup, migrations, pgTAP helpers, strings, routes),
[architecture](docs/architecture.md) (schema, RPCs, security, realtime, money rules),
[testing](docs/testing.md), [security](docs/security.md), [sequences](docs/sequences.md),
[ADRs](docs/adr/README.md), [CONTRIBUTING](CONTRIBUTING.md) (branches, commits, PRs).
