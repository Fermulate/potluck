## Summary

<!-- What does this change and why? Link the issue it closes, e.g. "Closes #12". -->

## How to test

<!-- Steps a reviewer can follow to verify the change. -->

1.

## Screenshots

<!-- For UI changes: before / after, mobile and desktop if relevant. Delete if not applicable. -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass locally
- [ ] Tests added or updated for new behavior
- [ ] Database changes are in a new migration with pgTAP tests in `supabase/tests/`
- [ ] No secrets, keys or personal data committed
- [ ] UI changes checked on a phone-sized screen
