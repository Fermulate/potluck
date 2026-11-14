# supabase

Postgres is the backend: migrations, RLS, `security definer` RPCs, triggers, cron, storage, edge functions.
Root rules: [../AGENTS.md](../AGENTS.md) (read its "Shared local stack" before `db:reset` or `stop`).
Recipes: the `add-migration-and-rpc` and `write-pgtap-test` skills. Notes per feature (payers,
repeating expenses, guests, two-step sign in, seats, notifications):
[architecture](../docs/architecture.md#migration-notes-by-feature).

## Where things are

- `migrations/`: applied in name order. Many functions are redefined later; the live schema is
  `schema/current.sql` (generated, never edit; `pnpm gen:schema`).
- `tests/*.test.sql`: pgTAP, run in name order, one rolled-back transaction each. `000_setup` installs
  the `tests.*` helpers; `01_schema` pins the schema shape (see its header). A new file takes the
  next free number after the highest one in `tests/` (`ls supabase/tests`).
- `functions/<name>/index.ts`: Deno edge functions. Logic worth testing lives in a sibling module with
  no Deno imports, tested by `pnpm test:functions` (Node's test runner, `*.test.ts`).
  `verify_jwt` per function is in `config.toml`; auth schemes are in `docs/architecture.md`.
- `seed.sql`: demo data written through the real RPCs. `snippets/`: local perf data only.

## Writing a migration

- `pnpm exec supabase migration new <name>`; never pick a timestamp by hand. Rebase and rename if
  `main` gained a newer file.
- Redefining a function: copy its body from `schema/current.sql`, not from the first migration, and
  write "Body as in <file> plus ..." in the header.
- RPC skeleton (group row lock only when a balance moves; group row before any expense or payment row):

  ```sql
  create or replace function public.<name>(gid uuid, ...) returns ...
  language plpgsql security definer set search_path = '' as $$
  #variable_conflict use_column
  declare uid uuid := private.require_user();
  begin
    perform 1 from public.groups g where g.id = gid for share;  -- bulk settles: for no key update
    perform private.require_member(gid);
    perform private.require_group_open(gid);  -- money RPCs: private.require_unarchived(gid)
    -- role checks, then:
    -- raise exception using message = '<code>', detail = '<English>', errcode = '23514';
  end; $$;
  revoke execute on function public.<name>(uuid, ...) from public, anon;
  grant execute on function public.<name>(uuid, ...) to authenticated, service_role;
  ```

- Helpers clients must not call go in `private` (default privileges revoke execute there); grant only
  what a policy needs.
- Small immutable per-row SQL helpers (`private.minor_units`, `private.convert_minor`) use a
  SQL-standard body and no `set` clause so they inline; their `function_search_path_mutable` advisor
  warning is expected.
- Balances and departed checks read `expense_payers`, not `expenses.paid_by` (ADR 12).
- Repeating expense edits go through `update_recurring_expense`, never new direct grants.
- Availability reads (`best_slots`, heat) count `event_guest_availability` too.
- Any per-request rule goes in `private.check_request()` (PostgREST runs one pre-request function). A
  table added to `supabase_realtime` needs the restrictive "two-step sign in done" `select` policy.
- A new notification type is ONE row in your migration, or it ignores settings and is never emailed:
  `insert into private.notification_types (type, category) values ('<type>', '<category>') on conflict (type) do nothing;`
  Then its copy (inbox, push, email) and, for a new category, its rows and labels: see the feature notes linked at the top.
- Deleted groups (ADR 20) keep their rows 30 days; raw `group_members` / `groups` reads add `g.deleted_at is null`.
- After the migration: `pnpm db:reset`, `pnpm db:test`, `pnpm gen:db`, then update `01_schema.test.sql`
  and `docs/architecture.md`.

## pgTAP

- Helpers ([full list](../docs/development.md#writing-pgtap-tests)): `tests.create_user('alice')`,
  `tests.login('alice')` / `tests.login_anon()`, `reset role`, `tests.group_with(...)`,
  `tests.remember('g', id)` / `tests.id('g')`, `tests.people('alice', 'bob')`.
- `select plan(N)` is a hand count; `finish()` fails when it is off.
- Test both sides of every policy and every error code an RPC raises (`throws_ok(sql, '<state>', '<code>', ...)`).
- The seed writes 60 days of EUR and GBP rates: a test that depends on rates starts with
  `delete from public.fx_rates;`.
