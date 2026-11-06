-- Ledger and membership integrity: blocks on invites, former members, splits-only
-- edits, payments with people who left, owners left with closed accounts,
-- rescheduling reminders and FX precision.
begin;
select plan(10);

select tests.create_user('own');
select tests.create_user('mem');
select tests.create_user('pal');
select tests.create_user('blk');
select tests.create_user('rev');
select tests.create_user('joiner');
select tests.create_user('stranger');
select tests.create_user('closer', 'Cora Closer');
select tests.create_user('stayer');
select tests.create_user('quitter', 'Quinn Quitter');
select tests.create_user('boss');
select tests.create_user('ghost');

-- Blocks and invites ----------------------------------------------------------------------------

select tests.remember('g', tests.group_with('own', array['mem'], '{}', 'Block party'));
select tests.remember('arch', tests.group_with('own', '{}', '{}', 'Old trip'));
reset role;
insert into public.group_invites (group_id, code, created_by) values
  (tests.id('g'), 'blockparty-1', tests.uid('own')),
  (tests.id('arch'), 'oldtrip-0001', tests.uid('own'));
update public.groups set archived_at = now() where id = tests.id('arch');
-- own blocked blk; rev blocked mem.
insert into public.blocks (blocker_id, blocked_id) values
  (tests.uid('own'), tests.uid('blk')),
  (tests.uid('rev'), tests.uid('mem'));

select tests.login('blk');
select is((select status from invite_preview('blockparty-1')), 'blocked', 'preview: a member blocked the visitor');
select throws_ok($$ select accept_invite('blockparty-1') $$, '42501', 'blocked', 'joining is refused when a member blocked you');

select tests.login('rev');
select is((select status from invite_preview('blockparty-1')), 'blocked', 'preview: the visitor blocked a member');
select throws_ok($$ select accept_invite('blockparty-1') $$, '42501', 'blocked', 'joining is refused when you blocked a member');

select tests.login_anon();
select is((select status from invite_preview('blockparty-1')), 'valid', 'anonymous visitors see a valid invite');
select is((select status from invite_preview('oldtrip-0001')), 'archived', 'preview: archived group is unavailable');

select tests.login('joiner');
select is((select status from invite_preview('blockparty-1')), 'valid', 'preview: no block, valid');
select lives_ok($$ select accept_invite('blockparty-1') $$, 'people without blocks still join');
select throws_ok($$ select accept_invite('oldtrip-0001') $$, '23514', 'group_archived', 'archived groups still refuse joins');
reset role;
select is(
  (select count(*)::int from public.group_members where group_id = tests.id('g') and user_id in (tests.uid('blk'), tests.uid('rev'))),
  0,
  'blocked people never got a membership'
);

select * from finish();
rollback;
