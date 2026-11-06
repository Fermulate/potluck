-- Structure: tables, RLS everywhere, RPC signatures and privileges, indexes,
-- seeds, buckets, realtime, cron.
begin;
select plan(62);

select tables_are('public', array[
  'profiles', 'friendships', 'blocks', 'reports',
  'groups', 'group_members', 'group_invites',
  'expenses', 'expense_splits', 'recurring_expenses', 'settlements', 'fx_rates',
  'events', 'availability', 'availability_requests', 'event_rsvps', 'busy_blocks',
  'calendar_connections',
  'activity', 'comments', 'notifications', 'push_tokens', 'app_config',
  'calendar_feed_tokens'
], 'public has exactly the documented tables');

select views_are('public', array['group_balances'], 'public has the balances view');

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

select enum_has_labels('public', 'group_role', array['owner', 'admin', 'member'], 'group_role labels');
select enum_has_labels('public', 'split_type', array['equal', 'exact', 'percent', 'shares', 'itemized'], 'split_type labels');
select enum_has_labels('public', 'event_status', array['polling', 'scheduled', 'cancelled', 'done'], 'event_status labels');
select enum_has_labels('public', 'availability_level', array['yes', 'maybe'], 'availability_level labels');
select enum_has_labels('public', 'rsvp_status', array['going', 'maybe', 'declined'], 'rsvp_status labels');
select enum_has_labels('public', 'push_platform', array['web', 'ios', 'android'], 'push_platform labels');
select enum_has_labels('public', 'recurrence', array['weekly', 'monthly', 'yearly'], 'recurrence labels');

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
select has_function('public', 'settle_up', array['uuid', 'uuid', 'bigint', 'text', 'text'], 'settle_up');
select has_function('public', 'delete_settlement', array['uuid'], 'delete_settlement');
select has_function('public', 'simplified_debts', array['uuid'], 'simplified_debts');
select has_function('public', 'set_availability', array['uuid', 'jsonb'], 'set_availability');
select has_function('public', 'request_availability', array['uuid', 'uuid[]'], 'request_availability');
select has_function('public', 'best_slots', array['uuid', 'integer'], 'best_slots');
select has_function('public', 'schedule_event', array['uuid', 'timestamp with time zone'], 'schedule_event');
select has_function('public', 'cancel_event', array['uuid'], 'cancel_event');
select has_function('public', 'my_timeline', array['timestamp with time zone', 'timestamp with time zone'], 'my_timeline');
select has_function('public', 'delete_my_account', array[]::text[], 'delete_my_account');
select has_function('public', 'delete_group', array['uuid'], 'delete_group');

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
  array['invite_preview'],
  'anon can only execute invite_preview'
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
        'notifications', 'event_rsvps', 'events', 'group_members'],
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

select * from finish();
rollback;
