-- Several attachments per expense (20261113155139_expense_attachments, ADR 21): the files stay in
-- the private receipts bucket under the group folder, so other groups, anon and an unfinished
-- two-step sign in read none of them; set_expense_attachments and the receipt_path mirror for
-- older clients.
begin;
select plan(49);

select tests.create_user('ava');
select tests.create_user('ben');
select tests.create_user('cleo');
select tests.create_user('outsider');

select tests.remember('g', tests.group_with('ava', array['ben'], array['cleo'], 'Dinner club', 'USD'));
select tests.remember('other', tests.group_with('outsider', '{}', '{}', 'Elsewhere', 'USD'));

create function pg_temp.put(path text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('receipts', path, auth.uid()::text,
          case when path like '%.pdf' then '{"mimetype": "application/pdf"}'::jsonb end)
$$;
create function pg_temp.file(name text) returns text language sql as $$
  select tests.id('g')::text || '/' || name
$$;
create function pg_temp.files(variadic names text[]) returns jsonb language sql as $$
  select jsonb_agg(tests.id('g')::text || '/' || n order by o)
  from unnest(names) with ordinality as x (n, o)
$$;
create function pg_temp.paths(ekey text) returns text language sql as $$
  select string_agg(split_part(a.path, '/', 2), ',' order by a.position)
  from public.expense_attachments a where a.expense_id = tests.id(ekey)
$$;
grant execute on function pg_temp.put(text) to authenticated, anon;
grant execute on function pg_temp.file(text) to authenticated, anon;
grant execute on function pg_temp.files(text[]) to authenticated, anon;

-- Files and an expense with one receipt, the way an older client saves it.
select tests.login('ava');
select pg_temp.put(pg_temp.file('one.jpg'));
select pg_temp.put(pg_temp.file('two.png'));
select pg_temp.put(pg_temp.file('three.pdf'));
select pg_temp.put(pg_temp.file('four.webp'));
select pg_temp.put(pg_temp.file('five.jpg'));
select pg_temp.put(pg_temp.file('six.jpg'));
select tests.remember('e', (select id from public.create_expense_v2(jsonb_build_object(
  'group_id', tests.id('g'), 'description', 'Dinner', 'amount_cents', 9000,
  'paid_by', tests.uid('ava'), 'splits', tests.people('ava', 'ben'),
  'receipt_path', pg_temp.file('one.jpg')))));
reset role;

select is(pg_temp.paths('e'), 'one.jpg', 'a receipt saved by an older client is the first attachment');
select is(
  (select uploaded_by from public.expense_attachments where expense_id = tests.id('e')),
  tests.uid('ava'),
  'the uploader is recorded'
);

-- Setting the list -------------------------------------------------------------------------------

select tests.login('ava');
select is(
  (select count(*)::int from public.set_expense_attachments(tests.id('e'),
    pg_temp.files('three.pdf', 'one.jpg', 'two.png'))),
  3,
  'the payer sets three attachments'
);
reset role;
select is(pg_temp.paths('e'), 'three.pdf,one.jpg,two.png', 'in the order given');
select is(
  (select receipt_path from public.expenses where id = tests.id('e')),
  pg_temp.file('three.pdf'),
  'receipt_path follows the first attachment'
);
select is(
  (select content_type from public.expense_attachments where expense_id = tests.id('e') and position = 0),
  'application/pdf',
  'the type comes from the upload'
);
select is(
  (select content_type from public.expense_attachments where expense_id = tests.id('e') and position = 2),
  'image/png',
  'else from the extension'
);
select is(
  (select count(*)::int from public.activity
   where subject_id = tests.id('e') and verb = 'expense.updated'),
  1,
  'one edit is logged'
);
select is(
  (select data -> 'changes' -> 'attachments' from public.activity
   where subject_id = tests.id('e') and verb = 'expense.updated'),
  '{"from": 1, "to": 3}'::jsonb,
  'the edit says how many there were and are'
);

select tests.login('ava');
select lives_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'),
    pg_temp.files('three.pdf', 'one.jpg', 'two.png')),
  'the same list again'
);
reset role;
select is(
  (select count(*)::int from public.activity where subject_id = tests.id('e') and verb = 'expense.updated'),
  1,
  'changes nothing and logs nothing'
);

-- Paths are plain strings or {path} objects.
select tests.login('ava');
select is(
  (select count(*)::int from public.set_expense_attachments(tests.id('e'), jsonb_build_array(
    jsonb_build_object('path', pg_temp.file('one.jpg')), pg_temp.file('four.webp')))),
  2,
  'objects with a path work too'
);
reset role;
select is(pg_temp.paths('e'), 'one.jpg,four.webp', 'files left out are dropped from the list');

-- Who may ---------------------------------------------------------------------------------------

select tests.login('ben');
select throws_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'), pg_temp.files('two.png')),
  '42501', 'not_allowed', 'a member cannot change attachments on someone else''s expense'
);
select tests.login('cleo');
select lives_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'),
    pg_temp.files('one.jpg', 'four.webp', 'two.png')),
  'an admin can'
);
select tests.login('outsider');
select throws_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'), pg_temp.files('two.png')),
  '42501', 'not_a_member', 'outsiders cannot'
);
select tests.login_anon();
select throws_ok(
  format($$ select public.set_expense_attachments(%L, '[]') $$, tests.id('e')),
  '42501', null, 'anon cannot call it'
);

-- What it refuses -------------------------------------------------------------------------------

select tests.login('ava');
select throws_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'),
    pg_temp.files('one.jpg', 'two.png', 'three.pdf', 'four.webp', 'five.jpg', 'six.jpg')),
  '22023', 'too_many_attachments', 'five at most'
);
select throws_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'),
    jsonb_build_array(tests.id('other')::text || '/stolen.jpg')),
  '22023', 'invalid_receipt_path', 'only files in the group folder'
);
select throws_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'),
    jsonb_build_array(pg_temp.file('../x.jpg'))),
  '22023', 'invalid_receipt_path', 'no climbing out of the folder'
);
select throws_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'),
    pg_temp.files('one.jpg', 'one.jpg')),
  '22023', 'invalid_receipt_path', 'no file twice'
);
select throws_ok(
  format($$ select public.set_expense_attachments(%L, %L) $$, tests.id('e'),
    pg_temp.files('never-uploaded.jpg')),
  'PT404', 'attachment_not_found', 'only files that were uploaded'
);
select throws_ok(
  format($$ select public.set_expense_attachments(%L, '{"path": "x"}') $$, tests.id('e')),
  '22023', 'invalid_payload', 'a list, not an object'
);
select throws_ok(
  $$ select public.set_expense_attachments('00000000-0000-4000-8000-000000000000', '[]') $$,
  'PT404', 'expense_not_found', 'an expense that does not exist'
);
select public.delete_expense(tests.id('e'));
select throws_ok(
  format($$ select public.set_expense_attachments(%L, '[]') $$, tests.id('e')),
  '23514', 'expense_deleted', 'not on a deleted expense'
);
select public.restore_expense(tests.id('e'));
reset role;
update public.groups set archived_at = now() where id = tests.id('g');
select tests.login('ava');
select throws_ok(
  format($$ select public.set_expense_attachments(%L, '[]') $$, tests.id('e')),
  '23514', 'group_archived', 'not in an archived group'
);
reset role;
update public.groups set archived_at = null where id = tests.id('g');

-- Older clients ---------------------------------------------------------------------------------

select is(pg_temp.paths('e'), 'one.jpg,four.webp,two.png', 'before: three files');
select tests.login('ava');
select public.update_expense_v2(tests.id('e'), jsonb_build_object('receipt_path', pg_temp.file('five.jpg')));
reset role;
select is(pg_temp.paths('e'), 'five.jpg,four.webp,two.png',
  'a new receipt from an older client replaces the first file and keeps the rest');
select tests.login('ava');
select public.update_expense_v2(tests.id('e'), jsonb_build_object('receipt_path', null));
reset role;
select is(pg_temp.paths('e'), 'four.webp,two.png', 'removing it drops only that file');
select is(
  (select receipt_path from public.expenses where id = tests.id('e')),
  pg_temp.file('four.webp'),
  'and the next file becomes the receipt'
);
select tests.login('ava');
select public.update_expense_v2(tests.id('e'), jsonb_build_object('description', 'Dinner out'));
reset role;
select is(pg_temp.paths('e'), 'four.webp,two.png', 'other edits leave attachments alone');
select tests.login('ava');
select is(
  (select count(*)::int from public.set_expense_attachments(tests.id('e'), '[]')),
  0,
  'clearing the list'
);
reset role;
select is((select receipt_path from public.expenses where id = tests.id('e')), null, 'clears the receipt too');

-- Reading -----------------------------------------------------------------------------------------

select tests.login('ava');
select public.set_expense_attachments(tests.id('e'), pg_temp.files('one.jpg', 'two.png'));
select tests.login('ben');
select is((select count(*)::int from public.expense_attachments), 2, 'group members read the list');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'receipts'),
  6,
  'and every file in the group folder'
);
select tests.login('outsider');
select is((select count(*)::int from public.expense_attachments), 0, 'other groups read no rows');
select is(
  (select count(*)::int from storage.objects where bucket_id = 'receipts' and name like tests.id('g')::text || '/%'),
  0,
  'and none of the files'
);
select throws_ok(
  format($$ select pg_temp.put(%L) $$, pg_temp.file('planted.jpg')),
  '42501', null, 'and cannot upload into the group folder'
);
select tests.login_anon();
select throws_ok(
  $$ select count(*) from public.expense_attachments $$,
  '42501', null, 'anon cannot read the list'
);
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0, 'or the files');

-- Writes go through the function only.
select tests.login('ava');
select throws_ok(
  format($$ insert into public.expense_attachments (expense_id, position, group_id, path, content_type)
            values (%L, 4, %L, %L, 'image/jpeg') $$, tests.id('e'), tests.id('g'), pg_temp.file('six.jpg')),
  '42501', null, 'members cannot insert rows directly'
);
select throws_ok(
  format($$ delete from public.expense_attachments where expense_id = %L $$, tests.id('e')),
  '42501', null, 'or delete them'
);

-- Deleting files keeps the bucket's own rules: the uploader or an admin. (The Storage API sets
-- storage.allow_delete_query for its own deletes; plain SQL deletes are refused without it.)
select set_config('storage.allow_delete_query', 'true', true);
select tests.login('ben');
select pg_temp.put(pg_temp.file('bens.jpg'));
delete from storage.objects where bucket_id = 'receipts' and name = pg_temp.file('one.jpg');
reset role;
select is(
  (select count(*)::int from storage.objects where name = pg_temp.file('one.jpg')),
  1,
  'a member cannot delete someone else''s file'
);
select tests.login('ben');
delete from storage.objects where bucket_id = 'receipts' and name = pg_temp.file('bens.jpg');
reset role;
select is(
  (select count(*)::int from storage.objects where name = pg_temp.file('bens.jpg')),
  0,
  'but can delete their own'
);

-- Two-step sign in: a session that owes its code reads no file.
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
values ('00000000-0000-4000-8000-0000000000f2', tests.uid('ben'), 'phone', 'totp', 'verified', now(), now(), 'secret');
select tests.login('ben');
select set_config('request.jwt.claims',
  (current_setting('request.jwt.claims')::jsonb || '{"aal": "aal1"}')::text, true);
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 0,
  'aal1 with a factor reads no attachment file');
select set_config('request.jwt.claims',
  (current_setting('request.jwt.claims')::jsonb || '{"aal": "aal2"}')::text, true);
select is((select count(*)::int from storage.objects where bucket_id = 'receipts'), 6,
  'aal2 reads them again');
reset role;

-- Old receipts became attachments when the table arrived; existing rows match receipt_path.
select is(
  (select count(*)::int from public.expenses e
   where e.receipt_path is distinct from (
     select a.path from public.expense_attachments a where a.expense_id = e.id and a.position = 0)),
  0,
  'every receipt_path is its expense''s first attachment'
);

select is(
  (select count(*)::int from public.expense_attachments a
   where a.path not like a.group_id::text || '/%'),
  0,
  'every attachment lives in its group folder'
);

select has_index('public', 'expense_attachments', 'expense_attachments_group_idx', 'group_id is indexed');

select * from finish();
rollback;
