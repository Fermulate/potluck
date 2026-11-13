-- Payments, second version: settle_up_v2, update_settlement, restore_settlement, comments on
-- payments, payment_methods, pairwise and group debts, settle_all, friend_balances,
-- settle_with_friend, remind_debt and the settlement change notifications.
begin;
select plan(106);

delete from public.fx_rates;
insert into public.fx_rates (base, quote, day, rate) values
  ('EUR', 'USD', current_date - 30, 1.1),
  ('EUR', 'USD', current_date, 1.5);

select tests.create_user('o');
select tests.create_user('ad');
select tests.create_user('a');
select tests.create_user('b');
select tests.create_user('c');
select tests.create_user('x');

select tests.remember('g', tests.group_with('o', array['a', 'b', 'c'], array['ad'], 'Flat', 'USD'));

create function pg_temp.net(gid uuid, handle text) returns bigint language sql as $$
  select coalesce((select net_cents from public.group_balances where group_id = gid and user_id = tests.uid(handle)), 0)
$$;

create function pg_temp.notes(handle text, kind text) returns int language sql security definer as $$
  select count(*)::int from public.notifications where user_id = tests.uid(handle) and type = kind
$$;

-- A fresh group, simplify on or off, owned by o with the given members.
create function pg_temp.fresh(members text[], simplify boolean, cur text default 'USD') returns uuid
language plpgsql as $$
declare gid uuid := tests.group_with('o', members, '{}', 'Case', cur);
begin
  update public.groups set simplify_debts = simplify where id = gid;
  return gid;
end $$;

-- settle_up_v2 -------------------------------------------------------------------------------------

select tests.login('a');
select tests.remember('s1', (select id from public.settle_up_v2(tests.id('g'), tests.uid('b'), tests.uid('a'), 2000)));
select is(
  (select (from_user, to_user, amount_cents, currency, fx_rate, created_by)::text from public.settlements where id = tests.id('s1')),
  (tests.uid('b'), tests.uid('a'), 2000::bigint, 'USD'::char(3), 1::numeric(24,12), tests.uid('a'))::text,
  'a member records that someone paid them'
);
select results_eq(
  $$ select pg_temp.net(tests.id('g'), 'a'), pg_temp.net(tests.id('g'), 'b') $$,
  $$ values (-2000::bigint, 2000::bigint) $$,
  '"b paid me 20" moves both balances by 20'
);
select is(pg_temp.notes('b', 'settlement.created'), 1, 'the payer hears about it');

select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 500) $$, tests.id('g'), tests.uid('b'), tests.uid('c')),
  '42501', 'not_a_party', 'a member cannot record a payment between two others'
);

select tests.login('ad');
select lives_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 500) $$, tests.id('g'), tests.uid('b'), tests.uid('c')),
  'an admin can record a payment between two others'
);

select tests.login('c');
select tests.remember('s_eur', (select id from public.settle_up_v2(tests.id('g'), tests.uid('c'), tests.uid('a'), 1000, 'eur', 'cash', current_date - 20)));
select is(
  (select (currency, fx_rate, (settled_at at time zone 'UTC')::date)::text from public.settlements where id = tests.id('s_eur')),
  ('EUR'::char(3), 1.1::numeric(24,12), current_date - 20)::text,
  'a backdated payment keeps that day''s rate and sorts on that day'
);
select is(
  (select (settled_at at time zone 'UTC')::time from public.settlements where id = tests.id('s_eur')),
  '12:00'::time,
  'a past day is stored at noon UTC'
);

select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 0) $$, tests.id('g'), tests.uid('c'), tests.uid('a')),
  '22023', 'invalid_amount', 'amount must be positive'
);
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100) $$, tests.id('g'), tests.uid('c'), tests.uid('c')),
  '22023', 'invalid_parties', 'payer and payee must differ'
);
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100) $$, tests.id('g'), tests.uid('c'), tests.uid('x')),
  '23514', 'member_not_in_group', 'both people must be in the group'
);
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100, 'GBP') $$, tests.id('g'), tests.uid('c'), tests.uid('a')),
  '23514', 'fx_rate_unavailable', 'a currency without a rate is refused'
);
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100, 'U$D') $$, tests.id('g'), tests.uid('c'), tests.uid('a')),
  '22023', 'invalid_currency', 'a malformed currency is refused'
);
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100, null, %L) $$, tests.id('g'), tests.uid('c'), tests.uid('a'), repeat('x', 501)),
  '22023', 'note_too_long', 'notes stay short'
);

select tests.login('x');
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100) $$, tests.id('g'), tests.uid('x'), tests.uid('a')),
  '42501', 'not_a_member', 'outsiders cannot record payments'
);
select tests.login_anon();
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100) $$, tests.id('g'), tests.uid('b'), tests.uid('a')),
  '42501', null, 'anon cannot call settle_up_v2'
);

-- update_settlement -------------------------------------------------------------------------------

select tests.login('a');
select is(
  (select amount_cents from public.update_settlement(tests.id('s1'), '{"amount_cents": 2500, "note": "rent"}')),
  2500::bigint,
  'a party can change the amount'
);
select is(pg_temp.net(tests.id('g'), 'b'), 3000::bigint, 'the balance follows the edit');
select is(pg_temp.notes('b', 'settlement.updated'), 1, 'the other person hears about the edit');
select is(
  (select count(*)::int from public.activity where subject_id = tests.id('s1') and verb = 'settlement.updated'),
  1,
  'the edit is in the activity feed'
);
select throws_ok(
  format($$ select public.update_settlement(%L, %L) $$, tests.id('s1'), jsonb_build_object('from_user', tests.uid('b'), 'to_user', tests.uid('c'))),
  '42501', 'not_a_party', 'a member cannot move a payment to two other people'
);
select throws_ok(
  format($$ select public.update_settlement(%L, '{"settled_on": "not a day"}') $$, tests.id('s1')),
  '22023', 'invalid_payload', 'a bad date is refused'
);

select tests.login('c');
select throws_ok(
  format($$ select public.update_settlement(%L, '{"amount_cents": 1}') $$, tests.id('s1')),
  '42501', 'not_allowed', 'someone outside the payment cannot edit it'
);
select is(
  (select (fx_rate, (settled_at at time zone 'UTC')::date)::text
   from public.update_settlement(tests.id('s_eur'), jsonb_build_object('settled_on', current_date))),
  (1.5::numeric(24,12), current_date)::text,
  'moving a foreign payment to another day takes that day''s rate'
);
select is(
  (select fx_rate from public.update_settlement(tests.id('s_eur'), '{"note": "cash, finally"}')),
  1.5::numeric(24,12),
  'a note change keeps the rate'
);

select tests.login('x');
select throws_ok(
  format($$ select public.update_settlement(%L, '{"note": "hi"}') $$, tests.id('s1')),
  '42501', 'not_a_member', 'outsiders cannot edit'
);
select tests.login('a');
select throws_ok(
  format($$ select public.update_settlement(%L, '{}') $$, gen_random_uuid()),
  'PT404', 'settlement_not_found', 'unknown payments are not found'
);

-- delete and restore -----------------------------------------------------------------------------

select tests.login('b');
select lives_ok(format($$ select public.delete_settlement(%L) $$, tests.id('s1')), 'the payer deletes the payment');
select is(pg_temp.notes('a', 'settlement.deleted'), 1, 'the other person hears about the delete');
select is(pg_temp.net(tests.id('g'), 'b'), 500::bigint, 'deleting takes it off the balance');

select tests.login('a');
select throws_ok(
  format($$ select public.update_settlement(%L, '{"note": "x"}') $$, tests.id('s1')),
  '23514', 'settlement_deleted', 'a deleted payment is restored before editing'
);
select tests.login('c');
select throws_ok(
  format($$ select public.restore_settlement(%L) $$, tests.id('s1')),
  '42501', 'not_allowed', 'only people who could delete it can restore it'
);
select tests.login('a');
select ok((select deleted_at is null from public.restore_settlement(tests.id('s1'))), 'a party restores it');
select is(pg_temp.net(tests.id('g'), 'b'), 3000::bigint, 'restoring puts the balance back');
select is(pg_temp.notes('b', 'settlement.restored'), 1, 'the other person hears about the restore');
select is(
  (select count(*)::int from public.activity where subject_id = tests.id('s1') and verb = 'settlement.restored'),
  1,
  'the restore is in the activity feed'
);
select tests.login('o');
select lives_ok(format($$ select public.restore_settlement(%L) $$, tests.id('s1')), 'restoring a live payment is a no-op');
select tests.login('x');
select throws_ok(format($$ select public.restore_settlement(%L) $$, tests.id('s1')), '42501', 'not_a_member', 'outsiders cannot restore');

-- Departed members ---------------------------------------------------------------------------------

reset role;
select tests.remember('gd', pg_temp.fresh(array['a', 'c'], true));
select tests.login('a');
select tests.remember('p_x', (select id from public.settle_up_v2(tests.id('gd'), tests.uid('c'), tests.uid('a'), 300)));
select tests.remember('p_y', (select id from public.settle_up_v2(tests.id('gd'), tests.uid('a'), tests.uid('c'), 300)));
select tests.remember('p_dep', (select id from public.settle_up_v2(tests.id('gd'), tests.uid('c'), tests.uid('a'), 700)));
select public.delete_settlement(tests.id('p_dep'));
reset role;
delete from public.group_members where group_id = tests.id('gd') and user_id = tests.uid('c');

select tests.login('a');
select throws_ok(
  format($$ select public.restore_settlement(%L) $$, tests.id('p_dep')),
  '23514', 'member_not_in_group', 'restoring cannot move a former member''s balance'
);
select throws_ok(
  format($$ select public.update_settlement(%L, '{"amount_cents": 400}') $$, tests.id('p_x')),
  '23514', 'member_not_in_group', 'the amount of a payment with a former member stays'
);
select is(
  (select note from public.update_settlement(tests.id('p_x'), '{"note": "for the record"}')),
  'for the record',
  'the note of a payment with a former member stays editable'
);
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100) $$, tests.id('gd'), tests.uid('c'), tests.uid('a')),
  '23514', 'member_not_in_group', 'no new payments with someone who left'
);

-- Comments on payments -------------------------------------------------------------------------------

select tests.login('a');
with added as (
  insert into public.comments (settlement_id, body) values (tests.id('s1'), 'Thanks!') returning id
)
select tests.remember('cm', (select id from added));
select is(
  (select group_id from public.comments where id = tests.id('cm')),
  tests.id('g'),
  'a payment comment takes the payment''s group'
);
select is(pg_temp.notes('b', 'comment.created'), 1, 'the other person in the payment hears about the comment');
select is(
  (select count(*)::int from public.activity where subject_id = tests.id('cm') and data ->> 'settlement_id' = tests.id('s1')::text),
  1,
  'the comment is in the feed with its payment'
);
select tests.login('c');
select is(
  (select count(*)::int from public.comments where settlement_id = tests.id('s1')),
  1,
  'group members read payment comments'
);
select tests.login('x');
select is(
  (select count(*)::int from public.comments where settlement_id = tests.id('s1')),
  0,
  'outsiders do not'
);
select throws_ok(
  format($$ insert into public.comments (settlement_id, body) values (%L, 'hi') $$, tests.id('s1')),
  '42501', null, 'outsiders cannot comment on a payment'
);
select tests.login('a');
select throws_ok(
  format($$ insert into public.comments (settlement_id, event_id, body) values (%L, gen_random_uuid(), 'hi') $$, tests.id('s1')),
  '23514', null, 'a comment belongs to exactly one thing'
);

-- Payment methods ---------------------------------------------------------------------------------------

select is(
  (select count(*)::int from (values
    ('paypal', 'avamakes', true), ('paypal', 'ava.makes', false), ('paypal', 'ava makes', false),
    ('venmo', 'Ava-Lee', true), ('venmo', 'ava', false),
    ('cashapp', 'Ava22', true), ('cashapp', '2ava', false),
    ('revolut', 'avalee', true), ('monzo', 'av', false),
    ('upi', 'ava@okhdfc', true), ('upi', 'ava', false),
    ('interac', 'ava@example.ca', true), ('interac', '+14165550123', true), ('interac', '555', false),
    ('bank', 'IBAN DE89 3704 0044 0532 0130 00', true), ('bank', '', false),
    ('paypal', ' ava', false), ('zelle', 'ava', false)
  ) as cases (kind, handle, expected)
  where private.valid_payment_handle(kind, handle) is distinct from expected),
  0,
  'handle rules match the core test cases'
);

select tests.login('a');
select lives_ok($$ insert into public.payment_methods (kind, handle) values ('paypal', 'avamakes') $$, 'you save your own handle');
select throws_ok(
  $$ insert into public.payment_methods (kind, handle) values ('venmo', '@ava') $$,
  '22023', 'invalid_payment_handle', 'a malformed handle is refused'
);
select tests.login('b');
select is(
  (select handle from public.payment_methods where user_id = tests.uid('a') and kind = 'paypal'),
  'avamakes',
  'people who share a group read your handles'
);
select is_empty(
  format($$ update public.payment_methods set handle = 'stolen' where user_id = %L returning 1 $$, tests.uid('a')),
  'nobody else changes them'
);
select is_empty(
  format($$ delete from public.payment_methods where user_id = %L returning 1 $$, tests.uid('a')),
  'nobody else removes them'
);
select throws_ok(
  format($$ insert into public.payment_methods (user_id, kind, handle) values (%L, 'venmo', 'someone-else') $$, tests.uid('a')),
  '42501', null, 'nobody saves a handle for someone else'
);
select tests.login('x');
select is(
  (select count(*)::int from public.payment_methods where user_id = tests.uid('a')),
  0,
  'outsiders cannot read your handles'
);
reset role;
insert into public.blocks (blocker_id, blocked_id) values (tests.uid('a'), tests.uid('c'));
select tests.login('c');
select is(
  (select count(*)::int from public.payment_methods where user_id = tests.uid('a')),
  0,
  'someone you blocked cannot read your handles'
);
reset role;
delete from public.blocks where blocker_id = tests.uid('a');
select tests.login_anon();
select throws_ok($$ select count(*) from public.payment_methods $$, '42501', null, 'anon cannot read handles');

-- Pairwise debts mirror pairwiseDebts (pairwise-debts.test.ts) ------------------------------------------

reset role;
select tests.remember('p1', pg_temp.fresh(array['a', 'b', 'c'], false));
select tests.login('a');
select public.create_expense(jsonb_build_object('group_id', tests.id('p1'), 'description', 'Split', 'amount_cents', 900,
  'splits', tests.people('a', 'b', 'c')));
reset role;
select set_eq(
  format($$ select from_user, to_user, amount_cents from private.pairwise_debts(%L) $$, tests.id('p1')),
  format($$ values (%L::uuid, %L::uuid, 300::bigint), (%L::uuid, %L::uuid, 300::bigint) $$,
    tests.uid('b'), tests.uid('a'), tests.uid('c'), tests.uid('a')),
  'pairwise: each split person owes the payer their share'
);

select tests.remember('p2', pg_temp.fresh(array['a', 'b'], false));
select tests.login('a');
select public.create_expense(jsonb_build_object('group_id', tests.id('p2'), 'description', 'One', 'amount_cents', 1000,
  'split_type', 'exact', 'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('b'), 'share_cents', 1000))));
select tests.login('b');
select public.create_expense(jsonb_build_object('group_id', tests.id('p2'), 'description', 'Two', 'amount_cents', 400,
  'split_type', 'exact', 'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('a'), 'share_cents', 400))));
reset role;
select results_eq(
  format($$ select from_user, to_user, amount_cents from private.pairwise_debts(%L) $$, tests.id('p2')),
  format($$ values (%L::uuid, %L::uuid, 600::bigint) $$, tests.uid('b'), tests.uid('a')),
  'pairwise: opposite debts between two people net out'
);

select tests.remember('p3', pg_temp.fresh(array['a', 'b', 'c'], false));
select tests.login('b');
select public.create_expense(jsonb_build_object('group_id', tests.id('p3'), 'description', 'Chain 1', 'amount_cents', 500,
  'split_type', 'exact', 'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('a'), 'share_cents', 500))));
select tests.login('c');
select public.create_expense(jsonb_build_object('group_id', tests.id('p3'), 'description', 'Chain 2', 'amount_cents', 500,
  'split_type', 'exact', 'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('b'), 'share_cents', 500))));
reset role;
select set_eq(
  format($$ select from_user, to_user, amount_cents from private.pairwise_debts(%L) $$, tests.id('p3')),
  format($$ values (%L::uuid, %L::uuid, 500::bigint), (%L::uuid, %L::uuid, 500::bigint) $$,
    tests.uid('a'), tests.uid('b'), tests.uid('b'), tests.uid('c')),
  'pairwise: chains are not collapsed'
);

select tests.remember('p4', pg_temp.fresh(array['a', 'b'], false));
select tests.login('a');
select public.create_expense(jsonb_build_object('group_id', tests.id('p4'), 'description', 'Paid back', 'amount_cents', 1000,
  'split_type', 'exact', 'splits', jsonb_build_array(jsonb_build_object('user_id', tests.uid('b'), 'share_cents', 1000))));
select public.settle_up_v2(tests.id('p4'), tests.uid('b'), tests.uid('a'), 1000);
select tests.remember('gone', (select id from public.settle_up_v2(tests.id('p4'), tests.uid('b'), tests.uid('a'), 50)));
select public.delete_settlement(tests.id('gone'));
reset role;
select is_empty(
  format($$ select 1 from private.pairwise_debts(%L) $$, tests.id('p4')),
  'pairwise: payments pay debts down and deleted ones do not count'
);

select tests.remember('p5', pg_temp.fresh(array['a', 'b'], false));
update public.fx_rates set rate = 1.1 where base = 'EUR' and day = current_date;
select tests.login('a');
select public.create_expense(jsonb_build_object('group_id', tests.id('p5'), 'description', 'Abroad', 'amount_cents', 1000,
  'currency', 'EUR', 'splits', tests.people('a', 'b')));
reset role;
update public.fx_rates set rate = 1.5 where base = 'EUR' and day = current_date;
select results_eq(
  format($$ select from_user, to_user, amount_cents from private.pairwise_debts(%L) $$, tests.id('p5')),
  format($$ values (%L::uuid, %L::uuid, 550::bigint) $$, tests.uid('b'), tests.uid('a')),
  'pairwise: foreign expenses convert once into the group currency'
);

-- Several payers and refunds: the same cases as payers-refunds.test.ts.
create function pg_temp.payer(handle text, cents bigint) returns jsonb language sql as $$
  select jsonb_build_object('user_id', tests.uid(handle), 'paid_cents', cents)
$$;
create function pg_temp.exact(handle text, cents bigint) returns jsonb language sql as $$
  select jsonb_build_object('user_id', tests.uid(handle), 'share_cents', cents)
$$;

select tests.remember('m1', pg_temp.fresh(array['a', 'b', 'c'], false));
select tests.login('a');
select public.create_expense_v2(jsonb_build_object('group_id', tests.id('m1'), 'description', 'Dinner',
  'amount_cents', 9000, 'payers', jsonb_build_array(pg_temp.payer('a', 6000), pg_temp.payer('b', 3000)),
  'splits', tests.people('a', 'b', 'c')));
reset role;
select results_eq(
  format($$ select from_user, to_user, amount_cents from private.pairwise_debts(%L) $$, tests.id('m1')),
  format($$ values (%L::uuid, %L::uuid, 3000::bigint) $$, tests.uid('c'), tests.uid('a')),
  'several payers: only the people behind pay the people ahead'
);

select tests.remember('m2', pg_temp.fresh(array['a', 'b', 'c'], false));
select tests.login('a');
select public.create_expense_v2(jsonb_build_object('group_id', tests.id('m2'), 'description', 'Tickets',
  'amount_cents', 1000, 'payers', jsonb_build_array(pg_temp.payer('a', 500), pg_temp.payer('b', 500)),
  'split_type', 'exact', 'splits', jsonb_build_array(pg_temp.exact('c', 500), pg_temp.exact('o', 500))));
reset role;
select set_eq(
  format($$ select from_user, to_user, amount_cents from private.pairwise_debts(%L) $$, tests.id('m2')),
  format($$ values (%1$L::uuid, %3$L::uuid, 250::bigint), (%1$L::uuid, %4$L::uuid, 250::bigint),
    (%2$L::uuid, %3$L::uuid, 250::bigint), (%2$L::uuid, %4$L::uuid, 250::bigint) $$,
    tests.uid('c'), tests.uid('o'), tests.uid('a'), tests.uid('b')),
  'several payers: a debtor is spread over the creditors by what they are owed'
);

select tests.remember('m3', pg_temp.fresh(array['a', 'b', 'c'], false));
update public.fx_rates set rate = 1.1 where base = 'EUR' and day = current_date;
select tests.login('a');
select public.create_expense_v2(jsonb_build_object('group_id', tests.id('m3'), 'description', 'Abroad',
  'amount_cents', 1000, 'currency', 'EUR',
  'payers', jsonb_build_array(pg_temp.payer('a', 333), pg_temp.payer('b', 667)),
  'split_type', 'exact', 'splits', jsonb_build_array(pg_temp.exact('a', 334), pg_temp.exact('b', 333), pg_temp.exact('c', 333))));
reset role;
update public.fx_rates set rate = 1.5 where base = 'EUR' and day = current_date;
select results_eq(
  format($$ select from_user, to_user, amount_cents from private.pairwise_debts(%L) $$, tests.id('m3')),
  format($$ values (%L::uuid, %L::uuid, 366::bigint), (%L::uuid, %L::uuid, 2::bigint) $$,
    tests.uid('c'), tests.uid('b'), tests.uid('a'), tests.uid('b')),
  'several payers: the converted total is spread over payers and split by largest remainder'
);
select tests.remember('m4', pg_temp.fresh(array['a', 'b'], false));
select tests.login('a');
select public.create_expense_v2(jsonb_build_object('group_id', tests.id('m4'), 'description', 'Dinner',
  'amount_cents', 10000, 'payers', jsonb_build_array(pg_temp.payer('a', 10000)), 'splits', tests.people('a', 'b')));
select public.create_expense_v2(jsonb_build_object('group_id', tests.id('m4'), 'description', 'Refund',
  'amount_cents', 4000, 'is_refund', true, 'payers', jsonb_build_array(pg_temp.payer('a', 4000)),
  'splits', tests.people('a', 'b')));
reset role;
select results_eq(
  format($$ select from_user, to_user, amount_cents from private.pairwise_debts(%L) $$, tests.id('m4')),
  format($$ values (%L::uuid, %L::uuid, 3000::bigint) $$, tests.uid('b'), tests.uid('a')),
  'a refund reduces what someone owes for the original expense'
);

-- Payment days are the caller's own calendar day.
update public.profiles set timezone = 'Pacific/Auckland' where id = tests.uid('c');
select tests.login('c');
select tests.remember('s_nz', (select id from public.settle_up_v2(tests.id('m1'), tests.uid('c'), tests.uid('a'), 100, null, null, current_date - 1)));
select is(
  (select (settled_at at time zone 'Pacific/Auckland')::text from public.settlements where id = tests.id('s_nz')),
  ((current_date - 1) + time '12:00')::text,
  'a picked day is stored at noon of that day in the caller''s zone'
);
reset role;
update public.profiles set timezone = 'UTC' where id = tests.uid('c');

-- settle_all ------------------------------------------------------------------------------------------------

select tests.remember('ga', pg_temp.fresh(array['a', 'b', 'c'], false));
select tests.login('a');
select public.create_expense(jsonb_build_object('group_id', tests.id('ga'), 'description', 'Dinner', 'amount_cents', 900,
  'splits', tests.people('a', 'b', 'c')));
select tests.login('b');
select public.create_expense(jsonb_build_object('group_id', tests.id('ga'), 'description', 'Cab', 'amount_cents', 600,
  'splits', tests.people('b', 'c')));
select tests.login('a');
select is(
  (select count(*)::int from public.settle_all(tests.id('ga'))),
  2,
  'settle_all records every debt involving you'
);
select results_eq(
  format($$ select pg_temp.net(%1$L, 'a'), pg_temp.net(%1$L, 'b'), pg_temp.net(%1$L, 'c') $$, tests.id('ga')),
  $$ values (0::bigint, 300::bigint, -300::bigint) $$,
  'your balance is square and debts between others stay'
);
select is((select count(*)::int from public.settle_all(tests.id('ga'))), 0, 'settling again records nothing');
select tests.login('x');
select throws_ok(format($$ select * from public.settle_all(%L) $$, tests.id('ga')), '42501', 'not_a_member', 'outsiders cannot settle a group');

-- friend_balances and settle_with_friend ----------------------------------------------------------------------

-- Fresh people, so no other group in this file is shared between them.
reset role;
select tests.create_user('fa');
select tests.create_user('fb');
select tests.create_user('fc');
select tests.remember('f1', pg_temp.fresh(array['fa', 'fb'], true));
select tests.remember('f2', pg_temp.fresh(array['fa', 'fb', 'fc'], false, 'EUR'));
select tests.remember('f3', pg_temp.fresh(array['fa', 'fb'], true));
select tests.remember('f4', pg_temp.fresh(array['fa', 'fb'], true));
select tests.login('fa');
select public.create_expense(jsonb_build_object('group_id', tests.id('f1'), 'description', 'One', 'amount_cents', 1000, 'splits', tests.people('fa', 'fb')));
select public.create_expense(jsonb_build_object('group_id', tests.id('f2'), 'description', 'Two', 'amount_cents', 900, 'currency', 'EUR', 'splits', tests.people('fa', 'fb', 'fc')));
select public.create_expense(jsonb_build_object('group_id', tests.id('f4'), 'description', 'Four', 'amount_cents', 800, 'splits', tests.people('fa', 'fb')));
select tests.login('fb');
select public.create_expense(jsonb_build_object('group_id', tests.id('f3'), 'description', 'Three', 'amount_cents', 200, 'splits', tests.people('fa', 'fb')));
reset role;
update public.groups set archived_at = now() where id = tests.id('f4');

select tests.login('fa');
select set_eq(
  format($$ select group_id, currency, net_cents, archived from public.friend_balances() where friend_id = %L $$, tests.uid('fb')),
  format($$ values (%L::uuid, 'USD', 500::bigint, false), (%L::uuid, 'EUR', 300::bigint, false),
    (%L::uuid, 'USD', -100::bigint, false), (%L::uuid, 'USD', 400::bigint, true) $$,
    tests.id('f1'), tests.id('f2'), tests.id('f3'), tests.id('f4')),
  'friend_balances lists what you and a friend owe each other in each shared group'
);

select tests.login('fb');
select is(
  (select count(*)::int from public.settle_with_friend(tests.uid('fa'))),
  3,
  'settling with a friend across three open groups records three payments'
);
select tests.login('fa');
select results_eq(
  format($$ select pg_temp.net(%L, 'fb'), pg_temp.net(%L, 'fb'), pg_temp.net(%L, 'fb') $$, tests.id('f1'), tests.id('f3'), tests.id('f4')),
  $$ values (0::bigint, 0::bigint, -400::bigint) $$,
  'and zeroes those balances, leaving the archived group alone'
);
select is(
  (select count(*)::int from public.friend_balances() where friend_id = tests.uid('fb') and not archived),
  0,
  'nothing is left between the two in open groups'
);
select is(pg_temp.net(tests.id('f2'), 'fc'), -300::bigint, 'other people''s debts are untouched');
select is(
  (select count(*)::int from public.settle_with_friend(tests.uid('fb'))),
  0,
  'settling again records nothing'
);
select throws_ok(
  format($$ select * from public.settle_with_friend(%L) $$, tests.uid('fa')),
  '22023', 'invalid_parties', 'you cannot settle with yourself'
);
select tests.login_anon();
select throws_ok(
  format($$ select * from public.settle_with_friend(%L) $$, tests.uid('fa')),
  '42501', null, 'anon cannot call settle_with_friend'
);

-- Picking groups and paying part of what is owed.
reset role;
select tests.remember('f5', pg_temp.fresh(array['fa', 'fb'], true));
select tests.remember('f6', pg_temp.fresh(array['fa', 'fb'], true));
select tests.login('fa');
select public.create_expense(jsonb_build_object('group_id', tests.id('f5'), 'description', 'Five', 'amount_cents', 1000, 'splits', tests.people('fa', 'fb')));
select public.create_expense(jsonb_build_object('group_id', tests.id('f6'), 'description', 'Six', 'amount_cents', 600, 'splits', tests.people('fa', 'fb')));
select tests.login('fb');
select is(
  (select array_agg(amount_cents) from public.settle_with_friend(tests.uid('fa'), null, null,
    jsonb_build_object(tests.id('f5'), 200))),
  array[200]::bigint[],
  'settling with a friend can pay part of one picked group'
);
select results_eq(
  format($$ select pg_temp.net(%L, 'fb'), pg_temp.net(%L, 'fb') $$, tests.id('f5'), tests.id('f6')),
  $$ values (-300::bigint, -300::bigint) $$,
  'only the picked group moves, by the amount picked'
);
select throws_ok(
  format($$ select * from public.settle_with_friend(%L, null, null, %L) $$, tests.uid('fa'),
    jsonb_build_object(tests.id('f6'), 301)),
  '22023', 'invalid_amount', 'no more than is owed in a group'
);
select throws_ok(
  format($$ select * from public.settle_with_friend(%L, null, null, %L) $$, tests.uid('fa'),
    jsonb_build_object(tests.id('f4'), 100)),
  '23514', 'nothing_owed', 'an archived or settled group cannot be picked'
);
select throws_ok(
  format($$ select * from public.settle_with_friend(%L, null, null, '{}') $$, tests.uid('fa')),
  '22023', 'invalid_payload', 'picking needs at least one group'
);

-- remind_debt ---------------------------------------------------------------------------------------------------

reset role;
select tests.remember('gr', pg_temp.fresh(array['a', 'b', 'c'], true));
select tests.login('a');
select public.create_expense(jsonb_build_object('group_id', tests.id('gr'), 'description', 'Groceries', 'amount_cents', 1000, 'splits', tests.people('a', 'b')));
select is(
  (select (amount_cents, currency)::text from public.remind_debt(tests.id('gr'), tests.uid('b'))),
  (500::bigint, 'USD'::char(3))::text,
  'the person owed sends a reminder with what is owed'
);
select is(pg_temp.notes('b', 'debt.reminder'), 1, 'the debtor gets a debt.reminder notification');
select throws_ok(
  format($$ select public.remind_debt(%L, %L) $$, tests.id('gr'), tests.uid('b')),
  '23514', 'already_reminded', 'pressing Remind twice in a day says it was already sent'
);
select throws_ok(
  format($$ select public.remind_debt(%L, %L) $$, tests.id('gr'), tests.uid('c')),
  '23514', 'nothing_owed', 'you can only remind someone who owes you'
);
select throws_ok(
  format($$ select public.remind_debt(%L, %L) $$, tests.id('gr'), tests.uid('a')),
  '22023', 'invalid_parties', 'you cannot remind yourself'
);
select throws_ok(
  format($$ select public.remind_debt(%L, %L) $$, tests.id('gr'), tests.uid('x')),
  '23514', 'member_not_in_group', 'you cannot remind someone outside the group'
);
select public.create_expense(jsonb_build_object('group_id', tests.id('gr'), 'description', 'Rent', 'amount_cents', 2000, 'splits', tests.people('a', 'c')));
select is(
  (select note from public.remind_debt(tests.id('gr'), tests.uid('c'), '  Rent is due Friday  ')),
  'Rent is due Friday',
  'a reminder can carry a short note'
);
select is(
  (select count(*)::int from public.notifications
   where user_id = tests.uid('c') and type = 'debt.reminder' and data ->> 'note' = 'Rent is due Friday'),
  0,
  'the debtor''s notification is not readable by the sender'
);
reset role;
select is(
  (select data ->> 'note' from public.notifications where user_id = tests.uid('c') and type = 'debt.reminder'),
  'Rent is due Friday',
  'and the note reaches the debtor'
);
select tests.login('a');
select throws_ok(
  format($$ select public.remind_debt(%L, %L, %L) $$, tests.id('gr'), tests.uid('c'), repeat('x', 281)),
  '22023', 'note_too_long', 'reminder notes stay short'
);
select tests.login('b');
select is((select count(*)::int from public.debt_reminders where group_id = tests.id('gr') and to_user = tests.uid('b')), 1, 'the debtor sees the reminder');
select tests.login('c');
select is((select count(*)::int from public.debt_reminders where group_id = tests.id('gr') and to_user = tests.uid('b')), 0, 'others in the group do not');
select throws_ok(
  format($$ insert into public.debt_reminders (group_id, from_user, to_user, amount_cents, currency) values (%L, %L, %L, 1, 'USD') $$,
    tests.id('gr'), tests.uid('c'), tests.uid('b')),
  '42501', null, 'nobody writes reminders directly'
);
select tests.login('x');
select throws_ok(
  format($$ select public.remind_debt(%L, %L) $$, tests.id('gr'), tests.uid('b')),
  '42501', 'not_a_member', 'outsiders cannot send reminders'
);

-- Archived groups refuse every write ------------------------------------------------------------------------------

reset role;
update public.groups set archived_at = now() where id in (tests.id('g'), tests.id('gr'));
select tests.login('a');
select throws_ok(
  format($$ select public.settle_up_v2(%L, %L, %L, 100) $$, tests.id('g'), tests.uid('b'), tests.uid('a')),
  '23514', 'group_archived', 'settle_up_v2 refuses archived groups'
);
select throws_ok(
  format($$ select public.update_settlement(%L, '{"note": "x"}') $$, tests.id('s1')),
  '23514', 'group_archived', 'update_settlement refuses archived groups'
);
select throws_ok(
  format($$ select public.restore_settlement(%L) $$, tests.id('s1')),
  '23514', 'group_archived', 'restore_settlement refuses archived groups'
);
select throws_ok(
  format($$ select * from public.settle_all(%L) $$, tests.id('g')),
  '23514', 'group_archived', 'settle_all refuses archived groups'
);
select throws_ok(
  format($$ select public.remind_debt(%L, %L) $$, tests.id('gr'), tests.uid('b')),
  '23514', 'group_archived', 'remind_debt refuses archived groups'
);
select throws_ok(
  format($$ insert into public.comments (settlement_id, body) values (%L, 'late') $$, tests.id('s1')),
  '23514', 'group_archived', 'no new comments on payments in archived groups'
);

-- A closed account stops sharing its handles -----------------------------------------------------------------------

reset role;
update public.profiles set deleted_at = now() where id = tests.uid('a');
select is(
  (select count(*)::int from public.payment_methods where user_id = tests.uid('a')),
  0,
  'closing an account removes its payment methods'
);

select * from finish();
rollback;
