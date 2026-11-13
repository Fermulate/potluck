-- Two-step sign in, continued (ADR 13):
--
-- 1. Storage: a session that still owes its two-step code reads, uploads, replaces and deletes
--    nothing in any bucket. One restrictive policy on storage.objects sits on top of every
--    bucket's own policies (avatars, group-covers, receipts, and any bucket added later).
-- 2. Recovery attempts: the mfa-recover edge function records each try and stops after five in
--    fifteen minutes per account.
-- 3. Turning two-step sign in off clears the recovery codes: clear_mfa_recovery_codes().

-- Storage -----------------------------------------------------------------------------------

create policy "two-step sign in done"
on storage.objects
as restrictive
for all
to authenticated
using ((select private.mfa_satisfied()))
with check ((select private.mfa_satisfied()));

-- Recovery attempts -------------------------------------------------------------------------

create table private.mfa_recover_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now()
);

create index mfa_recover_attempts_user_time_idx
  on private.mfa_recover_attempts (user_id, attempted_at);

comment on table private.mfa_recover_attempts is
  'One row per recovery code tried, kept a day, for the five per fifteen minutes limit.';

revoke all on table private.mfa_recover_attempts from public, anon, authenticated;

-- Service role only (mfa-recover): may `target` try a recovery code now? Records the try when
-- it may. Tries are serialized per account, so parallel requests cannot slip past the limit.
create or replace function public.record_mfa_recover_attempt(target uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  recent int;
begin
  perform pg_advisory_xact_lock(hashtextextended('mfa_recover:' || target::text, 0));
  delete from private.mfa_recover_attempts a
  where a.user_id = target and a.attempted_at < now() - interval '1 day';
  select count(*) into recent from private.mfa_recover_attempts a
  where a.user_id = target and a.attempted_at > now() - interval '15 minutes';
  if recent >= 5 then
    return false;
  end if;
  insert into private.mfa_recover_attempts (user_id) values (target);
  return true;
end;
$$;

revoke execute on function public.record_mfa_recover_attempt(uuid)
  from public, anon, authenticated;
grant execute on function public.record_mfa_recover_attempt(uuid) to service_role;

-- Clearing codes ----------------------------------------------------------------------------

-- Drops the caller's recovery codes once no verified factor is left (after turning two-step
-- sign in off). While one is on, it changes nothing. Returns how many codes went.
create or replace function public.clear_mfa_recovery_codes() returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := private.require_user();
  removed int;
begin
  if exists (
    select 1 from auth.mfa_factors f where f.user_id = uid and f.status = 'verified'
  ) then
    return 0;
  end if;
  delete from private.mfa_recovery_codes r where r.user_id = uid;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function public.clear_mfa_recovery_codes() from public, anon;
grant execute on function public.clear_mfa_recovery_codes() to authenticated, service_role;
