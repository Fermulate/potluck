# Receipts: scanning and attachments

How a receipt photo becomes an expense, and how files are kept on expenses. The decision is [ADR 21](adr/0021-receipt-scanning-and-attachments.md); the flow is drawn in [sequences.md](sequences.md#scan-a-receipt-and-attach-files).

## Where the code is

| Part                                   | Where                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| Parser (text to merchant, date, items) | `packages/core/src/receipts/parse-receipt.ts`                                  |
| OCR worker (tesseract.js)              | `apps/web/src/features/expenses/receipts/ocr.ts`                               |
| Image prep (OCR copy, upload copy)     | `apps/web/src/features/expenses/receipts/image.ts`                             |
| Scan button and review sheet           | `apps/web/src/features/expenses/receipts/scan-receipt.tsx`                     |
| What a scan fills in the form          | `apps/web/src/features/expenses/receipts/scan-fill.ts`                         |
| Files on the form, upload and cleanup  | `attachments-field.tsx`, `attachments-state.ts` (same folder)                  |
| Files on the expense page, viewer      | `attachment-gallery.tsx`, `use-zoom-pan.ts` (same folder)                      |
| Reader files served from our origin    | `apps/web/ocr-assets.ts` (`/ocr/<version>/`, cached by the service worker)     |
| API                                    | `packages/api/src/attachments.ts`                                              |
| Table, RPC, mirror trigger, sweep      | `supabase/migrations/*_expense_attachments.sql`, test `29_expense_attachments` |

## Rules

- Only `ocr.ts` imports `tesseract.js`, and only with a dynamic `import()`, so it never lands in the app bundle or the precache. Its worker, core and model come from `/ocr/<version>/` on our origin.
- OCR reads a lossless grayscale copy of the original photo with its contrast stretched (`ocrImage`), never the JPEG that is uploaded. When the items do not come to the total, or there was no total line and the total had to be worked out (that never counts as enough), a second pass reads an upscaled copy; when the best so far is still far off, a third reads the plain colour photo (which suits some long receipts better). The best reading wins (`bestScan`).
- The upload copy (`prepareImage`) is at most 2000 px, JPEG on white. Re-encoding drops the photo's metadata, location included. HEIC outside Safari and PDFs go up as they are.
- A scan only fills the form. The review sheet shows the photo and lets each price be corrected; the person saves the expense.
- The parser is heuristics with no SQL twin. A receipt it misreads becomes a case in `parse-receipt.test.ts`. It skips unit price lines ("2 Stk x 0,90"), payment lines and VAT summary rows, and reports `itemsMatch` (exact, close, off, or unconfirmed). Payment lines never supply a total, they only confirm one: with no total line the total is the subtotal, or else the items, with nothing added, and it stays `totalDerived` (the review asks the person to check it) unless a card line, or the cash handed over (less the change, when a change line was read), says the same amount. Card balance, points and approval lines never count as paid.
- Tests mock `./ocr`: jsdom has no workers or canvas.

## Attachments in the database

- `expense_attachments` holds up to five files per expense, in order. Files live in the private `receipts` bucket under `<group_id>/`, so the bucket's member, uploader and two-step policies are the only storage rules.
- `set_expense_attachments(id, attachments)`: a list of storage paths (strings; anything else is `invalid_receipt_path`). Group row share lock, member, `require_group_open`, own expense or admin, not on a deleted expense. Each path starts with `<group_id>/`, appears once and exists in the bucket (`attachment_not_found`); more than five is `too_many_attachments`. An unchanged list writes and logs nothing. Otherwise it rewrites the rows, sets `receipt_path` to the first file and logs one `expense.updated` with `changes.attachments = {from, to}`. Every change through it is logged, however soon after the create.
- `create_expense_with_attachments(payload, attachments)`: `create_expense_v2` and the same file checks in one transaction. The files are part of creating the expense, so its history has the one `expense.created` entry, and a refused file means nothing is created. The app creates every expense with files this way.
- `receipt_path` is always the first attachment. A trigger mirrors an older client's writes: its file is replaced or dropped and the others stay.
- Dropped files are deleted by the client when the bucket lets it (uploader or admin). Files uploaded for a save that never happened are deleted when the form closes, and kept for a retry while it is open.
- The daily `receipts-sweep` job finds files in the bucket older than a day that no expense or attachment names (`public.orphan_receipts`, service role only) and has the `receipts-sweep` edge function delete them through the Storage API, which also removes the stored object. Deleting rows from `storage.objects` in SQL would leave the object behind.
- A deleted group's files stay while it can be restored (its expenses still name them). When `purge-deleted-groups` removes it after 30 days, its rows go and the next sweep deletes the files.
- pgTAP deletes from `storage.objects` need `set_config('storage.allow_delete_query', 'true', true)`, as the Storage API sets.
