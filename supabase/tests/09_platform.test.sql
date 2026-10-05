-- Activity, comments, notifications, push tokens, app_config, calendar
-- connections, busy blocks, recurring templates.
begin;
select plan(45);

select tests.create_user('owner');
select tests.create_user('admin');
select tests.create_user('m1');
select tests.create_user('m2');
select tests.create_user('outsider');

select tests.login('owner');
select tests.remember('g', (select id from create_group('Roommates')));
reset role;
insert into public.group_members (group_id, user_id, role) values
  (tests.id('g'), tests.uid('admin'), 'admin'),
  (tests.id('g'), tests.uid('m1'), 'member'),
  (tests.id('g'), tests.uid('m2'), 'member');

select tests.login('m1');
select tests.remember('e', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Paper towels', 'amount_cents', 900,
  'splits', tests.people('m1', 'm2', 'admin')))));
reset role;
set constraints all immediate;

-- Activity
select tests.login('m2');
select set_eq(
  $$ select verb from public.activity where group_id = tests.id('g') $$,
  array['group.created', 'member.joined', 'expense.created'],
  'creating a group, joining and adding an expense are logged'
);
select is(
  (select count(*)::int from public.activity where group_id = tests.id('g') and verb = 'member.joined'),
  4,
  'one member.joined per member'
);
select is(
  (select (actor_id, data ->> 'description', data ->> 'amount_cents')::text from public.activity where verb = 'expense.created' and subject_id = tests.id('e')),
  (tests.uid('m1'), 'Paper towels', '900')::text,
  'expense activity carries actor and summary'
);
select throws_ok(
  $$ insert into public.activity (group_id, verb) values (tests.id('g'), 'fake') $$,
  '42501', null, 'activity is written by triggers only'
);
select tests.login('outsider');
select is((select count(*)::int from public.activity where group_id = tests.id('g')), 0, 'outsiders see no activity');

select tests.login('m1');
select update_expense(tests.id('e'), '{"description": "Kitchen roll"}');
select delete_expense(tests.id('e'));
select restore_expense(tests.id('e'));
select settle_up(tests.id('g'), tests.uid('owner'), 100);
select is(
  (select array_agg(verb order by created_at, verb) from public.activity
   where group_id = tests.id('g') and (verb like 'expense.%' or verb like 'settlement.%')),
  array['expense.created', 'expense.deleted', 'expense.restored', 'expense.updated', 'settlement.created'],
  'edits, deletes, restores and settlements are logged'
);

-- Notifications from expenses (deferred until commit, forced here)
reset role;
set constraints all immediate;
select set_eq(
  $$ select user_id, (data ->> 'share_cents')::bigint from public.notifications where type = 'expense.created' and data ->> 'expense_id' = tests.id('e')::text $$,
  $$ values (tests.uid('m2'), 300::bigint), (tests.uid('admin'), 300::bigint) $$,
  'split members except the actor are notified with their share'
);
select is(
  (select count(*)::int from public.notifications where type = 'member.joined' and user_id = tests.uid('owner')),
  3,
  'the owner hears about new members'
);
select is(
  (select count(*)::int from public.notifications where type = 'settlement.created' and user_id = tests.uid('owner')),
  1,
  'the recipient hears about a payment'
);

select tests.login('m2');
select ok((select count(*) from public.notifications) >= 1, 'users see their notifications');
select is(
  (select count(*)::int from public.notifications where user_id <> tests.uid('m2')),
  0,
  'and only their own'
);
update public.notifications set read_at = now();
select is((select count(*)::int from public.notifications where read_at is null), 0, 'mark all read');
select throws_ok(
  $$ update public.notifications set type = 'x' $$,
  '42501', null, 'only read_at is writable'
);
select tests.login('admin');
select ok((select count(*) from public.notifications where read_at is null) >= 1, 'other users'' notifications are untouched');
delete from public.notifications;
select is((select count(*)::int from public.notifications), 0, 'users can clear their notifications');

-- Comments
select tests.login('m2');
select lives_ok(
  $$ insert into public.comments (expense_id, body) values (tests.id('e'), 'I''ll pay you Friday') $$,
  'members comment on expenses'
);
select tests.remember('c', (select id from public.comments where body like 'I''ll pay%'));
select is((select group_id from public.comments where id = tests.id('c')), tests.id('g'), 'group_id is derived from the expense');
reset role;
select set_eq(
  $$ select user_id from public.notifications where type = 'comment.created' and data ->> 'comment_id' = tests.id('c')::text $$,
  array[tests.uid('m1'), tests.uid('admin')],
  'expense participants (not the author) hear about comments'
);
select ok(exists (select 1 from public.activity where verb = 'comment.created' and subject_id = tests.id('c')), 'comment activity');

select tests.login('outsider');
select throws_ok(
  $$ insert into public.comments (expense_id, body) values (tests.id('e'), 'spam') $$,
  '42501', null, 'outsiders cannot comment'
);
select is((select count(*)::int from public.comments), 0, 'outsiders cannot read comments');
select throws_ok(
  $$ insert into public.comments (expense_id, group_id, body) values (tests.id('e'), tests.id('g'), 'x') $$,
  '42501', null, 'group_id cannot be supplied'
);

select tests.login('m1');
update public.comments set body = 'edited by m1' where id = tests.id('c');
select tests.login('m2');
update public.comments set body = 'Friday for sure' where id = tests.id('c');
reset role;
select is((select body from public.comments where id = tests.id('c')), 'Friday for sure', 'only the author edits');
select tests.login('admin');
update public.comments set deleted_at = now() where id = tests.id('c');
reset role;
select ok((select deleted_at is not null from public.comments where id = tests.id('c')), 'admins can soft delete any comment');
select tests.login('m2');
select throws_ok($$ delete from public.comments where id = tests.id('c') $$, '42501', null, 'comments are never hard deleted by clients');

-- Push tokens
select tests.login('m1');
select lives_ok(
  $$ insert into public.push_tokens (token, platform, subscription) values ('tok-1', 'web', '{"endpoint": "https://push.example"}') $$,
  'register a push token'
);
select throws_ok(
  $$ insert into public.push_tokens (user_id, token, platform) values (tests.uid('m2'), 'tok-2', 'web') $$,
  '42501', null, 'not for someone else'
);
update public.push_tokens set last_seen_at = now() where token = 'tok-1';
select is((select count(*)::int from public.push_tokens), 1, 'own token visible');
select tests.login('m2');
select is((select count(*)::int from public.push_tokens), 0, 'others'' tokens are invisible');
delete from public.push_tokens;
select tests.login('m1');
delete from public.push_tokens where token = 'tok-1';
select is((select count(*)::int from public.push_tokens), 0, 'remove own token');

-- app_config
select tests.login_anon();
select is((select value from public.app_config where key = 'web_push'), 'true'::jsonb, 'anon reads feature flags');
select throws_ok($$ update public.app_config set value = 'false' where key = 'web_push' $$, '42501', null, 'anon cannot change flags');
select tests.login('owner');
select throws_ok($$ insert into public.app_config (key, value) values ('x', '1') $$, '42501', null, 'users cannot change flags');

-- calendar connections and busy blocks
reset role;
insert into public.calendar_connections (user_id, provider, account_email, access_token_secret_id)
values (tests.uid('m1'), 'google', 'm1@gmail.test', gen_random_uuid());
select tests.login('m1');
select is((select provider from public.calendar_connections), 'google', 'users see their calendar link');
select throws_ok($$ select access_token_secret_id from public.calendar_connections $$, '42501', null, 'secret references are hidden');
select throws_ok($$ insert into public.calendar_connections (user_id, provider) values (tests.uid('m1'), 'microsoft') $$, '42501', null, 'links are created server side');
select tests.login('m2');
select is((select count(*)::int from public.calendar_connections), 0, 'others'' links are invisible');
select tests.login('m1');
delete from public.calendar_connections;
select is((select count(*)::int from public.calendar_connections), 0, 'users can disconnect');

select lives_ok(
  $$ insert into public.busy_blocks (starts_at, ends_at, source) values (now(), now() + interval '1 hour', 'manual') $$,
  'add a busy block'
);
select tests.login('m2');
select is((select count(*)::int from public.busy_blocks), 0, 'busy time is private');

-- recurring templates
select tests.login('m1');
select tests.remember('r', (select recurring_id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Internet', 'amount_cents', 5000, 'recurrence', 'monthly',
  'splits', tests.people('m1', 'm2')))));
select tests.login('m2');
update public.recurring_expenses set active = false where id = tests.id('r');
select is((select active from public.recurring_expenses where id = tests.id('r')), true, 'members cannot pause others'' templates');
select throws_ok($$ update public.recurring_expenses set amount_cents = 1 where id = tests.id('r') $$, '42501', null, 'amounts are not editable directly');
select tests.login('m1');
update public.recurring_expenses set active = false where id = tests.id('r');
select is((select active from public.recurring_expenses where id = tests.id('r')), false, 'the creator can pause it');
select tests.login('outsider');
select is((select count(*)::int from public.recurring_expenses), 0, 'outsiders cannot see templates');
select tests.login('admin');
delete from public.recurring_expenses where id = tests.id('r');
select is((select count(*)::int from public.recurring_expenses where id = tests.id('r')), 0, 'admins can delete templates');

select * from finish();
rollback;
