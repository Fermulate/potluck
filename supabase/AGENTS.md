# supabase

Postgres is the backend: migrations, RLS, `security definer` RPCs, triggers, cron, storage, edge functions.
Root rules: [../AGENTS.md](../AGENTS.md). Recipes: the `add-migration-and-rpc` and `write-pgtap-test` skills.

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

- Expense payers live in `expense_payers` (deferred sum check). A trigger keeps a lone payer in step with
  `expenses.paid_by`, so an insert that only sets `paid_by` is still right; several payers are written by
  `private.save_expense`. Balances and departed checks read payers, not `paid_by` (ADR 12).
- Repeating expenses ([ADR 14](../docs/adr/0014-editable-recurring-templates.md)): a template keeps the
  `create_expense_v2` payload shape (`splits`, `payers`, `items` with tax, tip, discount) and only shapes
  future copies. Dates step through `private.recurring_step` (core `nextOccurrence`); "who it names and
  whether they all still belong" is `private.recurring_departed` / `recurring_blocked`, shared by the job, the heads-up and
  the resume trigger; who may change one is `private.recurring_involves` (RPCs and policies alike). The
  heads-up job runs at :05 and :35, per person (`profiles.timezone`), deduplicated by `private.recurring_heads_ups`. Edits go through `update_recurring_expense`, never new direct grants.
- Guests ([ADR 16](../docs/adr/0016-guest-availability-links.md)) are rows, not users: availability
  reads (`best_slots`, heat) count `event_guest_availability` too.
- Helpers clients must not call go in `private` (default privileges revoke execute there); grant only
  what a policy needs.
- Two-step sign in ([ADR 13](../docs/adr/0013-two-step-sign-in-enforced-in-the-database.md)):
  `private.check_request()` is PostgREST's pre-request hook and refuses an unfinished two-step
  session. Add any other per-request rule there (PostgREST runs one function). A table added to the
  `supabase_realtime` publication also needs the restrictive "two-step sign in done" `select` policy;
  Storage already has one for every bucket.
- Small immutable SQL helpers used per row (`private.minor_units`, `private.convert_minor`) use a
  SQL-standard body and no `set` clause so they inline; the `function_search_path_mutable` advisor
  warning on them is expected.
- After the migration: `pnpm db:reset`, `pnpm db:test`, `pnpm gen:db`, then update `01_schema.test.sql`
  and `docs/architecture.md`.
- Seats: [notes](../docs/architecture.md#seats).

## Notifications

- A category with `notification_categories.required` (today `security`: `account.mfa_removed`) cannot be
  switched off: `my_notification_prefs` leaves it out, `set_notification_pref` raises
  `notification_setting_required`, unsubscribe links skip it, stored settings are ignored, and its
  emails carry no unsubscribe links (`REQUIRED_CATEGORIES` in `functions/notify/email.ts`).
- Settings are per category ([ADR 11](../docs/adr/0011-notification-prefs-and-email.md)). A new
  notification type is ONE row in your migration:
  `insert into private.notification_types (type, category) values ('<type>', '<category>') on conflict (type) do nothing;`
  Without it the type still reaches the inbox and push, but ignores the person's settings and is
  never emailed. Then add copy: `describe.ts` (inbox), `functions/notify/message.ts` (push), and
  optionally `functions/notify/email.ts` (otherwise a generic email).
- A new category is a row in `private.notification_categories` (defaults, allowed channels), its
  labels under `settings.notificationPrefs.categories` in `packages/i18n/src/en/me.ts`, and an entry
  in `NOTIFICATION_CATEGORIES` (`packages/api/src/notification-prefs.ts`) and `LOOK`
  (`apps/web/src/features/me/notification-prefs.tsx`).
- Routing is a before insert trigger on `public.notifications`, so any insert (through
  `private.notify` or not) gets its `channels`; push and the email outbox follow from them. Email only
  flows while `app_config.email_notifications` is true. A payload with `"quiet": true` gets no
  channels at all (inbox only); the repeating expense heads-up uses it at night (ADR 14). Tests: `17_notification_prefs`,
  `18_monthly_summary`.
- Email delivery is a state machine on `private.email_outbox` (`pending`, `sending`, `sent`, ...):
  `private.send_email_notifications` hands batches to `notify`, which must always answer with
  `public.email_outbox_report` (service role only). Never mark a row sent anywhere else.

## pgTAP

- `tests.create_user('alice')`, `tests.login('alice')` / `tests.login_anon()`, `reset role`,
  `tests.group_with(owner, members[], admins[], name, currency)`, `tests.remember('g', id)` /
  `tests.id('g')`, `tests.people('alice', 'bob')`.
- `select plan(N)` is a hand count; `finish()` fails when it is off.
- Test both sides of every policy and every error code an RPC raises (`throws_ok(sql, '<state>', '<code>', ...)`).
- The seed writes 60 days of EUR and GBP rates: a test that depends on rates starts with
  `delete from public.fx_rates;`.
- Payments beyond v1 (`settle_up_v2`, edit, restore, bulk settle, reminders, payment methods,
  `private.pairwise_debts` with the core cases) are in `23_payments.test.sql`. Debts for bulk
  writes come from `private.group_debts`, never from the client (ADR 15).

## Local stack

Shared by every checkout on the machine (`project_id = "potluck"`). Read the root AGENTS.md
"Shared local stack" section before `db:reset` or `stop`. The Supabase MCP server is for this local
stack only.
