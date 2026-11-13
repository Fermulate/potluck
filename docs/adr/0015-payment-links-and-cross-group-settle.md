# 15. Payment links and settling across groups

- Status: accepted
- Date: 2026-11-13

## Context

Splitwise parity needs three payment features that touch money and privacy: paying through an app (PayPal, Venmo, Cash App and friends), settling every balance with a friend in one step across all shared groups, and "settle everything" in a group. Potluck has no payment processor and does not want one: holding or moving money needs a licence, fraud handling and support we cannot offer. Debts are also computed per group, under each group's own rule (simplified or every pair on its own), and the pairwise rule existed only in `packages/core`.

## Decision

- **Links, never money.** People save handles on Me, Payment methods (`payment_methods`, one per app). The settle up screen shows the recipient's handles as "Pay with ..." buttons built on the client by `paymentAction` in `packages/core`: the amount is formatted with the currency's digits and only prefilled where the app takes that currency (Venmo USD, Monzo GBP, UPI INR, ...). Interac and bank details have no link and get a copy button. After a link opens, Potluck asks "Did it go through?" and records the payment only on yes. It never claims a payment happened.
- **Handles are visible to group mates only.** RLS lets the owner and people who share a group with them (with no block either way) read handles. Handle formats are checked in SQL (`private.valid_payment_handle`, a check constraint plus a trigger that raises `invalid_payment_handle`) and in core (`isValidHandle`) with the same cases. Closing an account deletes them.
- **Debts are computed on the server for bulk settling.** `private.pairwise_debts` mirrors `pairwiseDebts`: each expense's effect per person is computed as `group_balances` does (several payers credited, refunds flipped, largest remainder), and inside an expense the people behind pay the people ahead, each debtor spread over the creditors by what they are still owed. `private.group_debts` picks the group's rule. `settle_all` and `settle_with_friend` read debts there, inside the transaction, instead of trusting amounts from the client, so a payment recorded a second earlier cannot be paid twice. A friend settle may name groups and smaller amounts; the server checks each against the debt it computes.
- **One payment per group.** Settling with a friend records one payment in each shared open group, in that group's currency at rate 1, rather than one cross-group payment. Balances stay per group, archived groups are skipped (they are read only), and every payment keeps working with edit, delete, restore and comments. Picking groups and paying part of a debt is allowed, as in Splitwise.
- **Lock order.** `settle_with_friend` share locks every shared group row in id order before reading any balance, as the root rules require for several groups.
- **Payment days are the payer's days.** A picked day is a calendar day in the recorder's time zone (their profile) and is stored at noon there, so "yesterday" never lands on today wherever UTC is.
- **Versioned RPC.** Recording "Ben paid me", a payment between two others (owners and admins) or a past date needed new arguments, so `settle_up_v2` sits next to `settle_up` ([ADR 8](0008-additive-migrations-and-versioned-rpcs.md)).

## Consequences

- No processor fees, no money held, nothing to reconcile. The cost is a manual confirmation step, and a payment can be recorded that never went through; the payer and payee can edit, delete or restore it.
- The pairwise rule now lives in SQL too. Any change to how an expense moves balances must update `private.pairwise_debts`, `group_balances`, `simplified_debts` and core together, with the shared cases in `20_payments.test.sql` (several payers and refunds included).
- A friend in three groups gets three `settlement.created` notifications from one tap.
- Links depend on third party URL formats that can change; they live in one core function with tests.
- Handles are personal data visible to everyone in your groups. The Me page says so next to the form.
