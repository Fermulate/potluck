-- Structure: tables, RLS everywhere, RPC signatures and privileges, indexes,
-- seeds, buckets, realtime, cron.
--
-- This file pins the shape of the schema, so most schema changes have to update it:
--   new table in public       -> tables_are list (and RLS, and an index for every foreign key)
--   new public RPC            -> a has_function line
--   RPC anon may call         -> the anon allowlist (also ADR 4 and docs/security.md)
--   new realtime table        -> the publication set_eq
--   new app_config key        -> the app_config seed rows
--   new cron job              -> a cron.job check
-- Count the assertions and update plan(N); finish() fails when it is off.
begin;
select plan(126);
select plan(98);

select tables_are('public', array[
  'profiles', 'friendships', 'blocks', 'reports',
  'groups', 'group_members', 'group_invites',
  'expenses', 'expense_splits', 'expense_payers', 'expense_items', 'expense_attachments', 'recurring_expenses', 'settlements', 'fx_rates',
  'payment_methods', 'debt_reminders',
  'events', 'availability', 'availability_requests', 'event_rsvps', 'busy_blocks',
  'calendar_connections',
  'activity', 'comments', 'notifications', 'push_tokens', 'app_config',
  'calendar_feed_tokens', 'notification_prefs',
  'event_guest_links', 'event_guests', 'event_guest_availability',
  'placeholders', 'friend_invites', 'group_whiteboards'
], 'public has exactly the documented tables');

select views_are('public', array['group_balances', 'expense_ledger'], 'public has the balances and ledger views');

select is(
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity),
  0,
  'RLS is enabled on every public table'
);

select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c where c.oid = 'public.group_balances'::regclass),
  'group_balances is security_invoker'
);

select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c where c.oid = 'public.expense_ledger'::regclass),
  'expense_ledger is security_invoker'
);

select enum_has_labels('public', 'group_role', array['owner', 'admin', 'member'], 'group_role labels');
select enum_has_labels('public', 'split_type', array['equal', 'exact', 'percent', 'shares', 'adjustment', 'itemized'], 'split_type labels');
select enum_has_labels('public', 'event_status', array['polling', 'scheduled', 'cancelled', 'done'], 'event_status labels');
select enum_has_labels('public', 'availability_level', array['yes', 'maybe'], 'availability_level labels');
select enum_has_labels('public', 'rsvp_status', array['going', 'maybe', 'declined'], 'rsvp_status labels');
select enum_has_labels('public', 'push_platform', array['web', 'ios', 'android'], 'push_platform labels');
select enum_has_labels('public', 'recurrence', array['weekly', 'biweekly', 'monthly', 'yearly'], 'recurrence labels');
select enum_has_labels('public', 'group_type', array['home', 'trip', 'couple', 'other'], 'group_type labels');

-- RPC signatures
select has_function('public', 'create_group', array['text', 'text', 'text', 'text'], 'create_group(name, emoji, color, currency)');
select has_function('public', 'create_invite', array['uuid', 'group_role', 'integer', 'timestamp with time zone', 'text'], 'create_invite');
select has_function('public', 'invite_preview', array['text'], 'invite_preview(code)');
select has_function('public', 'accept_invite', array['text'], 'accept_invite(code)');
select has_function('public', 'set_member_role', array['uuid', 'uuid', 'group_role'], 'set_member_role');
select has_function('public', 'remove_member', array['uuid', 'uuid'], 'remove_member');
select has_function('public', 'leave_group', array['uuid'], 'leave_group');
select has_function('public', 'transfer_ownership', array['uuid', 'uuid'], 'transfer_ownership');
select has_function('public', 'get_or_create_direct_group', array['uuid'], 'get_or_create_direct_group');
select has_function('public', 'create_expense', array['jsonb'], 'create_expense');
select has_function('public', 'update_expense', array['uuid', 'jsonb'], 'update_expense');
select has_function('public', 'delete_expense', array['uuid'], 'delete_expense');
select has_function('public', 'restore_expense', array['uuid'], 'restore_expense');
select has_function('public', 'create_expense_v2', array['jsonb'], 'create_expense_v2');
select has_function('public', 'update_expense_v2', array['uuid', 'jsonb'], 'update_expense_v2');
select has_function('public', 'set_default_split', array['uuid', 'jsonb'], 'set_default_split');
select has_function('public', 'update_recurring_expense', array['uuid', 'jsonb'], 'update_recurring_expense(id, payload)');
select has_function('public', 'skip_recurring_expense', array['uuid'], 'skip_recurring_expense(id)');
select has_function('public', 'make_expense_recurring', array['uuid', 'recurrence'], 'make_expense_recurring(expense_id, recurrence)');
select has_function('public', 'import_expenses', array['uuid', 'jsonb', 'text', 'uuid', 'text'], 'import_expenses(group_id, rows, source, batch_id, fingerprint)');
select has_function('public', 'import_stage', array['uuid', 'uuid', 'jsonb'], 'import_stage(batch_id, group_id, rows)');
select has_function('public', 'export_my_data', array[]::text[], 'export_my_data');
select has_function('public', 'set_expense_attachments', array['uuid', 'jsonb'], 'set_expense_attachments');
select has_function('public', 'settle_up', array['uuid', 'uuid', 'bigint', 'text', 'text'], 'settle_up');
select has_function('public', 'delete_settlement', array['uuid'], 'delete_settlement');
select has_function('public', 'simplified_debts', array['uuid'], 'simplified_debts');
select has_function('public', 'settle_up_v2', array['uuid', 'uuid', 'uuid', 'bigint', 'text', 'text', 'date'], 'settle_up_v2');
select has_function('public', 'update_settlement', array['uuid', 'jsonb'], 'update_settlement');
select has_function('public', 'restore_settlement', array['uuid'], 'restore_settlement');
select has_function('public', 'settle_all', array['uuid', 'date', 'text'], 'settle_all');
select has_function('public', 'settle_with_friend', array['uuid', 'date', 'text', 'jsonb'], 'settle_with_friend');
select has_function('public', 'friend_balances', array[]::text[], 'friend_balances');
select has_function('public', 'remind_debt', array['uuid', 'uuid', 'text'], 'remind_debt');
select has_function('public', 'set_availability', array['uuid', 'jsonb'], 'set_availability');
select has_function('public', 'request_availability', array['uuid', 'uuid[]'], 'request_availability');
select has_function('public', 'best_slots', array['uuid', 'integer'], 'best_slots');
select has_function('public', 'schedule_event', array['uuid', 'timestamp with time zone'], 'schedule_event');
select has_function('public', 'cancel_event', array['uuid'], 'cancel_event');
select has_function('public', 'my_timeline', array['timestamp with time zone', 'timestamp with time zone'], 'my_timeline');
select has_function('public', 'delete_my_account', array[]::text[], 'delete_my_account');
select has_function('public', 'delete_group', array['uuid'], 'delete_group');
select has_function('public', 'spending_summary', array['uuid', 'date', 'date', 'text'], 'spending_summary(in_group, from_day, to_day, in_currency)');
select has_function('public', 'deleted_items', array['uuid', 'timestamp with time zone', 'uuid', 'integer'], 'deleted_items(in_group, cursor, max_rows)');
select has_function('public', 'friend_activity', array['uuid', 'timestamp with time zone', 'uuid', 'integer'], 'friend_activity(friend, cursor, max_rows)');
select has_function('public', 'search_money',
  array['text', 'uuid', 'uuid', 'date', 'date', 'text[]', 'text[]', 'date', 'timestamp with time zone', 'uuid', 'integer'],
  'search_money(query, filters, cursor, max_rows)');
select has_function('public', 'create_group_v2', array['text', 'text', 'text', 'text', 'group_type', 'date', 'date'], 'create_group_v2(name, emoji, color, currency, type, starts_on, ends_on)');
select has_function('public', 'restore_group', array['uuid'], 'restore_group');
select has_function('public', 'my_deleted_groups', array[]::text[], 'my_deleted_groups');
select has_function('public', 'save_group_whiteboard', array['uuid', 'text', 'integer'], 'save_group_whiteboard(group_id, body, base_version)');
select has_function('public', 'my_notification_prefs', array[]::text[], 'my_notification_prefs');
select has_function('public', 'set_notification_pref', array['text', 'boolean', 'boolean'], 'set_notification_pref(category, push, email)');
select has_function('public', 'email_unsubscribe', array['text', 'text'], 'email_unsubscribe(token, action)');
select has_function('public', 'email_outbox_report', array['uuid', 'boolean', 'text', 'uuid[]'], 'email_outbox_report(batch, delivered, error, rejected)');
select has_function('public', 'add_placeholder_member', array['uuid', 'text', 'text'], 'add_placeholder_member(group_id, display_name, email)');
select has_function('public', 'update_placeholder', array['uuid', 'text', 'text'], 'update_placeholder(user_id, display_name, email)');
select has_function('public', 'remind_placeholder', array['uuid'], 'remind_placeholder(user_id)');
select has_function('public', 'remove_placeholder', array['uuid'], 'remove_placeholder(user_id)');
select has_function('public', 'invite_preview_v2', array['text'], 'invite_preview_v2(code)');
select has_function('public', 'my_friend_link', array['boolean'], 'my_friend_link(rotate)');
select has_function('public', 'create_friend_invite', array['text'], 'create_friend_invite(email)');
select has_function('public', 'friend_invite_preview', array['text'], 'friend_invite_preview(code)');
select has_function('public', 'accept_friend_invite', array['text'], 'accept_friend_invite(code)');
select has_function('public', 'add_friend', array['uuid'], 'add_friend(user_id)');
select has_function('public', 'remove_friend', array['uuid'], 'remove_friend(friend_id)');
select has_function('public', 'block_user', array['uuid'], 'block_user(user_id)');
select has_function('public', 'my_blocks', array[]::text[], 'my_blocks()');
select ok(
  not has_function_privilege('authenticated', 'public.email_outbox_report(uuid, boolean, text, uuid[])', 'execute'),
  'only the service role reports email deliveries'
);
select has_function('public', 'create_mfa_recovery_codes', array[]::text[], 'create_mfa_recovery_codes');
select has_function('public', 'mfa_recovery_codes_left', array[]::text[], 'mfa_recovery_codes_left');
select has_function('public', 'mfa_recovery_code_matches', array['uuid', 'text'], 'mfa_recovery_code_matches');
select has_function('public', 'forget_mfa_recovery_codes', array['uuid'], 'forget_mfa_recovery_codes');
select has_function('public', 'record_mfa_recover_attempt', array['uuid'], 'record_mfa_recover_attempt');
select has_function('public', 'clear_mfa_recovery_codes', array[]::text[], 'clear_mfa_recovery_codes');
select has_function('public', 'notify_mfa_recovered', array['uuid'], 'notify_mfa_recovered');
select has_function('public', 'create_guest_link', array['uuid', 'text', 'integer'], 'create_guest_link(event_id, ttl, max_guests)');
select has_function('public', 'revoke_guest_link', array['uuid'], 'revoke_guest_link(link_id)');
select has_function('public', 'remove_guest_answer', array['uuid'], 'remove_guest_answer(guest_id)');
select has_function('public', 'guest_link_preview', array['text', 'text'], 'guest_link_preview(code, token)');
select has_function('public', 'set_guest_availability', array['text', 'text', 'text', 'jsonb'], 'set_guest_availability(code, name, token, slots)');

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and (not p.prosecdef or not ('search_path=""' = any (coalesce(p.proconfig, '{}'))))),
  0,
  'every public function is security definer with an empty search_path'
);

select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and has_function_privilege('anon', p.oid, 'execute')),
  array['email_unsubscribe', 'friend_invite_preview', 'guest_link_preview', 'invite_preview', 'invite_preview_v2', 'set_guest_availability'],
  'anon can only execute the invite previews, email_unsubscribe and the guest link RPCs'
);

-- Not found is PT404 (HTTP 404). P0002 reaches clients as HTTP 500; old migration files still
-- show it, but 20261105200000_not_found_as_404 rewrote every body.
select is(
  (select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}') from pg_proc p
   where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
     and p.prosrc ~ 'errcode\s*=\s*''P0002'''),
  '{}'::text[],
  'no function raises P0002 (use PT404 for not found)'
);

select is(
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'private'::regnamespace
     and p.prosecdef
     and not ('search_path=""' = any (coalesce(p.proconfig, '{}')))),
  0,
  'private security definer helpers pin search_path'
);

select ok(
  not has_function_privilege('authenticated', 'private.save_expense(uuid, jsonb)', 'execute'),
  'internal write helpers are not callable by clients'
);

-- Every foreign key has an index whose leading columns match it.
select is(
  (select coalesce(array_agg(c.conrelid::regclass::text || '.' || c.conname), '{}')
   from pg_constraint c
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and not exists (
       select 1 from pg_index i
       where i.indrelid = c.conrelid
         and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] @> c.conkey
         and (string_to_array(i.indkey::text, ' ')::int2[])[1:cardinality(c.conkey)] <@ c.conkey
     )),
  '{}'::text[],
  'every foreign key is indexed'
);

select is(
  (select count(*)::int from pg_index i where i.indexrelid = 'public.group_members_one_owner_idx'::regclass and i.indisunique),
  1,
  'one-owner partial unique index exists'
);

-- app_config seeds
select results_eq(
  $$ select key, value from public.app_config order by key $$,
  $$ values
    ('apple_auth', 'false'::jsonb),
    ('calendar_import', 'false'::jsonb),
    ('email_notifications', 'false'::jsonb),
    ('google_auth', 'false'::jsonb),
    ('min_client_version', '{"web": "0.0.0", "ios": "0.0.0", "android": "0.0.0"}'::jsonb),
    ('multi_currency', 'true'::jsonb),
    ('recurring', 'true'::jsonb),
    ('web_push', 'true'::jsonb)
  $$,
  'app_config seed rows'
);

-- Storage
select results_eq(
  $$ select id, public from storage.buckets where id in ('avatars', 'group-covers', 'receipts') order by id $$,
  $$ values ('avatars', true), ('group-covers', true), ('receipts', false) $$,
  'storage buckets and visibility'
);

-- Realtime
select set_eq(
  $$ select tablename::text from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' $$,
  array['availability', 'expenses', 'expense_splits', 'settlements', 'activity',
        'notifications', 'event_rsvps', 'events', 'group_members', 'event_guest_availability',
        'group_whiteboards'],
  'realtime publication covers the live tables'
);

-- Cron
select has_extension('pg_cron', 'pg_cron is installed');
select ok(
  exists (select 1 from cron.job where jobname = 'materialize-recurring-expenses' and schedule = '10 0 * * *'),
  'daily recurring job is scheduled'
);
select ok(
  exists (select 1 from cron.job where jobname = 'event-reminders' and schedule = '5 * * * *'),
  'hourly reminder job is scheduled'
);
select ok(
  exists (select 1 from cron.job where jobname = 'email-notifications' and schedule = '* * * * *'),
  'email job runs every minute'
);
select ok(
  exists (select 1 from cron.job where jobname = 'purge-deleted-groups' and schedule = '20 3 * * *'),
  'deleted groups are purged nightly'
);
select ok(
  exists (select 1 from cron.job where jobname = 'monthly-summary' and schedule = '0 15 1 * *'),
  'monthly summary runs on the first of the month'
);
select ok(
  exists (select 1 from cron.job where jobname = 'recurring-heads-up' and schedule = '5,35 * * * *'),
  'heads-ups for repeating expenses run at :05 and :35'
);
select ok(
  exists (select 1 from cron.job where jobname = 'purge-invite-sends' and schedule = '20 3 * * *'),
  'the invite log is trimmed daily'
);
select ok(
  exists (select 1 from cron.job where jobname = 'purge-import-batches' and schedule = '*/15 * * * *'),
  'unfinished imports are cleared every quarter hour'
);

-- Grants: clients never write money tables directly.
select ok(not has_table_privilege('authenticated', 'public.expenses', 'insert'), 'no direct expense inserts');
select ok(not has_table_privilege('authenticated', 'public.expense_splits', 'insert'), 'no direct split inserts');
select ok(not has_table_privilege('authenticated', 'public.settlements', 'insert'), 'no direct settlement inserts');
select ok(not has_table_privilege('authenticated', 'public.group_members', 'insert'), 'no direct membership inserts');
select ok(not has_table_privilege('authenticated', 'public.activity', 'insert'), 'no direct activity inserts');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'insert'), 'no direct notification inserts');
select ok(not has_column_privilege('authenticated', 'public.profiles', 'deleted_at', 'update'), 'profiles.deleted_at is not client writable');
select ok(not has_column_privilege('authenticated', 'public.events', 'status', 'update'), 'events.status changes only via RPC');
select ok(not has_column_privilege('authenticated', 'public.calendar_connections', 'access_token_secret_id', 'select'), 'token secret ids are hidden');
select ok(has_table_privilege('anon', 'public.app_config', 'select'), 'anon can read app_config');
select ok(not has_table_privilege('anon', 'public.profiles', 'select'), 'anon cannot read profiles');
select ok(not has_table_privilege('anon', 'public.groups', 'select'), 'anon cannot read groups');

-- Signup trigger
select has_trigger('auth', 'users', 'on_auth_user_created', 'profile trigger on auth.users');

-- Money guards
select has_trigger('public', 'groups', 'groups_guard_delete', 'groups with open balances cannot be deleted');
select has_trigger('public', 'recurring_expenses', 'recurring_expenses_skip_paused', 'resuming a template skips paused periods');
select has_trigger('public', 'recurring_expenses', 'recurring_expenses_require_members', 'a template naming someone who left cannot resume');

select * from finish();
rollback;
