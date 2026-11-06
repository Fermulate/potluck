---
name: write-pgtap-test
description: Write or extend a Potluck pgTAP test in supabase/tests for RLS policies, RPCs, triggers or cron jobs, using the tests.* helpers. Use whenever database behavior changes.
---

# Write a pgTAP test

## File

- Extend the file that covers the area (map in `docs/testing.md`, "Database tests"), or add the next
  number (`17_<topic>.test.sql`; files run in name order).
- One transaction that rolls back:

```sql
begin;
select plan(4);

select tests.create_user('owner');
select tests.create_user('member');
select tests.create_user('stranger');
select tests.remember('g', tests.group_with('owner', array['member']));

select tests.login('stranger');
select throws_ok(
  format($$ select public.<rpc>(%L) $$, tests.id('g')),
  '42501', 'not_a_member', 'outsiders cannot <do it>'
);

select tests.login('member');
select lives_ok(format($$ select public.<rpc>(%L) $$, tests.id('g')), 'members can <do it>');
select is((select count(*)::int from public.<table> where group_id = tests.id('g')), 1, 'it wrote one row');

select tests.login_anon();
select throws_ok(format($$ select public.<rpc>(%L) $$, tests.id('g')), '42501', null, 'anon cannot call it');

select * from finish();
rollback;
```

## Helpers (`000_setup.test.sql`)

`tests.create_user(handle)`, `tests.uid(handle)`, `tests.login(handle)`, `tests.login_anon()`,
`reset role`, `tests.group_with(owner, members[], admins[], name, currency)`,
`tests.remember(key, id)` / `tests.id(key)`, `tests.people('a', 'b')` (split payload).

## What to cover

- Every policy from both sides: owner, admin, member, outsider, anon; read and write.
- Every error code the RPC raises, with its SQLSTATE: `throws_ok(sql, '<state>', '<code>', desc)`.
- Archived group (`update public.groups set archived_at = now()` as superuser, then expect `group_archived`).
- Departed member: remove someone with a share, then expect `split_member_not_in_group`.
- Money: exact integers. Rates: start with `delete from public.fx_rates;` (the seed writes 60 days of
  rates) and insert the ones you need.
- Same cases as the matching `packages/core` test when the rule exists on both sides.

## Run

```sh
pnpm exec supabase test db supabase/tests/000_setup.test.sql supabase/tests/<file>.test.sql
pnpm db:test   # everything, as CI
```

`plan(N)` is a hand count: `finish()` reports "planned N but ran M" when it is off. If you added a
table, public RPC, anon RPC, realtime table, app_config key or cron job, `01_schema.test.sql` needs an
update too (see its header).
