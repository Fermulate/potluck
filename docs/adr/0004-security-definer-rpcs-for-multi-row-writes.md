# 4. Security definer RPCs for multi-row writes

- Status: accepted
- Date: 2026-11-05

## Context

Some writes touch several rows that must change together. An expense needs its splits, and the splits must sum to the amount. Accepting an invite adds a member and bumps the invite's use count. A role transfer demotes one owner and promotes another. RLS policies judge one row at a time and cannot say "this insert is fine only if those three other rows also land". Letting clients write these tables directly would also mean every client re-implements the validation.

## Decision

Tables that need multi-row consistency get no insert or update policy at all. Writes go through `public` functions that are `security definer`:

- Each one starts with `private.require_user()` (signed in, account not closed) and usually `private.require_member(group_id)`, then checks the role rules itself.
- Each one sets `search_path = ''` and schema-qualifies every name, so a caller cannot shadow a table or function.
- Errors use one shape: `message` is a stable snake_case code, `detail` is readable English, `errcode` is one of `42501`, `P0002`, `22023` or `23514`. Clients translate the code, never the English.
- Invariants that must hold whatever path wrote the row are deferred constraint triggers checked at commit: one owner per group, splits sum to the amount.
- `execute` is revoked from `public` and `anon` and granted to `authenticated` (and `service_role`). `invite_preview` is the one exception callable by `anon`.

Single-row writes that RLS can judge stay direct: profile fields, group settings, event details, RSVPs, comments, notifications, push tokens, blocks.

## Consequences

- Atomic: an RPC runs in one transaction, so a failed check leaves nothing half-written.
- The same rules apply to every client, including ones that do not exist yet.
- Definer functions bypass RLS, so every one of them is a place where a missing check is a data leak. pgTAP tests cover the rejections as well as the happy path.
- RPC signatures are an API contract with installed apps. Changing one in place can break an old native build, see [ADR 8](0008-additive-migrations-and-versioned-rpcs.md).
