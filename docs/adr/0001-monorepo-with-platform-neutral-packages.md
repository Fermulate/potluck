# 1. Monorepo with platform-neutral packages

- Status: accepted
- Date: 2026-11-05

## Context

Potluck ships as a web app first, and a native app is planned. Split math, debt simplification and slot ranking have to give the exact same cents and the exact same ranking on every client, and those rules also exist in SQL. If each app kept its own copy, the copies would drift, and a one-cent difference between what the phone shows and what the database stores is a bug report waiting to happen.

## Decision

One pnpm workspace with Turborepo, split by what runs where:

- `packages/core`, `packages/api`, `packages/tokens` and `packages/i18n` are platform-neutral. No `react-dom`, no `window`, no `document`, no `localStorage`. Their tsconfig only has the `ES2022` lib, and ESLint's `no-restricted-imports` and `no-restricted-globals` rules fail the build if someone slips.
- `packages/ui` and `apps/web` are web only.
- Packages export their TypeScript source directly (`"exports": { ".": "./src/index.ts" }`). There is no per-package build step; Vite and Vitest compile on the fly.
- Shared versions live in the `catalog:` section of `pnpm-workspace.yaml`.

## Consequences

- A future `apps/native` can import `core`, `api`, `tokens` and `i18n` as they are.
- One PR can change a migration, the matching core function and the screen that uses it, and CI checks them together.
- Core rules are mirrored in SQL by hand (`compute_splits` and `allocate`, `simplified_debts` and `simplifyDebts`, `best_slots` and `rankSlots`). Tests on both sides pin the same behavior, but nothing generates one from the other. A rule change means two edits.
- Source exports keep things simple now. If a package is ever published or consumed by a tool that cannot read TypeScript, it will need a build step.
