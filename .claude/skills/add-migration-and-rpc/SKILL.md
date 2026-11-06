---
name: add-migration-and-rpc
description: Add or change Potluck database schema (table, column, policy, trigger, RPC) with a migration, pgTAP tests, regenerated types and snapshot. Use for any change under supabase/migrations.
---

# Add a migration (and an RPC)

Read `supabase/AGENTS.md` first. Check who else uses the local stack before `db:reset`.

## 1. Find the live definitions

- The schema as it runs now: `supabase/schema/current.sql`. A function's live body:
  `grep -n 'FUNCTION "public"."<name>"' supabase/schema/current.sql`.
- `docs/agent-map.json`: each RPC's `args`, `execute` grants, `raises` and `definedIn` (the newest
  migration that defines it). Copy from there, never from the first file you find.

## 2. Create the file

```sh
pnpm exec supabase migration new <short_name>
```

The timestamp must sort after the newest migration on `main`. Header comment: what and why; when
redefining a function, "Body as in <file> plus <change>".

## 3. Write it

- Additive only: new tables, nullable or defaulted columns, new functions, new policies. A breaking RPC
  change is `<name>_v2`, keeping v1 ([ADR 8](../../../docs/adr/0008-additive-migrations-and-versioned-rpcs.md)).
- New table in `public`:
  - `revoke all on public.<t> from anon, authenticated;` then grant the exact columns clients need;
  - `alter table public.<t> enable row level security;` plus policies using `(select auth.uid())`
    and `group_id = any (array(select private.my_group_ids()))`;
  - an index whose leading columns match every foreign key.
- New RPC: use the skeleton in `supabase/AGENTS.md`. Checklist:
  - `security definer`, `set search_path = ''`, every name schema-qualified;
  - `private.require_user()`; `private.require_member(gid)` for group data;
  - moves a balance? share lock the group row first, before any expense or payment row;
  - archived guard (`require_unarchived` for money, `require_group_open` otherwise);
  - departed members: never move the balance of someone who left (`split_member_not_in_group`,
    `member_not_in_group`);
  - errors: `message = '<code>'`, `detail = '<English>'`, errcode `42501` / `PT404` / `22023` / `23514`.
    Never `P0002`;
  - `revoke execute ... from public, anon;` then `grant execute ... to authenticated, service_role;`.
    Anon-callable only by design (also update ADR 4 and `docs/security.md`).
- Money or scheduling rule? Change `packages/core` too (load `money-change-checklist`).
- New error code? Load `add-i18n-strings-and-error-code`.
- Live table? Add it to the `supabase_realtime` publication, give members a `select` policy, and
  subscribe in the screen with `useRealtime`.

## 4. Apply, test, regenerate

```sh
pnpm db:reset          # applies every migration and the seed
pnpm db:test           # or one file: pnpm exec supabase test db supabase/tests/000_setup.test.sql supabase/tests/<file>
pnpm gen:db            # database.types.ts, schema/current.sql, docs/agent-map.json
pnpm verify:db
```

- Tests: load `write-pgtap-test`. Update `supabase/tests/01_schema.test.sql` (tables list,
  `has_function`, anon allowlist, realtime set, app_config rows, cron) and bump `plan(N)`.
- New RPC in the client: add a function to `packages/api/src/<domain>.ts` with a test against
  `fakeSupabase`. It typechecks only after `pnpm db:types`.

## 5. Docs and finish

- `docs/architecture.md`: tables, RPC table, "RPC details", error list, realtime table.
- `docs/sequences.md` if a flow spans client, database and a function.
- `pnpm verify`, then report the commands and results.
