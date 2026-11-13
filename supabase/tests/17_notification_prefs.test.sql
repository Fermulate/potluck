-- Notification settings, routing to push and email, the email outbox, unsubscribe
-- links, and the expense.deleted / expense.restored / member.added types.
begin;
select plan(76);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.remember('g', tests.group_with('ava', array['ben', 'cleo'], '{}', 'Flat', 'USD'));

-- Who can read and write settings
select tests.login_anon();
select throws_ok($$ select * from my_notification_prefs() $$, '42501', null, 'anon cannot read settings');
select throws_ok($$ select set_notification_pref('payments', false) $$, '42501', null, 'anon cannot change settings');

select tests.login('ava');
select results_eq(
  $$ select category, push, email, push_allowed, email_allowed from my_notification_prefs() $$,
  $$ values
    ('expense_added', true, true, true, true),
    ('expense_changed', true, true, true, true),
    ('payments', true, true, true, true),
    ('comments', true, true, true, true),
    ('groups', true, true, true, true),
    ('plans', true, false, true, true),
    ('reminders', true, true, true, true),
    ('monthly_summary', false, true, false, true),
    ('security', true, true, true, true)
  $$,
  'everyone starts on the defaults, in display order'
);
select is((select count(*)::int from public.notification_prefs), 0, 'defaults are not stored');

select lives_ok($$ select set_notification_pref('payments', push => false) $$, 'ava turns off payment pushes');
select results_eq(
  $$ select push, email from my_notification_prefs() where category = 'payments' $$,
  $$ values (false, true) $$,
  'only the channel that was sent changes'
);
select lives_ok($$ select set_notification_pref('payments', email => false) $$, 'then payment emails');
select results_eq(
  $$ select push, email from public.notification_prefs where category = 'payments' $$,
  $$ values (false, false) $$,
  'push stays off when only email is sent'
);
select lives_ok($$ select set_notification_pref('payments', email => true) $$, 'payment emails back on');
select throws_ok(
  $$ select set_notification_pref('fax', true) $$,
  '22023', 'invalid_notification_category', 'unknown settings are refused'
);
select throws_ok(
  $$ insert into public.notification_prefs (user_id, category, push) values (auth.uid(), 'plans', false) $$,
  '42501', null, 'settings are not written directly'
);
select results_eq(
  $$ select push from my_notification_prefs() where category = 'monthly_summary' $$,
  $$ values (false) $$,
  'the summary never pushes'
);

select tests.login('ben');
select is((select count(*)::int from public.notification_prefs), 0, 'nobody reads someone else''s settings');
select results_eq(
  $$ select push from my_notification_prefs() where category = 'payments' $$,
  $$ values (true) $$,
  'one person''s settings do not touch another''s'
);

-- Routing: the inbox always gets it, push follows the setting.
select tests.remember('s1', (select id from settle_up(tests.id('g'), tests.uid('ava'), 500)));
select tests.remember('e1', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Groceries', 'amount_cents', 3000,
  'splits', tests.people('ava', 'ben', 'cleo')))));
-- expenses_notify is deferred to commit; fire it now.
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq(
  $$ select channels from public.notifications
     where user_id = tests.uid('ava') and type = 'settlement.created' and data ->> 'settlement_id' = tests.id('s1')::text $$,
  $$ values ('{}'::text[]) $$,
  'a payment still reaches the inbox with payment pushes off, and email is off for the whole app'
);
select results_eq(
  $$ select channels from public.notifications
     where user_id = tests.uid('ava') and type = 'expense.created' and data ->> 'expense_id' = tests.id('e1')::text $$,
  $$ values ('{push}'::text[]) $$,
  'other types still push'
);
select is((select count(*)::int from private.email_outbox), 0, 'nothing is queued for email while the flag is off');
select is((select count(*)::int from net.http_request_queue), 0, 'nothing is sent without edge config');

insert into public.notifications (user_id, type) values (tests.uid('ben'), 'mystery.thing');
select results_eq(
  $$ select channels from public.notifications where type = 'mystery.thing' $$,
  $$ values ('{push}'::text[]) $$,
  'a type with no setting pushes and never emails'
);

-- Email on
update public.app_config set value = 'true' where key = 'email_notifications';
delete from public.notifications;

select tests.login('ben');
select tests.remember('e2', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Pizza', 'amount_cents', 3000,
  'splits', tests.people('ava', 'ben', 'cleo')))));
set constraints all immediate;
set constraints all deferred;
reset role;
select results_eq(
  $$ select channels from public.notifications where user_id = tests.uid('ava') and type = 'expense.created' $$,
  $$ values ('{push,email}'::text[]) $$,
  'with email on, a new expense pushes and emails'
);
select is(
  (select subject from private.email_outbox o join public.notifications n on n.id = o.notification_id
   where n.user_id = tests.uid('cleo')),
  'expense:' || tests.id('e2'),
  'expense emails are grouped by expense'
);

-- Held for a minute: nothing goes out while the expense is still being fixed.
select is(private.send_email_notifications(), 0, 'nothing is sent inside the hold');

select tests.login('ben');
select update_expense(tests.id('e2'), jsonb_build_object('description', 'Pizza night'));
set constraints all immediate;
set constraints all deferred;
reset role;
update private.email_outbox set queued_at = now() - interval '2 minutes';
select is(private.send_email_notifications(), 2, 'one email each for ava and cleo once the hold is over');
select results_eq(
  $$ select n.type, o.state from private.email_outbox o join public.notifications n on n.id = o.notification_id
     where n.user_id = tests.uid('ava') order by n.created_at, n.type $$,
  $$ values ('expense.created', 'sending'), ('expense.updated', 'folded') $$,
  'a quick fix folds into the new expense email'
);
select is(
  (select count(distinct batch_id)::int from private.email_outbox where state = 'sending'),
  1,
  'both emails go out in one batch'
);
select is(
  (select count(*)::int from private.email_outbox where state = 'pending'),
  0,
  'nothing due is left behind'
);

-- notify reports each batch; only the service role may.
select set_config('tests.batch', (select batch_id::text from private.email_outbox where state = 'sending' limit 1), true);
select tests.login('ava');
select throws_ok(
  format($$ select email_outbox_report(%L, true) $$, current_setting('tests.batch')),
  '42501', null, 'clients cannot report deliveries'
);
reset role;
set local role service_role;
select is(email_outbox_report(current_setting('tests.batch')::uuid, true), 2, 'a delivered batch is reported');
reset role;
select is(
  (select count(*)::int from private.email_outbox where state = 'sent' and handled_at is not null),
  2,
  'its rows are sent'
);

-- Added and deleted inside the hold: no email at all.
select tests.login('ben');
select tests.remember('e3', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Typo', 'amount_cents', 100,
  'splits', tests.people('ava', 'ben')))));
set constraints all immediate;
set constraints all deferred;
select delete_expense(tests.id('e3'));
reset role;
select results_eq(
  $$ select type from public.notifications where user_id = tests.uid('ava') and data ->> 'expense_id' = tests.id('e3')::text order by created_at, type $$,
  $$ values ('expense.created'), ('expense.deleted') $$,
  'deleting an expense notifies the people in it'
);
update private.email_outbox set queued_at = now() - interval '2 minutes';
select is(private.send_email_notifications(), 0, 'an expense added and deleted inside the hold sends nothing');

-- Deleting an older expense emails the deletion.
select tests.login('ben');
select delete_expense(tests.id('e2'));
reset role;
update private.email_outbox set queued_at = now() - interval '2 minutes';
select is(private.send_email_notifications(batch_size => 1), 2, 'a deletion is emailed');
select results_eq(
  $$ select o.state from private.email_outbox o join public.notifications n on n.id = o.notification_id
     where n.user_id = tests.uid('ava') and n.type = 'expense.deleted' and n.data ->> 'expense_id' = tests.id('e2')::text $$,
  $$ values ('sending') $$,
  'the deletion email is the one sent'
);
select is(
  (select count(distinct batch_id)::int from private.email_outbox where state = 'sending'),
  2,
  'batch_size cuts the emails into separate calls'
);

-- A failed batch waits and retries with a fresh batch; a silent one retries under the same batch.
select set_config('tests.fail', (select o.batch_id::text from private.email_outbox o
  join public.notifications n on n.id = o.notification_id
  where o.state = 'sending' and n.user_id = tests.uid('ava')), true);
select set_config('tests.quiet', (select o.batch_id::text from private.email_outbox o
  join public.notifications n on n.id = o.notification_id
  where o.state = 'sending' and n.user_id = tests.uid('cleo')), true);
select is(email_outbox_report(current_setting('tests.fail')::uuid, false, 'rate limited'), 1, 'a failed batch is reported');
select results_eq(
  $$ select state, attempts, batch_id is null, retry_at > now(), last_error from private.email_outbox
     where state = 'pending' $$,
  $$ values ('pending', 1, true, true, 'rate limited') $$,
  'a failed email waits to retry, without its batch'
);
select is(private.send_email_notifications(), 0, 'nothing is retried before its back off');
update private.email_outbox set retry_at = now() - interval '1 second' where state = 'pending';
update private.email_outbox set claimed_at = now() - interval '11 minutes' where batch_id = current_setting('tests.quiet')::uuid;
select is(private.send_email_notifications(), 2, 'both come back: the failed one and the one never reported');
select results_eq(
  $$ select o.batch_id = current_setting('tests.quiet')::uuid, o.attempts from private.email_outbox o
     join public.notifications n on n.id = o.notification_id
     where o.state = 'sending' order by n.user_id = tests.uid('cleo') $$,
  $$ values (false, 2), (true, 2) $$,
  'the unreported batch keeps its id (so its idempotency key), the failed one gets a new one'
);
update private.email_outbox set attempts = 5 where state = 'sending';
select is(email_outbox_report(current_setting('tests.quiet')::uuid, false), 1, 'a fifth failure is reported');
select is(
  (select state from private.email_outbox where batch_id = current_setting('tests.quiet')::uuid),
  'failed',
  'and then it gives up'
);
update private.email_outbox set state = 'sent' where state = 'sending';

select tests.login('ben');
select restore_expense(tests.id('e2'));
reset role;
select is(
  (select count(*)::int from public.notifications where type = 'expense.restored' and data ->> 'expense_id' = tests.id('e2')::text),
  2,
  'restoring notifies everyone in the expense but the actor'
);

-- Turning email off inside the hold wins.
select tests.login('ava');
select set_notification_pref('expense_changed', email => false);
reset role;
update private.email_outbox set queued_at = now() - interval '2 minutes';
select is(private.send_email_notifications(), 1, 'only cleo gets the restore email once ava turns them off');
select results_eq(
  $$ select o.state from private.email_outbox o join public.notifications n on n.id = o.notification_id
     where n.user_id = tests.uid('ava') and n.type = 'expense.restored' $$,
  $$ values ('dropped') $$,
  'ava''s queued email is dropped'
);

select tests.login('ben');
insert into public.events (group_id, title, window_start, window_end)
values (tests.id('g'), 'Picnic', current_date, current_date + 3);
reset role;
select results_eq(
  $$ select channels from public.notifications where user_id = tests.uid('ava') and type = 'event.created' $$,
  $$ values ('{push}'::text[]) $$,
  'plans push but do not email by default'
);

-- An unreported batch keeps its id only if every one of its emails goes out again.
reset role;
insert into public.notifications (user_id, type, data) values
  (tests.uid('ava'), 'comment.created', '{"excerpt": "one"}'),
  (tests.uid('cleo'), 'comment.created', '{"excerpt": "two"}');
update private.email_outbox set queued_at = now() - interval '2 minutes' where state = 'pending';
select is(private.send_email_notifications(), 2, 'two comment emails go out together');
select set_config('tests.pair', (select o.batch_id::text from private.email_outbox o
  join public.notifications n on n.id = o.notification_id
  where n.type = 'comment.created' and n.user_id = tests.uid('cleo')), true);
update private.email_outbox set claimed_at = now() - interval '11 minutes'
where batch_id = current_setting('tests.pair')::uuid;
select tests.login('ava');
select set_notification_pref('comments', email => false);
reset role;
select is(private.send_email_notifications(), 1, 'ava turned comment emails off before the retry');
select results_eq(
  $$ select o.state, o.batch_id = current_setting('tests.pair')::uuid from private.email_outbox o
     join public.notifications n on n.id = o.notification_id
     where n.type = 'comment.created' order by n.user_id = tests.uid('cleo') $$,
  $$ values ('dropped', true), ('sending', false) $$,
  'a batch with a different set of emails gets a new id, so a new idempotency key'
);

-- Stale rows are dropped, not sent late.
update private.email_outbox set state = 'pending', handled_at = null, queued_at = now() - interval '2 days'
where state in ('sent', 'sending');
select is(private.send_email_notifications(), 0, 'rows older than a day are not sent');

-- The email shows each person's share as it is now: taken out of the split, none.
select vault.create_secret('http://edge.test', 'project_url');
select vault.create_secret('test-secret', 'edge_secret');
select tests.login('ben');
select tests.remember('e4', (select id from create_expense(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Dinner', 'amount_cents', 3000,
  'splits', tests.people('ava', 'ben', 'cleo')))));
set constraints all immediate;
set constraints all deferred;
select update_expense(tests.id('e4'), jsonb_build_object('splits', tests.people('ava', 'ben')));
set constraints all immediate;
set constraints all deferred;
reset role;
update private.email_outbox set queued_at = now() - interval '2 minutes' where state = 'pending';
select private.send_email_notifications();
select results_eq(
  $$ select n.user_id, (e -> 'data' ->> 'share_cents')::bigint
     from net.http_request_queue q
     cross join lateral jsonb_array_elements(convert_from(q.body, 'UTF8')::jsonb -> 'emails') e
     join public.notifications n on n.id = (e ->> 'id')::uuid
     where n.data ->> 'expense_id' = tests.id('e4')::text
     order by n.user_id = tests.uid('cleo') $$,
  $$ values (tests.uid('ava'), 1500::bigint), (tests.uid('cleo'), 0::bigint) $$,
  'the new expense email carries the current share, none for someone edited out'
);

update public.app_config set value = 'false' where key = 'email_notifications';
update private.email_outbox set state = 'pending', handled_at = null, queued_at = now() - interval '2 minutes';
select is(private.send_email_notifications(), 0, 'turning the flag off stops sending');

-- Unsubscribe links
select set_config('tests.tok_pay', private.unsubscribe_token(tests.uid('ava'), 'payments'), true);
select set_config('tests.tok_all', private.unsubscribe_token(tests.uid('ava'), 'all'), true);
select set_config('tests.cleo_all', private.unsubscribe_token(tests.uid('cleo'), 'all'), true);

select tests.login_anon();
select is(
  email_unsubscribe(current_setting('tests.tok_pay'), 'preview'),
  '{"category": "payments", "email": "a***@test.local", "subscribed": true, "restored": false}'::jsonb,
  'a preview names the setting and a masked address, signed out'
);
select tests.login('ava');
select results_eq(
  $$ select email from my_notification_prefs() where category = 'payments' $$,
  $$ values (true) $$,
  'a preview changes nothing'
);
select tests.login_anon();
select is(
  email_unsubscribe(current_setting('tests.tok_pay')) ->> 'subscribed',
  'false',
  'a payments link unsubscribes from payment emails'
);
select throws_ok(
  format($$ select email_unsubscribe(%L) $$, replace(current_setting('tests.tok_pay'), 'payments', 'comments')),
  '22023', 'invalid_unsubscribe_link', 'the signature covers the category'
);
select throws_ok(
  format($$ select email_unsubscribe(%L) $$,
    tests.uid('ben')::text || substr(current_setting('tests.tok_pay'), 37)),
  '22023', 'invalid_unsubscribe_link', 'the signature covers the person'
);
select throws_ok($$ select email_unsubscribe('nope') $$, '22023', 'invalid_unsubscribe_link', 'garbage is refused');
select throws_ok(
  format($$ select email_unsubscribe(%L) $$, tests.uid('ava')::text || '.monthly_summary.' || repeat('A', 32)),
  '22023', 'invalid_unsubscribe_link', 'a made up signature is refused'
);
select throws_ok(
  format($$ select email_unsubscribe(%L, 'explode') $$, current_setting('tests.tok_pay')),
  '22023', 'invalid_payload', 'unknown actions are refused'
);

select tests.login('ava');
select results_eq(
  $$ select push, email from my_notification_prefs() where category = 'payments' $$,
  $$ values (false, false) $$,
  'the link turned off payment emails and left push alone'
);

select tests.login_anon();
select is(
  email_unsubscribe(current_setting('tests.tok_pay'), 'undo') ->> 'subscribed',
  'true',
  'the same link can undo it'
);
select is(email_unsubscribe(current_setting('tests.tok_all')) ->> 'category', 'all', 'an all link turns off every email');
select tests.login('ava');
select is(
  (select count(*)::int from my_notification_prefs() where email),
  0,
  'no email settings stay on after unsubscribing from everything'
);
select tests.login('ben');
select is(
  (select count(*)::int from my_notification_prefs() where email),
  8,
  'someone else''s link touches nobody else'
);

-- Changing a push setting leaves the email undo in place.
select tests.login('ava');
select set_notification_pref('plans', push => false);
select tests.login_anon();
select is(
  email_unsubscribe(current_setting('tests.tok_all'), 'undo') ->> 'restored',
  'true',
  'an all link can still be undone after a push change'
);
select tests.login('ava');
select is(
  (select count(*)::int from my_notification_prefs() where email),
  6,
  'every email ava had on is back'
);

-- A link for an email that was already off saves nothing, so undo turns it on.
select tests.login('ben');
select set_notification_pref('payments', email => false);
reset role;
select set_config('tests.ben_pay', private.unsubscribe_token(tests.uid('ben'), 'payments'), true);
select tests.login_anon();
select email_unsubscribe(current_setting('tests.ben_pay'));
select is(
  email_unsubscribe(current_setting('tests.ben_pay'), 'undo') ->> 'subscribed',
  'true',
  '"send them again" on an email that was already off turns it on'
);

-- Undo puts back exactly what the link changed, not the defaults.
select tests.login('cleo');
select set_notification_pref('expense_added', email => false);
select set_notification_pref('plans', email => true);
select tests.login_anon();
select email_unsubscribe(current_setting('tests.cleo_all'));
select email_unsubscribe(current_setting('tests.cleo_all'));
select is(
  email_unsubscribe(current_setting('tests.cleo_all'), 'undo') ->> 'subscribed',
  'true',
  'cleo undoes unsubscribing from everything (after clicking twice)'
);
select tests.login('cleo');
select results_eq(
  $$ select category, email from my_notification_prefs()
     where category in ('expense_added', 'payments', 'plans') order by category $$,
  $$ values ('expense_added', false), ('payments', true), ('plans', true) $$,
  'new expenses stay off, plans stay on, the rest are back'
);
select is(
  (select count(*)::int from public.notification_prefs where user_id = tests.uid('cleo') and category = 'payments' and email is null),
  1,
  'a setting that was on its default goes back to the default'
);
select tests.login('cleo');
select set_notification_pref('payments', email => false);
select tests.login_anon();
select is(
  email_unsubscribe(current_setting('tests.cleo_all'), 'undo') ->> 'restored',
  'false',
  'undoing an all link with nothing saved changes nothing'
);
select tests.login('cleo');
select results_eq(
  $$ select category, email from my_notification_prefs()
     where category in ('expense_added', 'payments', 'plans') order by category $$,
  $$ values ('expense_added', false), ('payments', false), ('plans', true) $$,
  'and does not reset anything to the defaults'
);

-- member.added
reset role;
select set_config('request.jwt.claims', json_build_object('sub', tests.uid('ava'), 'role', 'authenticated')::text, true);
select tests.create_user('dev');
insert into public.group_members (group_id, user_id, role) values (tests.id('g'), tests.uid('dev'), 'member');
select results_eq(
  $$ select type, data ->> 'actor_id' from public.notifications where user_id = tests.uid('dev') $$,
  $$ values ('member.added', tests.uid('ava')::text) $$,
  'someone added to a group by someone else hears about it'
);

select tests.create_user('eli');
select tests.login('ava');
select set_config('tests.code', (select code from create_invite(tests.id('g'))), true);
select tests.login('eli');
select accept_invite(current_setting('tests.code'));
reset role;
select is(
  (select count(*)::int from public.notifications where user_id = tests.uid('eli') and type = 'member.added'),
  0,
  'joining through an invite yourself is not "added"'
);

-- Closing an account drops its settings.
select is((select count(*)::int from public.notification_prefs where user_id = tests.uid('ava')) > 0, true, 'ava has stored settings');
update public.profiles set deleted_at = now() where id = tests.uid('ava');
select is((select count(*)::int from public.notification_prefs where user_id = tests.uid('ava')), 0, 'closing the account removes them');

select * from finish();
rollback;
