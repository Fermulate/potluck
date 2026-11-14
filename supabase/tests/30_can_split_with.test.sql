-- can_split_with(person) (20261114060521_can_split_with): the friend page asks it before offering
-- "Add expense". It says yes exactly when the write would go in (get_or_create_direct_group for a
-- new tab, private.freeze_blocked_direct_money in an existing one) and never says why it is no.
begin;
select plan(14);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('dan');
select tests.create_user('stranger');

select tests.remember('g', tests.group_with('ava', array['ben', 'cleo', 'dan']));

select tests.login('ava');
select public.add_placeholder_member(tests.id('g'), 'Sam');
reset role;
select tests.remember('seat', (
  select p.id from public.profiles p
  join public.group_members m on m.user_id = p.id and m.group_id = tests.id('g')
  where p.is_placeholder
));

-- Who you can split with -----------------------------------------------------------------------

select tests.login('ava');
select is(public.can_split_with(tests.uid('ben')), true, 'someone you share a group with');
select is(public.can_split_with(tests.uid('stranger')), false, 'not a stranger');
select is(public.can_split_with(tests.uid('ava')), false, 'not yourself');
select is(public.can_split_with(null), false, 'not nobody');
select is(public.can_split_with(tests.id('seat')), false, 'not a seat nobody has taken');

reset role;
update public.profiles set deleted_at = now() where id = tests.uid('dan');
select tests.login('ava');
select is(public.can_split_with(tests.uid('dan')), false, 'not a closed account');

select tests.login_anon();
select throws_ok(
  format($$ select public.can_split_with(%L) $$, tests.uid('ben')),
  '42501', null, 'anon cannot ask'
);

-- Blocks, before any tab exists: no either way, as get_or_create_direct_group refuses ----------

reset role;
insert into public.blocks (blocker_id, blocked_id) values (tests.uid('ben'), tests.uid('ava'));
select tests.login('ava');
select is(public.can_split_with(tests.uid('ben')), false, 'the blocked side is told no');
select throws_ok(
  format($$ select public.get_or_create_direct_group(%L) $$, tests.uid('ben')),
  '42501', 'not_a_friend', '...which is what opening the tab says'
);
select tests.login('ben');
select is(public.can_split_with(tests.uid('ava')), false, 'and so is the side who blocked');

-- A tab that already exists: the blocked side is frozen, the blocker still writes ---------------

reset role;
delete from public.blocks where blocker_id = tests.uid('ben');
select tests.login('ava');
select tests.remember('tab', public.get_or_create_direct_group(tests.uid('cleo')));
select is(public.can_split_with(tests.uid('cleo')), true, 'an open tab with no block');

reset role;
insert into public.blocks (blocker_id, blocked_id) values (tests.uid('cleo'), tests.uid('ava'));
select tests.login('ava');
select is(public.can_split_with(tests.uid('cleo')), false, 'the blocked side of a tab cannot add');
select throws_ok(
  format(
    $$ select public.settle_up_v2(%L, %L, %L, 100) $$,
    tests.id('tab'), tests.uid('ava'), tests.uid('cleo')
  ),
  '42501', 'not_a_friend', '...as the tab itself refuses their money'
);
select tests.login('cleo');
select is(public.can_split_with(tests.uid('ava')), true, 'the blocker still can, as the tab allows');

select * from finish();
rollback;
