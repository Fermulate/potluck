-- Smoke test so `supabase test db` has something to run until real schema tests exist.
begin;
create extension if not exists pgtap with schema extensions;

select plan(2);

select has_schema('public', 'public schema exists');
select has_schema('auth', 'auth schema exists');

select * from finish();
rollback;
