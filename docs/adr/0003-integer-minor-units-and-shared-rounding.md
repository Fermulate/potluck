# 3. Integer minor units and shared rounding rules

- Status: accepted
- Date: 2026-11-05

## Context

Splitting $100 three ways does not divide evenly. Somebody pays the extra cent, and everyone has to agree on who. Floats make it worse: `0.1 + 0.2` is not `0.3`, and balances that drift by a fraction of a cent never settle to zero. The client shows a preview while you type, and the server stores the result. If they disagree, users see one number and then another.

## Decision

- Store every amount as a `bigint` in the currency's minor unit (cents, yen, fils). The number of digits comes from one ISO 4217 table, `private.minor_units()` in SQL and `minorUnits()` in core.
- Round half away from zero. Postgres `round(numeric)` already does this, and `convert()` in core reproduces it with `BigInt`.
- Split by largest remainder: everyone gets the floor of their share, and the leftover cents go to the largest remainders. Ties go to the smaller user id, compared as plain code points so JavaScript and Postgres `uuid` ordering agree.
- Scale percent and shares weights to 6 decimal fixed point before splitting.
- Snapshot the FX rate (`numeric(18,8)`) on the row when it is written. Balances convert each expense once and split the converted total, so every expense nets to exactly zero in the group currency.
- The server derives `equal`, `percent` and `shares` splits itself and ignores any `share_cents` the client sends for them.

## Consequences

- The client preview and the stored value match to the cent, and tests can assert exact numbers.
- Balances in a group always sum to zero, which `simplifyDebts()` checks and throws on otherwise.
- Who gets the odd cent is deterministic but arbitrary: it depends on user ids, not on who paid or who joined first.
- The rule is implemented three times (core `allocate()`, `private.compute_splits()`, the `group_balances` view). Changing it means changing all three and their tests.
- A past expense keeps its original rate forever, even if rates are corrected later. That is intended: nobody's balance should move because of a data fix.
