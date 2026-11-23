# 22. Quick polls without accounts

- Status: accepted
- Date: 2026-11-22

## Context

Finding a time with people who are not in a group (a one off dinner, a call with strangers) meant making a group and a plan first. Guest links ([ADR 16](0016-guest-availability-links.md)) let outsiders answer, but someone still needs an account, a group and a plan. Issue 50 asks for a poll anyone can make from the landing page, share as a link, and answer with no account at all, where everyone sees everyone's times.

## Decision

- Quick polls are their own tables, with no group, event or auth user: `quick_polls` (code, grid, expiry, settings), `quick_poll_answers` (one per browser, numbered by seat, a name only when the poll asks for one) and `quick_poll_slots` (the same shape as `availability`). Nothing in groups or plans changes, and no existing policy has to learn about them.
- Clients never touch the tables. RLS is on with no policies and `anon` and `authenticated` hold no grants. Five `security definer` RPCs are the whole surface, callable by `anon` and `authenticated`: `create_quick_poll`, `quick_poll_preview`, `set_quick_poll_availability`, `close_quick_poll` and `delete_quick_poll`.
- Tokens, not sessions, as for guests. Creating a poll returns a 24 byte creator token; the database keeps its sha256. The same token is the creator's answer token, so the creator answers like anyone else and takes a seat. Every other browser makes its own answer token (a random UUID from Web Crypto) and keeps it before its first save goes out, then sends it with every save: a token the poll does not know makes a new answer under it, a known one edits that answer, and no token (or one outside 16 to 200 characters) is refused with `invalid_quick_poll_token`. So a first save resent after a lost reply, or after a reload, edits the answer it made instead of taking a second seat. Only the creator token closes or deletes a poll.
- One owner per rule. `private.quick_poll_status` decides `expired`, `closed`, `full` or `open` for every RPC. The slot grid check moved out of `private.event_slots` into `private.grid_slots`, which both plans and quick polls call. The limits (2 to 15 people, 10 by default, 1 to 14 days, titles up to 80 characters, `24h` or `7d`) live in `packages/core` and the SQL checks together.
- Polls are small and short lived: at most 15 people, and they last 24 hours or 7 days. The hourly `purge-quick-polls` job deletes expired polls with their answers.
- The app is a static site that talks straight to Supabase, so the create rate limit lives in the database: 5 polls an hour per client and 200 an hour in all, serialized by an advisory lock. The client is the sha256 of the first `x-forwarded-for` entry PostgREST hands over in `request.headers`. Those hashes go in `private.quick_poll_creates`, kept an hour, not on the poll, so deleting a poll does not give quota back and nothing about the client outlives the hour.

## Consequences

- Anyone with the code sees every answer's name and times until the poll expires; that is the feature. Creators choose whether to ask for names; without them answers show as seat numbers.
- Five more definer functions open to the internet. pgTAP (`36_quick_polls.test.sql`) covers table access, every create check, names on and off, browser made answer tokens and a resent first save, seats and the cap, the creator token, each status, close, delete, the purge and both rate limits; `01_schema.test.sql` pins the anon allowlist and the cron job.
- The per client limit is only as good as `x-forwarded-for`. A client can send its own header, and its value then comes first, so the per client limit slows honest mistakes and casual scripts, not a determined abuser. The global 200 an hour is the backstop; raising it, or keying on a header the platform sets itself, is a migration.
- A client picks its own answer token. That is fine: the token only ever proves "this browser wrote this answer", the server keeps only its sha256, and it opens nothing else (not the poll's controls, not anyone else's answer). A browser that picks a weak token only risks its own answer being edited by someone who guesses it.
- A browser that loses its token cannot edit its answer, and a creator who loses theirs cannot close or delete the poll; it still expires within 7 days.
- Answers are never removed one by one, so seats are stable and never reused; the creator has no way to remove a stranger's answer short of deleting the poll.
