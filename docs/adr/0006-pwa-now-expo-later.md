# 6. PWA now, Expo later

- Status: accepted
- Date: 2026-11-05

## Context

People use expense splitters on their phones, often in the moment ("who paid for dinner?"). App store builds need developer accounts, review cycles and a release process for every fix. We want something on phones this month, and a native app when it is worth the overhead.

## Decision

- Ship the web app as an installable PWA with `vite-plugin-pwa` (`registerType: 'autoUpdate'`, standalone display, offline app shell). Web push uses VAPID keys and the `notify` edge function.
- Build the native app later with Expo (React Native), reusing `core`, `api`, `tokens` and `i18n` unchanged.
- Keep the backend ready for it now: the `push_platform` enum already has `ios` and `android`, `app_config.min_client_version` holds a minimum version per platform, and `notify` is written to add Expo push next to web push.

## Consequences

- One codebase to ship today, and fixes go live on the next deploy without store review.
- iOS only delivers web push to PWAs added to the home screen, and the install flow there is manual. Some people will never see a push.
- The PWA service worker does not handle `push` events yet (it is the default `generateSW` output), so push delivery is not finished on web.
- When the native app arrives, its screens and navigation are new work. Only the logic below the screens carries over.
- Native clients will lag behind the server, which is why migrations stay additive ([ADR 8](0008-additive-migrations-and-versioned-rpcs.md)).
