# 16. Guest availability links without accounts

- Status: accepted
- Date: 2026-11-12

## Context

Adding times to a plan needed an account and a seat in the group. For a friend of a friend who only has to say when they are free, that is too much, so organizers fell back to group chats. We wanted people without an account to answer one plan through a shareable link, without opening the rest of the group to the internet and without turning guests into half users that every RLS policy has to reason about.

## Decision

- Guests are rows, not users. `event_guest_links` holds a link per plan (random 16 character code, an expiry of 24 hours, 7 days or 30 days, a cap of 1 to 100 guests, `revoked_at`). `event_guests` holds one row per guest (name, link) and `event_guest_availability` their slots, the same shape as `availability`. No auth user, no anonymous sign in, no membership.
- A guest proves they wrote an answer with a token, not a session. The first save returns a 24 byte random token, the browser keeps it in local storage per link, and the table keeps only its sha256. Without the token nobody can edit that answer; with it, only that one answer on that one link.
- Guests reach the database through exactly two `anon` callable RPCs: `guest_link_preview(code, token)` and `set_guest_availability(code, name, token, slots)`. Every call checks the code, revocation, expiry, the group's archive state, that the plan is still polling, and for a new guest the cap and a rate limit. Anon has no table grants on the guest tables.
- What a guest sees is fixed by the preview's shape: the plan title, emojis, the link creator's first name, the grid, and per slot counts of yes and maybe across members and guests. Never names, ids, emails, balances or the group name.
- Members read the three tables directly through RLS (the token hash and rate limit columns are not granted), and writes go through `create_guest_link`, `revoke_guest_link` and `remove_guest_answer`. Guest slots are published to Realtime so the heatmap warms up live.
- Guests count like members: `best_slots` and `rankSlots` in `packages/core` treat each guest as one more person, toward `min_attendees` too, and the heatmap and best times show them with a Guest tag.

## Consequences

- No change to auth, sessions or any existing policy; a guest can never become a member by accident, and closing a link closes the door everywhere at once.
- Two more definer functions open to the internet, each a place where a missing check would leak. pgTAP (`22_guest_links.test.sql`) covers expiry, revocation, the cap, anon permissions, ranking with guests and what the preview leaves out; `01_schema.test.sql` pins the anon allowlist.
- Limits are per link and per guest in the database, not per IP. Someone with a link can fill it up to its cap; organizers remove answers and turn links off. A removed answer keeps its row (`removed_at`) so its token is refused from then on, while its seat opens up. The preview is a read and has no limit of its own.
- A guest who clears their browser storage cannot edit their answer anymore. Answering again makes a new guest if the link has room; the organizer can remove the old one. The same goes for a removed guest who comes back without the token.
- Names are cleaned the same way on both sides (`private.clean_guest_name`, `cleanGuestName`): invisible and zero width characters go, whitespace collapses, so a name cannot be blank or impersonate by hiding characters.
- Once a plan has a time, its links show that time to guests (to anyone while the link is open, to guests who answered after it expires), and the plan keeps the list of who answered as a guest.
- `best_slots.missing` can now hold guest ids. Clients map them through the plan's guest list; an older client simply does not find them among members.
- Guest answers outlive their link: turning a link off stops new answers and edits but keeps what guests already said.
