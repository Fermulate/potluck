-- calendar_feed_token() and the push hook
begin;
select plan(10);

select tests.create_user('owner');
select tests.create_user('snoop');

select tests.login_anon();
select throws_ok($$ select calendar_feed_token() $$, '42501', null, 'anon cannot get a feed token');

select tests.login('owner');
select ok(set_config('tests.tok', calendar_feed_token(), true) is not null, 'owner gets a token');
select ok(char_length(calendar_feed_token()) >= 32, 'token is long');
select is(calendar_feed_token(), current_setting('tests.tok'), 'same token on repeat calls');
select isnt(calendar_feed_token(true), current_setting('tests.tok'), 'rotate issues a new token');
select is((select count(*)::int from public.calendar_feed_tokens), 1, 'owner sees their own token');

select tests.login('snoop');
select is((select count(*)::int from public.calendar_feed_tokens), 0, 'others cannot read it');
select throws_ok(
  $$ insert into public.calendar_feed_tokens (user_id, token) values (auth.uid(), repeat('x', 40)) $$,
  '42501', null, 'tokens cannot be written directly'
);

-- With no Vault secrets the push hook is a no-op, so inserts still succeed.
reset role;
select lives_ok(
  $$ insert into public.notifications (user_id, type) values (tests.uid('owner'), 'member.joined') $$,
  'notification insert works without edge config'
);
select is(
  (select count(*)::int from net.http_request_queue),
  0,
  'nothing is sent without edge config'
);

select * from finish();
rollback;
