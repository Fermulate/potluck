# Design: "Supper Club"

Potluck should feel like a well-run dinner party: warm, confident, a little playful, never corporate. Paper and ink, a splash of tomato and saffron. Generous type, real hierarchy, motion that has weight.

## Palette (light)

Paper and ink, a splash of tomato, and three supporting colors with one job each: green is money
coming back, yellow is a plan or a date, plum is history.

| Token     | Value     | Use                                                                           |
| --------- | --------- | ----------------------------------------------------------------------------- |
| `paper`   | `#fbf5ea` | app background                                                                |
| `card`    | `#ffffff` | surfaces                                                                      |
| `ink`     | `#1d1a16` | text, primary dark surfaces (balance hero), quieter strong buttons            |
| `mute`    | `#7a7166` | secondary text, settled and zero amounts                                      |
| `line`    | `#ebe2d3` | borders, dividers                                                             |
| `tomato`  | `#e8492f` | the action color and the brand mark; also "you owe", count badges, heat max   |
| `olive`   | `#4a8431` | "you are owed", done and success, a switch that is on                         |
| `saffron` | `#f5b53d` | plans, date chips, highlights and gentle notices, the lit pill in the tab bar |
| `plum`    | `#6b3d6e` | quiet accent: history, charts, avatars                                        |

Tomato does three jobs, told apart by weight and shape, never by a second hue:

- **The next step** is a solid tomato pill with white text (`Button` primary, the add button, the
  poll card button). One per screen where you can.
- **Money you owe** is tomato text only (`tomato-ink`, no fill, no border), always with words or a
  sign beside it ("you owe", a minus), so it never reads as something to press.
- **Destructive actions** (delete, remove, leave) are the `danger` button: a soft tomato tint with a
  thin border and tomato text, never the solid fill, so they cannot pass for the primary button
  beside them. They always open a confirm dialog that names what will happen; only there, alone
  beside Cancel, is the confirming button solid.

A settled or zero amount is `mute`, not green. Links are ink with a tomato underline. Tomato gingham
(the `gingham` utility) is the tablecloth: the landing page's table edge and the first steps card on
Home. Do not spread it further.

Dark mode is designed, not inverted: background `#14110e`, surface `#1f1b17`, ink becomes `#f6efe3`, tomato `#ff6a4d`, saffron `#ffc65c`. Check AA contrast for every text pairing.

These are the brand hues. The exact per-theme values, including AA adjustments (light secondary text uses `#716759`, not `mute`), live in `packages/tokens/src/color.ts`, which is the source of truth.

Heat scale for availability (0 to max): `#f1e9db`, `#f9dccf`, `#f4ab95`, `#ee7a5d`, `#e8492f`.

## Type

- Display: **Instrument Serif** (italic for flourishes: greetings, empty states, event titles).
- UI: **Bricolage Grotesque** (variable, 400 to 800). Big numbers in 800.
- Numbers: tabular figures for every amount.
- Self-host fonts via `@fontsource` packages (no runtime Google Fonts call).

## Shape and space

- Radius: 18px cards, 999px pills and avatars, 12px inputs.
- 4px spacing grid. Mobile gutters 16px, cards 12 to 16px padding.
- Borders over shadows. One soft, warm shadow for raised sheets.

## Motion

- Library: `motion`. Springs, not linear easing. Default `{ type: "spring", stiffness: 380, damping: 32 }`.
- Lists stagger in (30ms). Balances count up. Sheets slide from the bottom on mobile, center on desktop.
- View Transitions API for card to detail navigations where supported.
- Always respect `prefers-reduced-motion` (fade only).

## Signature moments (acceptance criteria)

1. Settle-up: amount ticks to $0.00, confetti burst in palette colors, short haptic (`navigator.vibrate`) on mobile.
2. Live heatmap: cells warm up in real time as friends paint availability (Supabase Realtime).
3. Availability painter: press and drag to paint, works with touch, mouse, and keyboard (arrow keys + space).
4. Split slider: drag a handle to move share between two neighbours; avatars nudge as shares change. Typed percents stay as typed and the status says how much is left or too much.
5. Lock-in: the chosen slot "stamps" onto the timeline with a scale-and-settle animation.
6. Invite page: big group emoji, stacked member faces, one-tap join.
7. Skeletons and optimistic updates everywhere; no spinner visible longer than 300ms.
8. Empty states with personality (serif italic headline, one clear action).

## Layout

- Mobile first. Bottom tab bar: Home, Groups, (+ big add button), Plans, Me.
- One clear next step per screen. An empty state always carries the action that fills it, and a
  header button that would repeat it steps aside. A "?" (`features/help`) sits beside anything that
  needs explaining, and opens a short note or the guide heading.
- At `lg` the tab bar becomes a left rail and detail views open as a second pane.
- The add button opens a quick sheet: Add expense, Plan something, Settle up.
- Lists people scan (the Groups page) are one compact row per item on phones (tile, name, balance, 12px padding) so five or more fit; from `sm` up they become cards.
- Titles that can be any length (a group's name in its header) stop at two lines, with the whole name in `title` and a tap to open it out.

## Accessibility

WCAG AA. Every interactive element reachable by keyboard with a visible focus ring (2px ink, 2px offset). Labels on icon buttons. Amounts announced with currency. Dynamic type friendly (rem everywhere).
