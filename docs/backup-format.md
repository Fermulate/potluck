# Backup and spreadsheet formats

What Me, Your data downloads, and what the import screen reads. Decisions and trade-offs: [ADR 18](adr/0018-export-backup-and-import.md). The code that pins each format: core `backupSchema` (`packages/core/src/portability/backup.ts`), `ledgerCsv` / `parseLedger` (`ledger.ts`) and `parseSplitwise` (`splitwise.ts`).

## JSON backup (`potluck-backup`, version 1)

One file, written by `export_my_data()`. Conventions:

- Money is an integer in the currency's minor unit (cents; yen for JPY; fils for KWD).
- Exchange rates (`fx_rate`) and split weights are decimal text, never JSON numbers, so no digit is lost (`"1.100000000000"`).
- Times are ISO 8601 with an offset; days (`spent_at`, `next_run_on`, plan windows) are `YYYY-MM-DD`.
- Ids are UUIDs; every person id resolves in `people`.
- Within version 1, fields may be added. A field that is renamed, removed or changes meaning means version 2, and readers check `format` and `version` first.

Top level:

| Field         | What                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`      | always `"potluck-backup"`                                                                                                                         |
| `version`     | `1`                                                                                                                                               |
| `exported_at` | when the file was made                                                                                                                            |
| `profile`     | `id`, `display_name`, `email` (sign in address), `avatar_path`, `timezone`, `default_currency`, `locale`, `created_at`                            |
| `people`      | everyone the file mentions: `id`, `display_name`, `deleted` (closed account). People who left a group stay here so old expenses keep their names. |
| `friends`     | ids of everyone you share or shared a group with                                                                                                  |
| `groups`      | every group you are in, archived ones too, oldest first                                                                                           |

Each group: `id`, `name`, `emoji`, `color`, `currency`, `is_direct` (a 1:1 tab), `simplify_debts`, `members_can_invite`, `default_split` (as stored, see [architecture](architecture.md)), `created_by`, `created_at`, `archived_at`, and:

- `members`: `user_id`, `role` (`owner`, `admin`, `member`), `joined_at`.
- `expenses`, by day: `id`, `description`, `amount_cents`, `currency`, `fx_rate` (into the group currency, taken on the expense day), `is_refund`, `split_type`, `category`, `notes`, `spent_at`, `tax_cents`, `tip_cents`, `discount_cents`, `event_id`, `recurring_id`, `receipt_path` (a path in the private receipts bucket; the image itself is not in the file), `created_by`, `created_at`, `updated_at`, `deleted_at` (deleted expenses are kept and marked, as they can be restored), and
  - `payers`: `user_id`, `paid_cents` (sum to `amount_cents`; for a refund, who got the money),
  - `splits`: `user_id`, `share_cents` (sum to `amount_cents`), `weight` (percent or shares, text), `adjustment_cents`,
  - `items`: by-item bills as entered, `position`, `description`, `amount_cents`, `user_ids`,
  - `comments`: `id`, `author_id`, `body`, `created_at` (deleted comments are left out).
- `payments`: `id`, `from_user` (paid), `to_user` (got it), `amount_cents`, `currency`, `fx_rate`, `note`, `settled_at`, `created_by`, `created_at`, `deleted_at`.
- `recurring`: repeating expense templates, `id`, `description`, `amount_cents`, `currency`, `paid_by`, `payers` (null for one payer), `split_type`, `splits` (as stored), `category`, `recurrence`, `next_run_on`, `active`, `created_by`, `created_at`.
- `plans`: `id`, `title`, `description`, `location`, `emoji`, `status`, `timezone`, `window_start`, `window_end`, `day_start_minute`, `day_end_minute`, `slot_minutes`, `duration_minutes`, `min_attendees`, `starts_at`, `ends_at`, `rsvp_deadline`, `created_by`, `created_at`, `rsvps` (`user_id`, `status`, `updated_at`), `availability` (`user_id`, `slot_start`, `level`), `comments`.

A balance is not stored: it follows from the expenses and payments (ADR 3 and ADR 12), and the spreadsheet export shows it.

## Spreadsheet export

The same layout for one group (group settings or the expenses tab), everything (Me) and one friend (Me). Comma separated, UTF-8 with a byte order mark, CRLF line ends. Column names are in the app's language; English names below.

| Column                       | What                                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Date                         | the expense day, or the UTC day a payment was recorded (the day its rate is from)                                 |
| Group                        | group name                                                                                                        |
| Type                         | Expense, Refund, Payment, or Balance (the closing row of each group)                                              |
| Description, Category        | as entered; a payment reads "Ava paid Ben"                                                                        |
| Amount, Currency, Rate       | in the currency it was entered in; refunds are negative                                                           |
| Group currency, Amount in... | the group currency and the amount converted with the stored rate                                                  |
| Paid by                      | one name, or "Ava 60.00; Ben 30.00"                                                                               |
| _Name_ paid, _Name_ share    | per person, in the row's currency; refunds negative; a payment is paid by the payer and the share of the one paid |
| _Name_ balance               | what the row did to that person in the group currency (positive: is owed). Each column sums to the balance.       |
| Notes, Items                 | notes; for by-item bills "Pizza 24.00 (Ava, Ben); Tax 2.00; Tip 3.00"                                             |

Formulas are neutralised: text that starts with `=`, `+`, `-`, `@`, tab or CR gets a leading apostrophe. A friend export keeps only you and the friend, with "Between you and _Name_" instead of the balance columns (positive: they owe you), summing to what the two of you owe each other in each group.

## Import

The import screen (group settings, Import) reads:

- **A Potluck spreadsheet** (any language Potluck writes): each row comes back with its payers and shares, refunds as refunds and payments as payments. Into a group with the same currency, rows in other currencies keep the Rate they were exported with, so the balances come back exactly even if stored rates change. A file with several groups imports one group at a time. A friend export cannot be imported, since it leaves people out.
- **A Splitwise export** ("Export as spreadsheet" on a Splitwise group or friend, in any language): Date, Description, Category, Cost, Currency, then one column per person with what the row did to them. Payments are rows with the category Payment; a negative cost is a refund. The "Total balance" lines are used to check the file. Who paid is rebuilt from those numbers (ADR 18), categories are mapped to Potluck's (Dining out to Food, Gas/fuel to Gas, and so on; anything else to Other).

Dates may be ISO (2026-03-01) or as a spreadsheet saves them (3/1/26, 01/03/2026); month first or day first is worked out from the file, shown, and can be switched. Each person in the file is matched to a member or left out (their rows stay out); someone who left the group cannot be given new rows. Rows in another currency need a rate: the file's, Potluck's stored rate for the day, or one typed in; otherwise they wait or are left out. Rows that look like ones already in the group, and a file imported before, are pointed out. Up to 5,000 rows go in as one import, all or nothing; a longer file (up to 50,000 rows) goes in as several imports of 5,000.
