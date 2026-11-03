# Performance pass

What we measured, what we changed, and what it bought. Everything here was measured on a developer laptop against the local Supabase stack, with two other heavy processes running, so treat single numbers as plus or minus 20 percent. Before and after were always measured the same way, back to back.

## Test data

`supabase/snippets/perf_volume.sql` loads a dedicated, repeatable dataset next to the seed users (it never touches them):

| What          | Count                                                       |
| ------------- | ----------------------------------------------------------- |
| users         | 40 (`perf01`..`perf40@perf.potluck.test`, `potluck-demo`)   |
| groups        | 15, with 3 to 11 members                                    |
| expenses      | 3,000 (200 per group), 17,600 splits, about 5% in EUR       |
| settlements   | 290                                                         |
| events        | 40 (polls, upcoming and finished), 13,600 availability rows |
| activity      | about 3,700 rows                                            |
| notifications | about 16,500 (newest 40 per user unread)                    |

`perf01` is the heavy user: 12 groups and about 2,400 expenses in reach. The seed user `ava` (3 small groups) stands in for a light user in a big database.

## Database

`supabase/snippets/perf_hot_paths.sql` runs `EXPLAIN (ANALYZE, BUFFERS)` on every hot read path as role `authenticated` with the user's JWT claims, so RLS applies exactly as through the API. Second run, warm cache. Times are server execution time.

### Heavy user (perf01)

| Query                                             | Before   | After         |
| ------------------------------------------------- | -------- | ------------- |
| `group_balances` for one group (200 expenses)     | 726 ms   | 13 to 22 ms   |
| `group_balances` across my 12 groups (group list) | 3,661 ms | 67 to 88 ms   |
| `group_balances` by `user_id` (home screen)       | 3,502 ms | 61 to 86 ms   |
| `simplified_debts` (balances tab)                 | 1,159 ms | 10 to 18 ms   |
| expenses tab list with splits                     | 12.2 ms  | 5.7 to 8.4 ms |
| activity feed page                                | 1.9 ms   | 1.8 ms        |
| `my_timeline`                                     | 2.6 ms   | 2.9 ms        |
| `best_slots`, 15 minute slots, 784 candidates     | 11.9 ms  | 11.5 ms       |
| notifications unread count                        | 0.08 ms  | 0.08 ms       |
| notifications page                                | 0.12 ms  | 0.13 ms       |

### Light user in a big database (ava)

| Query                             | Before               | After                |
| --------------------------------- | -------------------- | -------------------- |
| `group_balances` for one group    | 23.7 ms              | 1.8 ms               |
| `group_balances` across my groups | 46.2 ms              | 2.8 ms               |
| `group_balances` by `user_id`     | 36.7 ms              | 1.8 ms               |
| `simplified_debts`                | 26.3 ms              | 2.8 ms               |
| activity feed page                | 1.5 ms (537 buffers) | 0.8 ms (184 buffers) |

### What was slow and why

1. **`private.convert_minor` cost 86 microseconds per call.** It and `private.minor_units` were `language sql` with `set search_path = ''`. A `set` clause stops Postgres from inlining a SQL function, so every call ran as a real function call with a GUC change, and `group_balances` calls it several times per split row. Rewritten with SQL-standard bodies (`return ...`), which are bound when the function is created (so the caller's search path still cannot change them) and which the planner inlines into plain arithmetic. 10,000 calls went from 863 ms to 11 ms, with identical results on 100,000 random inputs. A same-currency shortcut skips the minor-unit lookup (multiplying by `10^0` changes nothing).
2. **The `expense_splits` read policy repeated the group check for every split row.** It already requires the parent expense to be visible, and the expense policy applies inside that subquery, so the extra `my_group_ids()` hash join per row was redundant.
3. **Member read policies could not use indexes.** `group_id in (select private.my_group_ids())` becomes a filter that runs over every row. `group_id = any (array(select private.my_group_ids()))` still runs the helper once per statement but is an index condition, so cross-group reads (activity feed, past events, balances) read only the caller's rows. Same rows, verified per user per table.
4. **`simplified_debts` read `group_balances` twice** (creditors, then debtors). It now reads it once.

All four ship in one additive migration, `20261105210000_query_performance.sql`. RPC signatures and results are unchanged: before applying it we snapshotted every group's balances, every group's simplified debts and, for every user, the row count they can see in 13 tables, then applied the migration in the same repeatable-read transaction and compared. All 1,162 lines matched. `supabase/tests/14_query_performance.test.sql` adds 17 pgTAP checks (conversions, inlining, visibility, balances, debts); the full suite (469 tests) passes.

No new indexes were needed: every policy column and every filter on the hot paths already had one.

### Advisors

`npx supabase db advisors --local --level info`:

- Before: 0 errors, 0 warnings, 7 info (unused foreign key indexes; they serve cascades, kept).
- After: 0 errors, 2 warnings, the same 7 info. The warnings are `function_search_path_mutable` on `private.minor_units` and `private.convert_minor`. That is the intended trade (see point 1); `docs/development.md` notes the exception.

## Client data access

Measured by loading each screen cold as perf01 in headless Chromium against `vite preview` (no throttling), counting Supabase requests and when the last one finished. Both columns run against the optimized database, so the difference is the client alone.

| Screen              | Requests before | Requests after | Last response before | Last response after |
| ------------------- | --------------- | -------------- | -------------------- | ------------------- |
| `/home`             | 6               | 5              | 312 ms               | 241 ms              |
| `/groups`           | 3               | 3              | 335 ms               | 214 ms              |
| group, expenses tab | 10              | 8              | 288 ms               | 206 ms              |
| group, balances tab | 9               | 9              | 290 ms               | 212 ms              |
| `/activity`         | 5               | 3              | 207 ms               | 159 ms              |
| `/plans`            | 5               | 4              | 213 ms               | 138 ms              |
| event page          | 9               | 8              | 283 ms               | 243 ms              |
| `/notifications`    | 5               | 5              | 279 ms               | 233 ms              |

What changed:

- **One profile query.** The Me screen, the plans screens and the money screens each fetched the viewer's profile with their own select and cache key (and the money one first called `/auth/v1/user`, a round trip before the real request). They now share one cache entry; edits on Me show up everywhere at once.
- **No group, then balances waterfall.** `fetchMyGroups` and `fetchGroup` waited for the group rows before asking for balances. Balances do not need the ids (RLS already scopes the view), so both go out together.
- **Route loaders.** Every main screen's route starts its queries in a loader, while its code is still downloading, and on hover or focus of a link (the router already preloads on intent). Loaders never block navigation; screens keep their skeletons. On `/home` requests now start about 100 ms earlier; on the event page the availability, best times and requests panels start right after the event row instead of after the first render.
- **Batched realtime invalidation.** One expense save emits several change events; each used to cancel and restart the same refetches. Bursts within 300 ms now invalidate once (groups list, friends, activity feed, a group's money screens).
- **Fresher totals after writes.** Saving, deleting or restoring an expense, and saving a payment, now also invalidate the group list and the home balances, which otherwise showed the old numbers for up to 30 seconds after you came back.

Not changed, on purpose: list queries stay at the default 30 second `staleTime` (realtime keeps them fresh), and the full expense list stays in one request because PostgREST pages it in thousands and a 200-expense group answers in under 10 ms.

## Bundle

Initial JavaScript per route, gzip, from the static import graph of a production build (entry plus the route's split chunks and everything they import).

| Route               | Before   | After                                            |
| ------------------- | -------- | ------------------------------------------------ |
| entry (every page)  | 213.0 kB | 141.4 kB                                         |
| `/` landing         | 283.9 kB | 158.1 kB (page itself is prerendered, see below) |
| `/sign-in`          | 237.2 kB | 218.4 kB                                         |
| `/home`             | 320.7 kB | 304.5 kB                                         |
| `/groups`           | 317.8 kB | 300.3 kB                                         |
| group, expenses tab | 331.7 kB | 313.9 kB                                         |
| event page          | 332.4 kB | 315.9 kB                                         |
| `/activity`         | 307.3 kB | 290.8 kB                                         |

What changed:

- **zod left the entry** (about 25 kB gzip). Route files used it for one-line search param checks, and `@potluck/core` was not marked side effect free, so its schemas came along with anything that imported the package. Routes now use tiny validators (`src/lib/search.ts`), and core, i18n and api declare `"sideEffects": false`.
- **The Supabase client is lazy** (about 52 kB gzip). A signed-out visit to `/` with no session in storage and no auth result in the URL never downloads it; everyone else gets it preloaded in parallel with the entry.
- **The landing demo is lazy.** The animated receipt and planner pull in the motion library; the headline, copy and buttons do not wait for it.
- **Fonts.** Bricolage shipped with its width axis, which the app never uses. Dropping it takes the latin face from 131.5 kB to 76.9 kB (latin-ext 53.6 to 30.7 kB, vietnamese 22.0 to 13.0 kB). Rendering is identical.
- **Route chunk preloads.** A small build plugin (`apps/web/route-preloads.ts`) writes an inline script that adds `modulepreload` links for what the current URL needs (the landing demo, or the client, app shell and home screen when a session is stored) plus a preconnect to the API, so those chunks no longer wait for the entry to run.
- **PWA precache.** Still every JS and CSS file, plus the three latin font files so an installed app renders offline in its own type; the design kit route (not linked from the app) is excluded. The service worker registration script is deferred instead of render blocking.

Motion, date-fns-tz and image handling were already split per screen by the router; confetti was already its own chunk.

## Lighthouse

Lighthouse 12.8, mobile preset (simulated Slow 4G, 4x CPU), headless Chromium, against `vite preview`. Median of three runs. `/home` was measured signed in as perf01 by seeding the session in a fresh profile.

| Page    | Metric         | Before   | After   |
| ------- | -------------- | -------- | ------- |
| `/`     | Performance    | 65       | 82      |
|         | Accessibility  | 98       | 100     |
|         | Best Practices | 100      | 100     |
|         | SEO            | 91       | 100     |
|         | LCP            | 4.3 s    | 3.6 s   |
|         | TBT            | 529 ms   | 179 ms  |
|         | CLS            | 0        | 0       |
|         | Transfer       | 481 KiB  | 358 KiB |
| `/home` | Performance    | 37       | 64      |
|         | Accessibility  | 100      | 100     |
|         | Best Practices | 100      | 100     |
|         | SEO            | 91       | 100     |
|         | LCP            | 6.2 s    | 5.4 s   |
|         | TBT            | 1,043 ms | 361 ms  |
|         | CLS            | 0.157    | 0.004   |
|         | Transfer       | 532 KiB  | 471 KiB |

Lighthouse's simulated FCP barely moves on the landing page (3.4 s to 3.1 s) because the simulation replays the unthrottled trace, where the scripts happen to run before the first paint. Measured for real with the same throttling applied in the browser (Playwright, 1.6 Mbps, 150 ms latency, 4x CPU):

| Page    | Metric | Before | After |
| ------- | ------ | ------ | ----- |
| `/`     | LCP    | 3.3 s  | 1.0 s |
| `/home` | LCP    | 4.5 s  | 4.3 s |
| `/home` | CLS    | 0.155  | 0.001 |

Fixes behind these numbers:

- **Prerendered landing page.** The build renders the landing page once (`apps/web/prerender-landing.ts`, `src/prerender.tsx`) and ships it inside `#root`, with the design token stylesheet inlined (it used to be injected by JavaScript, so any first paint before the app ran was laid out without the variables). For a signed-out visit to `/` the page stays exactly as delivered and only the demo is mounted, so the first paint is the final one. Any other URL, a stored session, or an auth result in the URL marks the document `data-boot="app"`, hides the prerendered page and starts the app as before. Its links are plain links into the app.
- **Home layout shift.** On phones the "Needs you" row (known once the timeline is in) and the real balance card (taller than its skeleton) pushed down everything below them. That content now waits, laid out but invisible, until the timeline and balances have both answered (with data or an error) or 1.5 s has passed, whichever comes first; on wide screens nothing changes.
- **Home greeting** (the largest text, so the LCP element) uses the name from the session until the profile arrives, instead of a skeleton.
- **Meta tags.** Added Open Graph and Twitter card tags (title, description, the 512 px icon as image) and a `robots.txt` (previously the SPA fallback answered `/robots.txt` with HTML, which failed the SEO audit). Description and theme color were already there; the theme color follows the app theme at runtime.
- **Heading order.** Landing feature titles were `h3` under the `h1`; they are `h2` now.

## Perceived speed

- Optimistic already: deleting an expense (with undo), marking notifications read, RSVPs, availability painting, comments, recurring toggles, group settings, invites and profile edits.
- Expense and payment saves are not optimistic; they wait for the RPC (which validates splits and converts currency) and then refresh. With the faster balances the refresh lands in well under 100 ms locally.
- Skeletons exist for every list screen. The home screen no longer shifts (above). The activity, groups, group and event screens measured a CLS of 0 under the same throttling.

## Left for later

- `/home` still runs about 300 kB of gzip JavaScript before its first meaningful paint. The largest remaining pieces are react-dom (about 60 kB), the motion library used by the screen transitions, and the router. Moving the shell's quick-add sheet and other closed-by-default dialogs behind `lazy()`, and the motion components to `LazyMotion`, are the next steps.
- On the landing page the entry bundle (router, query client, i18n) still downloads although only the demo runs. Splitting `main.tsx` so the landing path loads only React would take it to about 70 kB.
- Two accessibility notices from Lighthouse on `/home` are copy, not speed: balance rows and the Me tab have an `aria-label` that does not contain their visible text (`label-content-name-mismatch`).
- Group balances are computed on every read. They are fast now (about 70 ms for a 12-group, 2,400-expense user), but a user with tens of thousands of expenses would want a maintained balance table.
