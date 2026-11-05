# Dogfooding findings

We used Potluck the way real people would, with fresh accounts on a local stack, at 390x844 and 1440x900, in light and dark. This file lists what got in the way and what we did about it. "Before" screenshots live in [`before/`](before/). The fixed screens are in the user guide repo, [Fermulate/potluck-docs](https://github.com/Fermulate/potluck-docs).

## The people

1. **Noor, brand new.** Gets an invite link from a friend, signs up from the invite page, fills in a profile, joins.
2. **Maya, the organizer.** Signs up, starts "Supper club", invites five friends, plans a dinner for six, paints her times, watches the heatmap fill in, locks in Saturday, then splits the bill by item with tax and an 18% tip.
3. **Ravi and Sam, roommates.** Group in USD. Rent is paid in EUR every month, so it is a repeating expense in a second currency.
4. **Noor again, owing money.** Sees what she owes on Home, opens the group's balances, settles up with Maya.
5. **Maya as admin.** Makes Noor an admin, tries to remove someone, checks group settings.

## Severity

- **High**: wrong information, or a person gets stuck or lost.
- **Medium**: extra taps, something hard to find, or a layout that breaks at one size.
- **Low**: polish: copy, spacing, consistency.

## Findings

| #   | Finding                                                                                                                                                                                                                          | Severity | Before                                                                | Fix                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------- | -------------------- |
| 1   | On a plan you have not answered yet, hovering (or scrolling past) the Best times card swapped your painter for the group heatmap and never switched back. On desktop it happened just by having the mouse over the right column. | High     | [02](before/02-painter-flips-to-heatmap.png)                          | `9339d93`            |
| 2   | Anyone with no debts saw "You owe -$0.00" on the Home balance. Negating a zero balance produced negative zero, which Intl formats with a minus.                                                                                  | High     | [01](before/01-zero-balance-minus.png)                                | `73f607e`            |
| 3   | Inviting people took three decisions (role, uses, expiry) before you could get a link. Most people want the default link right away.                                                                                             | High     | [03](before/03-invite-sheet-three-choices.png)                        | `18947eb`            |
| 4   | "Add an expense for this plan" saved and then dropped you on the group page. The plan page never showed the expense, so it looked like it went nowhere.                                                                          | High     | [04](before/04-plan-expense-lands-on-group.png)                       | `63015f0`            |
| 5   | On phones, Shares and By item were scrolled off the end of the split mode switcher with no hint. By item is the only mode with tax and tip.                                                                                      | High     | [07](before/07-split-modes-hidden.png)                                | `3769ec7`            |
| 6   | Group tabs: Settings (and often Members) sat off screen on phones with no hint, and the Expenses tab was announced as the current page on every tab (the router marks parent links active).                                      | Medium   | [13](before/13-tabs-overflow-settings-hidden.png)                     | `502cb8d`            |
| 7   | A brand new group opened on Members with only you in it, two separate invite buttons, and Leave group as the loudest thing on the page.                                                                                          | Medium   | [06](before/06-new-group-alone.png)                                   | `90ab000`            |
| 8   | Tip could only be typed as an amount. People think in percent.                                                                                                                                                                   | Medium   |                                                                       | `cafcf3c`            |
| 9   | Plan rows on Plans and Home: the group name on the right squeezed the plan's own title to "Dinner a..." on a phone.                                                                                                              | Medium   | [05](before/05-plan-titles-truncated.png)                             | `c477058`            |
| 10  | Dark mode: the ink avatar color is the same as the dark page, so about one in eight people showed up as a floating pair of initials.                                                                                             | Medium   | [08](before/08-dark-ink-avatars.png)                                  | `d3cfeb4`            |
| 11  | Desktop forms were stretched phones: Plan something was one narrow column in a wide window, and Me was a single long column.                                                                                                     | Medium   | [09](before/09-plan-form-desktop.png), [10](before/10-me-desktop.png) | `0965112`, `1248c66` |
| 12  | Notifications said "All caught up" while the list was still loading (and you had six unread).                                                                                                                                    | Medium   | [11](before/11-notifications-loading.png)                             | `8172256`            |
| 13  | Desktop toasts dropped from the top center, right over the group tabs and page titles.                                                                                                                                           | Low      | [12](before/12-toast-over-tabs.png)                                   | `283ae4b`            |
| 14  | "Expense saved." did not say which expense or what it meant for you.                                                                                                                                                             | Low      |                                                                       | `d3d6d68`            |
| 15  | Group header balance read as a fragment: "settled up", "you are owed $12".                                                                                                                                                       | Low      | [06](before/06-new-group-alone.png)                                   | `d55636e`            |
| 16  | Home "Needs you": a single card took 60% of the row on a phone, leaving an odd gap.                                                                                                                                              | Low      | [01](before/01-zero-balance-minus.png)                                | `fff8a0c`            |
| 17  | The repeating expenses header said "1/1", which reads like a page count.                                                                                                                                                         | Low      |                                                                       | `49943e7`            |
| 18  | Nav highlight was wrong on some pages: an expense lit Home, New plan lit Home.                                                                                                                                                   | Low      |                                                                       | `c9584c5`, `9de0816` |
| 19  | Balances: "Who pays whom" listed other people's debts before your own.                                                                                                                                                           | Low      |                                                                       | `5cf81a3`            |
| 20  | By item: your own chip sat in the middle of the list, and on selected (ink) chips the ink avatar had no edge.                                                                                                                    | Low      |                                                                       | `cafcf3c`            |
| 21  | The group name placeholder ("Lisbon trip, Flat 4B, Taco Tuesdays...") was cut off on a phone.                                                                                                                                    | Low      |                                                                       | `eb216b2`            |
| 22  | Plan form: the Grid size switcher spilled out of its cell on desktop.                                                                                                                                                            | Low      | [09](before/09-plan-form-desktop.png)                                 | `0965112`            |
| 23  | On a phone, a poll with a few runners up pushed the painter below the fold, so someone who still owed their times scrolled past four "Pick this one" buttons first.                                                              | Medium   |                                                                       | `c8d7099`            |

## Signature moments, checked

| Moment             | Verdict                                                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Settle up confetti | Works. Amount ticks to $0.00, confetti lands around 900ms in, palette colors.                                                              |
| Live heatmap       | Works. A friend painting from another session warmed the cells within about a second, no reload.                                           |
| Painter            | Works with mouse drag and keyboard. Was being swapped out by hover on desktop (finding 1).                                                 |
| Split slider       | Works, total stays at 100%. The mode switcher hid two modes on phones (finding 5).                                                         |
| Lock-in stamp      | Works. Confirm dialog, then the stamp lands on the timeline.                                                                               |
| Invite page        | Works, one tap to join for a signed-in person. The sheet that makes the link was the slow part (finding 3).                                |
| Loading states     | With the API slowed to 700ms, every main screen shows a skeleton at 350ms. The only wrong state was the Notifications header (finding 12). |
| Focus order        | Tab order on Home goes skip link, rail, Add, nav, profile, then content, with a 2px ring on each.                                          |

## Seen, not changed

- **Avatar colors on the invite page** do not match the rest of the app for the same person. `invite_preview` only returns first names (on purpose, the page is public), so the page seeds colors from names. Matching would need an RPC change.
- **The organizer is "No reply" right after locking in.** Auto-RSVPing them would change behavior around RSVP notifications; left as is.
- **A new person who signs up from an invite still taps Join after the profile step.** That tap is the "one-tap join" moment and makes the choice explicit.
- **Expense rows in another currency** show the expense currency (EUR) while the group header shows the converted USD total. The detail page explains the conversion.
- **Location shows twice** on a scheduled plan on phones (hero and details card).
- **The painter does not auto-scroll** while you drag past the bottom of the screen on a long day.
