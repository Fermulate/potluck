# Architecture decision records

Short notes on decisions that shape the codebase: what we were facing, what we chose, and what it costs us. Each record is immutable once accepted. To change course, write a new record that supersedes the old one and update the old one's status.

| ADR                                                        | Decision                                                    |
| ---------------------------------------------------------- | ----------------------------------------------------------- |
| [0001](0001-monorepo-with-platform-neutral-packages.md)    | Monorepo with platform-neutral packages                     |
| [0002](0002-supabase-backend-with-rls-authorization.md)    | Supabase as the whole backend, RLS as authorization         |
| [0003](0003-integer-minor-units-and-shared-rounding.md)    | Integer minor units and shared rounding rules               |
| [0004](0004-security-definer-rpcs-for-multi-row-writes.md) | Security definer RPCs for multi-row writes                  |
| [0005](0005-cloudflare-workers-static-assets.md)           | Cloudflare Workers static assets for hosting                |
| [0006](0006-pwa-now-expo-later.md)                         | PWA now, Expo later                                         |
| [0007](0007-agpl-with-app-store-exception.md)              | AGPL-3.0 with an App Store exception                        |
| [0008](0008-additive-migrations-and-versioned-rpcs.md)     | Additive migrations and versioned RPCs                      |
| [0009](0009-i18n-strings-split-per-feature.md)             | i18n strings split per feature                              |
| [0010](0010-custom-domains.md)                             | Custom domains on fermulate.com                             |
| [0011](0011-notification-prefs-and-email.md)               | Notification settings per category, email from the database |
| [0012](0012-several-payers-refunds-and-stored-items.md)    | Several payers, refunds and stored line items               |
| [0013](0013-two-step-sign-in-enforced-in-the-database.md)  | Two-step sign in is enforced in the database                |
| [0015](0015-payment-links-and-cross-group-settle.md)       | Payment links and settling across groups                    |

## Writing a new one

Copy the shape of an existing record: title, status, date, then Context, Decision, Consequences. Number it with the next free number. Keep it to one screen. Consequences should include the costs, not only the wins.
