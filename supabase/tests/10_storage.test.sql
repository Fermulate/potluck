-- Storage object policies for avatars, group-covers and receipts.
begin;
select plan(19);

select tests.create_user('owner');
select tests.create_user('admin');
select tests.create_user('member');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('owner', array['member'], array['admin']));

create function pg_temp.put(bucket text, path text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id) values (bucket, path, auth.uid()::text)
$$;
grant execute on function pg_temp.put(text, text) to authenticated, anon;

-- avatars
select tests.login('member');
select lives_ok(
  format($$ select pg_temp.put('avatars', '%s/me.png') $$, tests.uid('member')),
  'upload own avatar'
);
select throws_ok(
  format($$ select pg_temp.put('avatars', '%s/me.png') $$, tests.uid('owner')),
  '42501', null, 'cannot write into someone else''s avatar folder'
);
select throws_ok($$ select pg_temp.put('avatars', 'loose.png') $$, '42501', null, 'avatars must be in a user folder');
select tests.login_anon();
select is(
  (select count(*)::int from storage.objects where bucket_id = 'avatars'),
  1,
  'avatars are publicly readable'
);
select tests.login('outsider');
update storage.objects set name = name || '.bak' where bucket_id = 'avatars';
reset role;
select is(
  (select name from storage.objects where bucket_id = 'avatars'),
  tests.uid('member') || '/me.png',
  'others cannot overwrite an avatar'
);

-- group covers
select tests.login('admin');
select lives_ok(
  format($$ select pg_temp.put('group-covers', '%s/cover.jpg') $$, tests.id('g')),
  'admins upload a group cover'
);
select tests.login('member');
select throws_ok(
  format($$ select pg_temp.put('group-covers', '%s/mine.jpg') $$, tests.id('g')),
  '42501', null, 'members cannot change the cover'
);
select throws_ok(
  $$ select pg_temp.put('group-covers', 'not-a-uuid/cover.jpg') $$,
  '42501', null, 'covers must be in a group folder'
);
select tests.login('outsider');
select throws_ok(
  format($$ select pg_temp.put('group-covers', '%s/x.jpg') $$, tests.id('g')),
  '42501', null, 'outsiders cannot upload covers'
);
select tests.login_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'group-covers'), 0,
  'anon cannot list covers (the public URL still serves them)');

-- receipts
select tests.login('member');
select lives_ok(
  format($$ select pg_temp.put('receipts', '%s/receipt-1.jpg') $$, tests.id('g')),
  'members upload receipts to their group'
);
select tests.login('outsider');
select throws_ok(
  format($$ select pg_temp.put('receipts', '%s/fake.jpg') $$, tests.id('g')),
  '42501', null, 'outsiders cannot upload receipts'
);
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0, 'outsiders cannot read receipts');
select tests.login_anon();
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0, 'receipts are not public');
select tests.login('admin');
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 1, 'members read their group''s receipts');

select tests.login('owner');
select lives_ok(
  format($$ select pg_temp.put('receipts', '%s/receipt-2.jpg') $$, tests.id('g')),
  'owners upload receipts too'
);
select tests.login('member');
update storage.objects set metadata = '{"x": 1}' where bucket_id = 'receipts';
reset role;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'receipts' and metadata is not null),
  1,
  'members only update their own receipts'
);
select tests.login('admin');
update storage.objects set metadata = '{"y": 1}' where bucket_id = 'receipts';
reset role;
select is(
  (select count(*)::int from storage.objects where bucket_id = 'receipts' and metadata ? 'y'),
  2,
  'admins can update any receipt in the group'
);

select ok(
  (select not public from storage.buckets where id = 'receipts'),
  'receipts bucket is private'
);

select * from finish();
rollback;
