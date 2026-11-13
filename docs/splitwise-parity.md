# Splitwise parity

What Splitwise does today (free and Pro), what Potluck already has, and the work left, cut into batches that can be built side by side.

Potluck is free for everyone, so every Splitwise Pro feature is in scope as a free feature. Things that only exist to sell a tier (ads, daily expense limits, the paywall, Pro trials) are out. So are features that need a licensed payment processor or bank aggregator (Splitwise Pay, the Splitwise Card, bank transaction import through Plaid or Tink).

Status words used below:

- **exists**: shipped and roughly equivalent to Splitwise.
- **partial**: some of it ships; the missing part is named.
- **missing**: not built.
- **skip**: deliberately out of scope, with the reason.

Snapshot taken 2026-11-12 against `main` at `711274e`. Splitwise tiers come from splitwise.com/pro, the help center at kb.splitwise.com (the old feedback.splitwise.com links redirect there), the App Store listing and the Splitwise blog. Where the help center and the marketing pages disagree, the help center wins; rows marked "unverified" could not be confirmed on a Splitwise page.

What Splitwise Free holds back today: 4 new expenses per day, ads, and the Pro features (search, charts, whole-group currency conversion, receipt scanning, default splits, JSON backup, card transaction import, 10 GB receipt storage). Since October 2026, itemizing restaurant and bar receipts is free in the US and UK.

## Parity matrix

### Expense entry

| Splitwise feature                                                       | Tier                                                             | Potluck | Notes                                                                                                                                                 |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Split equally                                                           | Free                                                             | exists  | `equal` split type                                                                                                                                    |
| Split by exact amounts                                                  | Free                                                             | exists  | `exact`                                                                                                                                               |
| Split by percentages                                                    | Free                                                             | exists  | `percent`, must total 100                                                                                                                             |
| Split by shares                                                         | Free                                                             | exists  | `shares`                                                                                                                                              |
| Split by adjustment (change one person's share, the rest split equally) | Free                                                             | exists  | `adjustment` split type: +/- per person, the rest equal; core `splitAdjustment`, SQL `compute_split_rows` (Batch 1)                                   |
| Refund or reimbursement (money coming back to the group)                | Free (web)                                                       | exists  | `expenses.is_refund`: whoever got the money owes the split their part; signs flip in balances, CSV shows it negative (Batch 1)                        |
| "You owe the full amount" / "they owe the full amount" shortcuts        | Free                                                             | exists  | four one-tap options on the split when two people share a group (Batch 1)                                                                             |
| Multiple payers ("paid by multiple people")                             | Free                                                             | exists  | `expense_payers`; "Paid by" sheet with one or several people; balances, rows, detail and CSV credit each payer (Batch 1, ADR 12)                      |
| Itemize a bill by hand (line items, tax, tip, discount)                 | Free (unverified)                                                | exists  | items, tax, tip and discount stored in `expense_items` and on the expense; editing reopens them; the server works out shares from the items (Batch 1) |
| Receipt scanning (photo fills total, date, items)                       | Pro; free for restaurant bills in US and UK since Oct 2026       | missing | no OCR; receipts are attachments only                                                                                                                 |
| Diners join a restaurant bill by QR code without an account             | Free (US, UK, Oct 2026)                                          | missing | depends on placeholder people (Batch 4) and scanning (Batch 10)                                                                                       |
| Attach a receipt or photo                                               | Free (Pro adds 10 GB high-res storage)                           | partial | one image or PDF per expense, 10 MB; no multiple attachments, no photos on comments or payments                                                       |
| Notes on an expense                                                     | Free                                                             | exists  | `expenses.notes`, 2000 chars                                                                                                                          |
| Categories with subcategories                                           | Free                                                             | partial | 12 flat categories; Splitwise has about 40 subcategories under Entertainment, Food and drink, Home, Life, Transportation, Utilities, Uncategorized    |
| Auto-categorize from the description                                    | unverified (users ask for it)                                    | missing | no suggestion                                                                                                                                         |
| Expense date (past or future)                                           | Free                                                             | exists  | `spent_at` date picker                                                                                                                                |
| Expense in another currency                                             | Free                                                             | exists  | per-expense currency, FX snapshot into the group currency                                                                                             |
| New expense defaults to the last currency used in the group             | Free                                                             | exists  | starts in the currency of the last expense you added in that group (Batch 1)                                                                          |
| Currency conversion of balances                                         | Pro (converts a whole group, past expenses too, at market rates) | exists  | Potluck converts every expense into the group currency at its date's ECB rate, so balances are always in one currency                                 |
| Save a default split for a group                                        | Pro                                                              | exists  | `groups.default_split` via `set_default_split`; any member, from the expense form or group settings; new expenses start from it (Batch 1)             |
| Add an expense from anywhere (quick add)                                | Free                                                             | exists  | quick-add sheet with group picker                                                                                                                     |
| Link an expense to an event                                             | n/a                                                              | exists  | Potluck extra                                                                                                                                         |
| Expense edit history                                                    | Free                                                             | exists  | expense page lists who added, edited, deleted and restored it, and every field each edit changed (old and new values, payers and split too) (Batch 1) |
| Offline expense entry with sync                                         | Free                                                             | partial | the installed PWA loads offline; writes need a connection                                                                                             |
| Comments on an expense                                                  | Free                                                             | exists  | expense comments with realtime                                                                                                                        |

### Groups

| Splitwise feature                                                                 | Tier                                       | Potluck | Notes                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create a group, name, icon                                                        | Free                                       | exists  | name, emoji, color                                                                                                                                                                          |
| Group type (home, trip, couple, apartment, house, other)                          | Free                                       | missing | no `groups.type`; in Splitwise it is mostly a label                                                                                                                                         |
| Group cover photo                                                                 | Free (unverified)                          | partial | `group-covers` bucket and `groups.cover_path` exist; there is no upload UI and no screen shows it                                                                                           |
| Simplify group debts toggle                                                       | Free                                       | exists  | `simplify_debts` setting, balances tab follows it                                                                                                                                           |
| Group whiteboard (shared notes)                                                   | Free, web (not in the current help center) | missing | no notes field on groups                                                                                                                                                                    |
| Invite link                                                                       | Free                                       | exists  | links with role, max uses, expiry, email binding, revoke                                                                                                                                    |
| Add people by email, phone or just a name before they sign up                     | Free                                       | missing | you cannot split with someone until they join; Splitwise adds them as placeholders, sends one invite and one reminder, and they claim the history later                                     |
| Roles and permissions                                                             | not in Splitwise (anyone edits anything)   | exists  | owner, admin, member; members edit only their own expenses                                                                                                                                  |
| Leave group only when settled                                                     | Free                                       | exists  | `member_has_balance`                                                                                                                                                                        |
| Remove a member only when settled                                                 | Free                                       | exists  |                                                                                                                                                                                             |
| Delete group                                                                      | Free                                       | exists  | refused while balances are open                                                                                                                                                             |
| Undelete a group                                                                  | Free                                       | missing | deleting is final                                                                                                                                                                           |
| Archive a settled group                                                           | not in Splitwise                           | exists  | Potluck extra; archived groups are read-only                                                                                                                                                |
| Totals screen (group spend, you paid, your share, payments, by month or all time) | Free                                       | exists  | Totals tab per group and a Spending screen across groups: group spend, you paid, your share, payments made and received, change in balance, by month, year or all time (`spending_summary`) |
| Per-group activity                                                                | Free                                       | exists  | the group's Activity link opens the feed filtered to it                                                                                                                                     |

### Friends and 1:1

| Splitwise feature                                           | Tier | Potluck | Notes                                                                                                       |
| ----------------------------------------------------------- | ---- | ------- | ----------------------------------------------------------------------------------------------------------- |
| Friends list with net balance per friend                    | Free | exists  | friends page, nets across shared groups                                                                     |
| Non-group (1:1) expenses                                    | Free | exists  | hidden direct group per pair                                                                                |
| Add a friend by email, phone or contacts                    | Free | partial | "Add a friend" only offers a group invite; no friend invite by email, no friend-only link                   |
| Friend page: every shared expense across groups and 1:1     | Free | missing | the friend row opens the 1:1 tab only                                                                       |
| Settle up with a friend across all shared groups            | Free | exists  | Friends list totals each direction; Settle up picks groups and amounts, one payment per group (ADR 15)      |
| Remove a friend                                             | Free | partial | clients may delete `friendships` rows; no button does it                                                    |
| Block a person (they are not told, their activity is muted) | Free | partial | `blocks` table and server checks exist; no UI to block or to list and unblock (strings exist in `en/me.ts`) |
| Report a person or group                                    | Free | partial | `reports` table exists; no UI                                                                               |

### Balances and settle up

| Splitwise feature                                          | Tier                          | Potluck | Notes                                                                                                                                  |
| ---------------------------------------------------------- | ----------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Overall "you owe / you are owed"                           | Free (per currency)           | partial | home hero sums one currency; groups in other currencies are listed but not converted into a total (Splitwise shows "$12.45 and £8.72") |
| Per-group balances and who owes whom                       | Free                          | exists  | balances tab, simplified or every debt                                                                                                 |
| Record a cash payment                                      | Free                          | exists  | either direction, between two others for owners and admins, any day (that day's rate)                                                  |
| Edit a payment                                             | Free                          | exists  | payment page and the list menu; people, amount, currency, day, note                                                                    |
| Delete and restore a payment                               | Free                          | exists  | Undo in the toast, Restore on the payment page and in the group's Recently deleted                                                     |
| Comments on a payment                                      | Free                          | exists  | on the payment page                                                                                                                    |
| Pay through Venmo / PayPal (send only)                     | Free (US)                     | exists  | deep links from saved handles, no processor (ADR 15)                                                                                   |
| Paytm                                                      | Free (India)                  | exists  | UPI deep link, offered for rupees                                                                                                      |
| Splitwise Pay wallet, Pay by Bank (Tink), payment requests | Free (US; UK and parts of EU) | skip    | needs a licensed payment processor                                                                                                     |
| Balance reminder ("Remind...")                             | Free                          | exists  | Remind on a debt owed to you, with an optional note: inbox, push and email, once a day per pair                                        |
| Settle all balances at once                                | Free                          | exists  | "Settle everything" on the Balances tab                                                                                                |

### Activity, comments, notifications

| Splitwise feature                                                                             | Tier       | Potluck | Notes                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Activity feed                                                                                 | Free       | exists  | cross-group feed with load more                                                                                                                                                                                                                              |
| Activity filtered to one group or friend                                                      | Free       | exists  | by group, and with a friend: every expense both of you are in, payments between you, and your 1:1 tab (`friend_activity`)                                                                                                                                    |
| Restore a deleted expense from activity (anyone on the expense)                               | Free       | exists  | deleted expense page has Restore (creator, payer or admin); delete toast has Undo                                                                                                                                                                            |
| Push notifications                                                                            | Free       | exists  | web push per device, plus per-type settings for the whole account                                                                                                                                                                                            |
| Per-type notification preferences                                                             | Free       | exists  | Me page, "What to hear about": push and email per category; the inbox always gets everything ([ADR 11](adr/0011-notification-prefs-and-email.md))                                                                                                            |
| Email notifications (held 60 seconds so quick fixes do not email, never for your own changes) | Free       | partial | built (outbox, 60 second hold, one email per expense, batched sends with retries, one-click unsubscribe); off until a sender is configured (launch checklist item 3)                                                                                         |
| Weekly or monthly summary email                                                               | unverified | partial | monthly summary on the 1st: inbox card now, email (with its own off switch) once email is on                                                                                                                                                                 |
| Notify on deleted expense, added to group, payment deleted                                    | Free       | partial | `expense.deleted` and `expense.restored` ship. Payment edits, deletes and restores notify the other people in the payment, under the Payments setting. "You were added" (`member.added`) is groundwork that starts firing with placeholder members (Batch 4) |
| In-app inbox with unread badge                                                                | Free       | exists  |                                                                                                                                                                                                                                                              |

### Search, charts, export, import

| Splitwise feature                                  | Tier                               | Potluck | Notes                                                                                                                                                                        |
| -------------------------------------------------- | ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search expenses                                    | Pro                                | exists  | search across every group from the app bar (or `/`): descriptions, notes, comments, people, amounts, payments too (`search_money`)                                           |
| Filters (date range, person, category)             | Free (month filter on Totals only) | exists  | date range, person, category on a group's list with a matching total; search adds group and type                                                                             |
| Charts and graphs (spending by category over time) | Pro                                | exists  | by month and by category, per group and across groups, either all converted into your currency at each expense's date (like Pro) or one currency at a time, with table views |
| Export a group or friendship to a spreadsheet      | Free                               | partial | per-group CSV exists; no per-friend export                                                                                                                                   |
| Full JSON backup                                   | Pro (web)                          | missing | no account-wide export                                                                                                                                                       |
| Import from CSV or from Splitwise                  | not in Splitwise                   | missing | high value for people switching from Splitwise                                                                                                                               |

### Recurring

| Splitwise feature                                              | Tier | Potluck | Notes                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repeat an expense                                              | Free | exists  | weekly, every 2 weeks, monthly, yearly; cron materializes due rows                                                                                                                                                                 |
| Every 2 weeks (fortnightly)                                    | Free | exists  | `recurrence` gains `biweekly`; core `nextOccurrence` and `private.recurring_step` share the cases (Batch 8)                                                                                                                        |
| Edit a repeating expense's amount and split                    | Free | exists  | the expense form opens the template (several payers, adjustments, items); only copies still to come change (Batch 8, ADR 14)                                                                                                       |
| Make an existing expense repeat                                | Free | exists  | "Make it repeat" on the expense page; the first copy is a period after its date, missed periods are not charged (Batch 8)                                                                                                          |
| Skip one occurrence ("just this once") vs stop all future ones | Free | exists  | Skip next, Pause and Stop repeating, from the group's list, the template and the expense page (Batch 8)                                                                                                                            |
| Email reminder before a repeating expense posts                | Free | exists  | `recurring.upcoming` at 9 in the morning, each person's own time, the day before, naming the date and the deadline, with their share; push and email follow the Reminders setting, and it can be turned off per template (Batch 8) |

### Account and settings

| Splitwise feature                                                 | Tier                                             | Potluck | Notes                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------ | ------- | ---------------------------------------------------------------------------------- |
| Name, photo                                                       | Free                                             | exists  |                                                                                    |
| Change email                                                      | Free                                             | exists  | confirmed from the old and the new inbox                                           |
| Change password from settings                                     | Free                                             | exists  | asks the current one; Google or Apple accounts can set a first one                 |
| Default currency                                                  | Free                                             | exists  | used for new groups                                                                |
| Time zone                                                         | Free                                             | exists  | with detect                                                                        |
| Language (7+ in Splitwise)                                        | Free                                             | partial | English, Spanish, French, German, Portuguese; live, saved on the profile, push too |
| Dark mode                                                         | Free (apps, May 2026)                            | exists  | system, light, dark                                                                |
| App passcode lock                                                 | Free (apps)                                      | skip    | the PWA uses the device lock; revisit for the native app                           |
| Two-factor authentication                                         | not in Splitwise                                 | exists  | authenticator app, recovery codes, enforced in the database (ADR 13)               |
| Log out on all devices                                            | Free                                             | exists  | also after a password change, for every other device                               |
| Sign in with Google (Splitwise also has Facebook)                 | Free                                             | partial | Google and Apple built, flagged off until OAuth clients exist                      |
| Merge two accounts                                                | Free (support)                                   | skip    | rare; handle by hand if it comes up                                                |
| Delete account                                                    | Free                                             | exists  | tombstones the profile, shared history kept                                        |
| Download my data                                                  | Free by emailing support; JSON self-serve is Pro | missing | see Batch 5                                                                        |
| Ads, daily expense limit (4 per day), Pro subscription, Trip Pass | Free / Pro                                       | skip    | Potluck is free; nothing to gate                                                   |
| Splitwise Card, card transaction import                           | Free card (US), import Pro                       | skip    | needs a card issuer or bank aggregator                                             |
| Public API                                                        | Free                                             | skip    | not planned; data export covers the main need                                      |
| Apple Watch                                                       | Free (some locales)                              | skip    | PWA only for now                                                                   |

## Payment links without a processor

Potluck never touches money. It can still save a step by opening the payer's app with the amount filled in, then recording the payment when they come back. Each person adds their handles once (Me, Payment methods); the settle-up screen shows the recipient's handles as buttons.

| Service                        | Link                                                                                       | Amount prefilled | Region   |
| ------------------------------ | ------------------------------------------------------------------------------------------ | ---------------- | -------- |
| PayPal.me                      | `https://paypal.me/<handle>/<amount><CUR>`                                                 | yes              | global   |
| Venmo                          | `https://venmo.com/<handle>?txn=pay&amount=<amount>&note=<note>` (opens the app on mobile) | yes              | US       |
| Cash App                       | `https://cash.app/$<cashtag>/<amount>`                                                     | yes              | US, UK   |
| Revolut                        | `https://revolut.me/<handle>`                                                              | no               | EU, UK   |
| Monzo                          | `https://monzo.me/<handle>/<amount>`                                                       | yes              | UK       |
| UPI                            | `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR`                                          | yes              | India    |
| Interac e-Transfer             | none; show the recipient's email or phone with a copy button                               | no               | Canada   |
| Bank details (IBAN, sort code) | copy button only                                                                           | no               | anywhere |

Rules: links are built on the client from the stored handle and the amount in the payment's currency (minor units formatted with the currency's digits); a handle is visible only to people who share a group with its owner; Potluck never claims a payment went through. After the link opens, the settle screen asks "Did it go through?" and records the payment on yes.

## Implementation batches

Ordered by user value. Each batch lists the screens and SQL it owns so batches can run in parallel; "Conflicts" names the batches that touch the same files, and how to keep the overlap small. Every batch follows the repo rules: additive migrations, money rules in both SQL and `packages/core` with the same test cases, pgTAP for every RPC and policy, i18n keys, help links, an e2e journey per flow, and an ADR for cross-cutting choices.

### Batch 1: Expense entry (multiple payers, adjustments, itemized storage, default split)

Status: built on `feat/expense-entry` ([ADR 12](adr/0012-several-payers-refunds-and-stored-items.md)). Recurring templates store payers as `recurring_expenses.payers` (`[{user_id, paid_cents}]`, null for one payer), the shape Batch 8 should keep.

Features:

- Multiple payers: "Paid by" opens a sheet where several people enter what each paid; amounts must total the expense.
- Adjustment split type: equal split plus a +/- amount per person.
- Stored line items for by-item expenses, so editing reopens the item editor with tax and tip.
- "Save as the default split for this group", and new expenses in that group start from it.
- One-tap "owed in full" options for two-person splits.
- Refunds: an expense marked as a refund credits the people in the split and debits the person who received the money.
- A new expense starts in the currency last used in that group.
- Expense page shows who created it and who last edited it, and when (edit history from `activity`).

Acceptance criteria:

- Adding a 90 expense paid 60 by Ava and 30 by Ben, split equally between three, leaves Cleo owing 30, Ava owed 30, Ben square; the group balances, the expense row ("Ava and Ben paid"), the detail page and the CSV agree to the cent.
- A payer total that does not match the amount blocks saving with a clear message; the server refuses it too.
- An adjustment split of 100 between three with +10 on Ava gives 40, 30, 30.
- Editing a by-item expense shows the same items, tax and tip that were entered.
- A 40 refund received by Ava and split between Ava and Ben reduces what Ben owes Ava by 20.
- After saving a default split, the next new expense in that group opens with that split; other groups are unaffected.
- Departed-member and archived-group rules hold for every new path.

Likely files: `apps/web/src/features/expenses/form/*` (expense-form, split-editor, split-state, itemized-editor, a new payers sheet), `expense-row.tsx`, `expense-detail.tsx`, `expense-math.ts` (CSV), `packages/core/src/money`, `packages/core/src/balances`, `packages/core/src/schemas/expense.ts`, `packages/api/src/money.ts`.

Migrations: table `expense_payers (expense_id, user_id, paid_cents)` with a deferred sum check, backfilled from `paid_by` (keep `paid_by` as the first payer for older clients); table `expense_items (expense_id, position, description, amount_cents, user_ids uuid[])` plus `tax_cents`, `tip` on expenses or a jsonb column; `split_type` gains `adjustment` (`alter type ... add value`); `expenses.is_refund bool` (sign flipped in balances, amount stays positive); `private.save_expense` and `private.compute_splits` redefined; `group_balances` view and `simplified_debts` credit each payer; table or `groups.default_split jsonb`; activity and notification triggers learn the new columns. Payload stays backward compatible: `paid_by` alone still works.

Conflicts: Batch 5 (CSV in `expense-math.ts`), Batch 3 (balances view if it adds stats), Batch 8 (recurring templates must store payers: agree on the `splits`/`payers` jsonb shape first). Land the migration early; it is the riskiest money change in this plan and needs an ADR.

### Batch 2: Settle up and reminders

Features:

- Record a payment in either direction ("Ben paid me") and, for admins, between two other members.
- Payment date (defaults to today; FX at that date).
- Edit a payment, restore a deleted payment.
- Comments on a payment.
- Payment methods on your profile and pay-by-link buttons (table above).
- "Remind" on a debt row: sends the debtor a notification (and email once Batch 6 lands), at most once a day per pair.
- Settle up with a friend across every shared group in one step, and "settle everything" in a group (records the suggested payments involving you).

Acceptance criteria:

- Recording "Ben paid me 20" moves both balances by 20 and notifies Ben.
- A payment dated last month uses last month's rate and sorts on that day.
- A deleted payment shows Restore to the people who could delete it, and restoring puts the balance back.
- With PayPal.me saved, the person who owes you sees "Pay with PayPal" with the amount filled in; nobody outside your groups can read your handles.
- Pressing Remind twice in a day says it was already sent.
- Settling with a friend across three groups records three payments and zeroes all three balances.

Likely files: `apps/web/src/features/settle/*`, `apps/web/src/features/balances/balances-tab.tsx`, `apps/web/src/features/friends/friends-page.tsx` (cross-group settle entry), a new `features/me/payment-methods.tsx` mounted from the Me page, `packages/api/src/money.ts`, notification `describe.ts`.

Migrations: `settle_up_v2(group_id, from_user, to_user, amount_cents, currency, note, settled_at)` (keep `settle_up`), `update_settlement`, `restore_settlement`, `remind_debt(group_id, user_id)` with a `debt_reminders` table for the rate limit, `comments.settlement_id` with the group trigger and policies, table `payment_methods (user_id, kind, handle)` readable by people who share a group, notification types `debt.reminder`, `settlement.deleted`.

Conflicts: Batch 6 (notification triggers and `describe.ts`; add types in separate migrations), Batch 7 (Me page: mount only), Batch 4 (friends page).

### Batch 3: Search, filters, charts and group totals

Features:

- Search across all groups (expenses and payments) from a search button in the app bar, with results grouped by group.
- Filters: date range, person (paid or involved), category, group and type (expenses or payments); date, person, category and type also on a group's Expenses tab, kept in its address.
- Totals (matching Splitwise's free Totals screen): total group spend, what you paid, your share, payments made and received, net change, by month or all time.
- Charts: spending by category and by month, per group and across groups, in the viewer's chosen currency.
- Deleted items view per group (expenses and payments) with Restore.
- Activity filtered by group (from the group screen) and by friend.

Acceptance criteria:

- Typing "taco" finds matching expenses in every group the viewer belongs to, and only those.
- Filtering a group's list to "Ben, March, Food" shows exactly those expenses and a matching total.
- The totals card for a month equals the sum of the viewer's shares in that month's expenses, converted to the group currency.
- Charts render with keyboard and screen reader access (data table fallback), in light and dark.
- A group's Activity link shows only that group's entries.

Likely files: new routes `/search` and `/groups/$groupId/stats` (or a Stats tab), `apps/web/src/features/expenses/expenses-tab.tsx` (filter bar), `apps/web/src/features/activity/activity-feed.tsx`, `packages/api/src/money.ts`, a new `features/insights/`, `packages/core` for totals math.

Migrations: `search_money(query text, filters jsonb)` RPC with a trigram or full-text index on `expenses.description` and `notes`; `spending_summary(group_id uuid, from date, to date)` returning totals by category and month in group currency (must match core); `activity` gets an index on `(group_id, created_at desc)` if missing.

Conflicts: Batch 5 (export button lives in `expenses-tab.tsx`; move it into an overflow menu once, in whichever lands first), Batch 1 (if it changes how a payer is read, totals must use the new payer table).

### Batch 4: People who are not on Potluck yet, and friends

Features:

- Add someone to a group by name (email optional) before they sign up; split with them right away. When they sign up with that email or open their claim link, the placeholder becomes their account and keeps its history. One invite email plus at most one reminder, as Splitwise does.
- Add a friend by email or a personal friend link, without a group. Remove a friend.
- Friend page: balance, every shared expense and payment across groups and 1:1, add expense, settle up (uses Batch 2's cross-group settle).
- Block and report from a person's menu; blocked list with Unblock on the Me page.

Acceptance criteria:

- Ava adds "Sam (sam@example.com)" to Roommates, adds a 30 expense with Sam in it, and Sam's share shows on the balances tab; Sam signs up with that email and sees the group with that balance.
- A placeholder cannot sign in, receives no push, and can be renamed or removed while their balance is zero.
- Opening a friend shows every shared expense from every group, newest first.
- Blocking someone hides them from friend suggestions and stops them from joining your groups; Unblock reverses it.

Likely files: `apps/web/src/features/friends/*`, new route `/friends/$friendId`, `apps/web/src/features/groups/members-page.tsx`, `apps/web/src/features/invites/*`, `packages/api/src/groups.ts`.

Migrations: placeholder profiles (`profiles.is_placeholder`, `profiles.claim_email`, not linked to `auth.users`; needs a design for the profiles FK to `auth.users` and an ADR), `add_placeholder_member`, a claim step in the signup trigger or `accept_invite`, `create_friend_invite` / `accept_friend_invite`, `block_user` / `unblock_user` RPCs if direct writes are not enough, RLS updates so placeholders appear wherever members do.

Conflicts: Batch 2 (friends page), Batch 7 (Me page blocked list: mount only). This batch changes identity assumptions everywhere; start with the ADR.

### Batch 5: Export, backup and import

Features:

- Export all groups, one group or one friend as CSV with expenses and payments, and a full JSON backup of everything the viewer can see.
- Import a Splitwise CSV export (and a generic CSV) into a group: map Splitwise names to members (or placeholders once Batch 4 lands), preview, then import in one step.

Acceptance criteria:

- The full CSV lists every expense and payment from every group with date, description, category, amount, currency, group currency amount, payer and each person's share; reimporting it into an empty group reproduces the balances.
- The JSON backup downloads in one file and contains profile, groups, members, expenses with splits, payments, comments and recurring templates.
- Importing a Splitwise export of 200 rows shows a preview with the resulting balances before anything is written, and writes nothing if any row fails.

Likely files: new `apps/web/src/features/export-import/`, a "Your data" section mounted from the Me page, group settings entry for import, `expense-math.ts` (shared CSV code), `packages/core` CSV parsing helpers (no DOM).

Migrations: `import_expenses(group_id, rows jsonb)` that validates every row and inserts in one transaction (lock the group row once, same checks as `create_expense`, one activity entry `expenses.imported`); optional `export_my_data()` returning jsonb.

Conflicts: Batch 3 (`expenses-tab.tsx` export button), Batch 1 (CSV columns for multiple payers), Batch 7 (Me page mount).

### Batch 6: Notifications and email

Features:

- Per-type preferences for push and email: expenses added, expenses edited or deleted, payments, comments, plans, reminders, added to a group.
- Email notifications through an SMTP provider, behind an `email_notifications` flag until a domain exists.
- Monthly summary email (balances per group, what changed) with an opt-out.
- New notification types: `expense.deleted`, `settlement.deleted`, `member.added` (you were added to a group).

Acceptance criteria:

- Turning off "Payments" for push stops payment pushes on every device while the inbox still shows them.
- With email on, adding an expense emails each person in the split once, with their share and a link.
- Every email has a working one-click unsubscribe for its type.
- On the first of the month, people with a non-zero balance get one summary email.

Likely files: `apps/web/src/features/me/` (a notifications section component), `supabase/functions/notify/*`, a new `supabase/functions/email/` or an email path inside `notify`, `apps/web/src/features/notifications/describe.ts`.

Migrations: table `notification_prefs (user_id, type, push bool, email bool)` with defaults; `private.notify` reads it; new triggers for the new types; cron `monthly-summary`; `app_config` key `email_notifications`.

Conflicts: Batch 2 (`describe.ts` and notification triggers for `debt.reminder`), Batch 7 (Me page section: separate component, one-line mount).

### Batch 7: Account and settings

Features:

- Change email (with confirmation) and change password while signed in.
- Log out on all devices.
- Two-factor authentication with an authenticator app (Supabase Auth TOTP), with recovery.
- Language switcher (infrastructure plus one more language to prove it; profile `locale` already exists).
- "Send feedback" link and app version (strings exist).

Acceptance criteria:

- Changing the password signs out other sessions and the new password works on the next sign-in.
- With 2FA on, signing in asks for a code; a wrong code is refused; turning it off needs a code.
- Switching language changes every screen without a reload and survives sign out and in.

Likely files: `apps/web/src/features/me/me-page.tsx` and new section components, `apps/web/src/features/auth/*`, `packages/i18n` (locale loading), `apps/web/src/lib/locale.ts`.

Migrations: none expected (Auth handles email, password and MFA); RLS policies may require `aal2` for sensitive RPCs once 2FA is on, which needs an ADR.

Conflicts: Batches 2, 4, 5 and 6 mount sections on the Me page. Rule for all of them: each adds its section as its own component file and a one-line mount, so merges are trivial.

### Batch 8: Recurring expenses

Status: built on `feat/recurring` ([ADR 14](adr/0014-editable-recurring-templates.md)). Templates keep the Batch 1 payload shape and now store by-item bills and their repeat day.

Features:

- Edit a repeating expense's amount, payer and split.
- Every 2 weeks (fortnightly), the one Splitwise interval Potluck lacks.
- Make an existing expense repeat from its page.
- Skip the next occurrence ("just this once"), next to the existing pause and remove.
- Optional heads-up (push, and email once Batch 6 lands) the day before a repeating expense posts.

Acceptance criteria:

- Changing the rent template from 1500 to 1600 makes the next posted expense 1600; past ones stay 1500.
- A fortnightly template posts every 14 days, matching `nextOccurrence` in core.
- Making a past expense repeat monthly posts the next one a month after its date.
- Skipping posts nothing for that period and the next date moves on.

Likely files: `apps/web/src/features/recurring/*`, `apps/web/src/features/expenses/expense-detail.tsx` (make it repeat), `packages/core/src/recurrence`, `packages/api/src/money.ts`.

Migrations: `update_recurring_expense(id, payload)` RPC validating the split like `create_expense`; `recurrence` enum gains `biweekly` (core `nextOccurrence` too); `private.materialize_recurring_expenses` redefined; `recurring_expenses.skip_until` or a skip RPC; notification type `recurring.upcoming`.

Conflicts: Batch 1 (template split shape and payers), Batch 6 (new notification type).

### Batch 9: Groups

Features:

- Group type (Home, Trip, Couple, Other) chosen at creation, with type defaults (trips can have start and end dates; home groups suggest monthly rent and utilities).
- Undelete a group for 30 days after deleting it.
- Cover photo upload and display on the group header and invite page.
- Whiteboard: shared group notes any member can edit, with last edited by.
- Invite by QR code (from the existing invite link).
- More categories with subcategories and a description-based suggestion (local rules plus the group's own history).

Acceptance criteria:

- An admin uploads a cover and every member sees it on the group header; the join page shows it.
- Editing the whiteboard shows the change to other members live and logs it in the group's activity.
- A deleted group shows under "Recently deleted" on the Groups page for 30 days with Restore; after that it is gone.
- Typing "Uber" suggests Transport; typing a description used before in the group suggests that expense's category.

Likely files: `apps/web/src/features/groups/*` (settings-page, group-form-fields, create-group-sheet, group-layout), `apps/web/src/features/invites/join-page.tsx`, `packages/core/src/categories`, the category picker inside `expense-form.tsx`.

Migrations: `groups.type`, `groups.starts_on`, `groups.ends_on`, `groups.deleted_at` with `restore_group` and a cron purge (today `delete_group` hard deletes, so this changes its contract and needs `delete_group` callers checked), `groups.whiteboard text` with `whiteboard_updated_by/at` (direct write by members, trigger for archived groups), `create_group_v2` taking the type, `invite_preview` already returns `cover_path`.

Conflicts: Batch 1 (`expense-form.tsx` category picker: extract the picker into its own component first), Batch 4 (`members-page.tsx` is Batch 4's).

### Batch 10: Receipts

Features:

- Scan a receipt on the device (client-side OCR in a web worker, no server cost) to fill total, date and line items into the by-item editor.
- Several attachments per expense, and photos on comments.
- Stretch: a restaurant bill flow where diners claim their items from a link or QR code without an account (Splitwise's free US/UK itemize), built on Batch 4 placeholders.

Acceptance criteria:

- Scanning a clear printed receipt fills the total and date and offers the line items; the person confirms before anything is saved.
- An expense can hold up to five attachments; each opens full screen; members of other groups cannot read them.

Likely files: `apps/web/src/features/expenses/form/receipt-field.tsx`, `itemized-editor.tsx`, a new OCR worker, `packages/api/src/money.ts`.

Migrations: table `expense_attachments (expense_id, path, content_type, uploaded_by)` with storage policies reusing the `receipts` bucket rules; `expenses.receipt_path` stays as the first attachment for older clients.

Conflicts: Batch 1 (`itemized-editor.tsx`, form). Start after Batch 1 lands.

## Parallel plan

| Wave | Batches    | Why together                                                                                                                              |
| ---- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 1, 2, 3, 6 | disjoint screens; 1 owns the expense form and money SQL, 2 owns settle and balances, 3 owns lists and new routes, 6 owns notify and prefs |
| 2    | 4, 5, 7, 8 | 4 and 5 build on placeholders and the new payer shape; 7 is mostly Auth; 8 needs Batch 1's template shape                                 |
| 3    | 9, 10      | 9 touches the category picker in the form; 10 needs stored items from Batch 1                                                             |

Shared hot spots to coordinate across every batch: `supabase/tests/01_schema.test.sql` (each batch bumps `plan(N)`; rebase and renumber), migration timestamps (each must sort after `main`), `docs/architecture.md` sections, `packages/i18n/src/en/*.ts` (add keys in new blocks, not in the middle of existing ones), `apps/web/src/features/me/me-page.tsx` (mount-only edits) and `apps/web/src/features/notifications/describe.ts`.
