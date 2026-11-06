## Summary

<!-- What does this change and why? Link the issue it closes, e.g. "Closes #12". -->

## How to test

<!-- Steps a reviewer can follow to verify the change. -->

1.

## Screenshots

<!-- For UI changes: before / after, mobile and desktop if relevant. Delete if not applicable. -->

## Checklist

- [ ] `pnpm verify` passes locally
- [ ] Database changes: a new migration with pgTAP tests, regenerated files (`pnpm gen:db`), and `pnpm verify:db` passes
- [ ] Changed a journey: its e2e spec passes (`pnpm --filter @potluck/web exec playwright test e2e/<spec>.spec.ts`)
- [ ] Tests added or updated for new behavior
- [ ] Docs updated where the code changed them (`docs/architecture.md` for tables, RPCs, error codes)
- [ ] No secrets, keys or personal data committed
- [ ] UI changes checked on a phone-sized screen
