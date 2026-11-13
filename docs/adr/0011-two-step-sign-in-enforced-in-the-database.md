# 11. Two-step sign in is enforced in the database

- Status: accepted
- Date: 2026-11-13

## Context

People can add an authenticator app to their account (Supabase Auth TOTP). Supabase still issues a token after the first step (password, magic link or OAuth), marked `aal1`; only a verified code upgrades it to `aal2`. Supabase leaves it to the project to decide what an `aal1` token may do. Our backend is the database ([ADR 2](0002-supabase-backend-with-rls-authorization.md)), and most writes go through `security definer` RPCs that skip RLS ([ADR 4](0004-security-definer-rpcs-for-multi-row-writes.md)). A check that only lives in the app would protect nothing: anyone with a stolen password could call the API directly with the `aal1` token.

Options considered:

- A restrictive RLS policy on every table, as Supabase's guide suggests. It misses every definer RPC, and every new table has to remember it.
- A check in `private.require_user()`. It misses direct table reads and every function that does not call it.
- A PostgREST pre-request function. One place, runs before every REST and RPC call, whatever the table or function.

## Decision

- `private.check_request()` is PostgREST's `db_pre_request` (set on the `authenticator` role in a migration). It raises `mfa_required` (42501) when `private.mfa_satisfied()` is false: the caller has a verified factor and the token says `aal1`. Callers without a factor, `anon` and the service role pass untouched.
- Realtime does not pass through PostgREST, so every table in the `supabase_realtime` publication gets a restrictive `select` policy on `private.mfa_satisfied()`. A table added to the publication needs the same policy.
- Recovery codes are ours, not Supabase's: ten random codes, stored as SHA-256 in `private.mfa_recovery_codes`, created by `create_mfa_recovery_codes()` (aal2 only). The `mfa-recover` edge function checks one with the service role, then removes every factor with the Auth admin API and forgets the codes. Recovery turns two-step sign in off rather than signing in "around" it, so the person sets it up again on their new phone.
- The app routes an `aal1` session of such an account to `/two-factor` before any signed-in screen loads. That is only for the person's sake; the database is what refuses.

## Consequences

- Every API request does one extra indexed lookup in `auth.mfa_factors` (skipped for `aal2` tokens and for `anon`).
- Storage is not covered: an `aal1` session can still upload or replace its own avatar. Edge functions that take a user's JWT must use that JWT for their database calls (as `delete-account` does) so the check applies.
- Another pre-request rule later has to be added to `private.check_request()`; PostgREST runs only one function.
- Hosted projects need TOTP turned on in Auth (`[auth.mfa.totp]`, also on locally) and the pre-request setting applied by the migration; `supabase db push` does that.
- A lost phone without the recovery codes still needs a person: an operator removes the factor in the Supabase dashboard after checking who is asking.
