// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { escapeHtml, formatMoney, renderEmail, type EmailJob } from './email.ts'

const links = {
  appUrl: 'https://potluck.example',
  oneClickUrl: 'https://db.example/functions/v1/unsubscribe',
}

const job = (type: string, data: EmailJob['data'], extra: Partial<EmailJob> = {}): EmailJob => ({
  id: 'n1',
  type,
  category: 'expense_added',
  to: 'ben@example.com',
  name: 'Ben Okafor',
  timezone: 'America/New_York',
  unsubscribe: 'u1.expense_added.sig',
  unsubscribe_all: 'u1.all.sig2',
  data,
  ...extra,
})

test('a new expense names who added it, the total, your share, and links to it', () => {
  const e = renderEmail(
    job('expense.created', {
      expense_id: 'x1',
      group_id: 'g1',
      group_name: 'Roommates',
      actor_name: 'Ava',
      description: 'Groceries',
      amount_cents: 6000,
      currency: 'USD',
      share_cents: 2000,
    }),
    links,
  )
  assert.equal(e.subject, 'Ava added "Groceries" in Roommates')
  assert.match(e.text, /^Hi Ben,/)
  assert.match(e.text, /Total: \$60\.00\./)
  assert.match(e.text, /Your share: \$20\.00\./)
  assert.match(e.text, /https:\/\/potluck\.example\/expenses\/x1/)
  assert.match(e.html, /href="https:\/\/potluck\.example\/expenses\/x1"/)
})

test('a refund tells each person what they get back, not a share they owe', () => {
  const data = {
    expense_id: 'x1',
    actor_name: 'Ava',
    description: 'Refund',
    amount_cents: 4000,
    currency: 'USD',
    share_cents: 2000,
    is_refund: true,
  }
  for (const type of ['expense.created', 'expense.updated', 'expense.restored']) {
    const e = renderEmail(job(type, data), links)
    assert.match(e.text, /You get back: \$20\.00\./, type)
    assert.doesNotMatch(e.text, /Your share/, type)
  }
})

test('every email carries one-click unsubscribe headers and footer links for its type and for all', () => {
  const e = renderEmail(job('expense.created', { expense_id: 'x1' }), links)
  assert.equal(e.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
  assert.equal(
    e.headers['List-Unsubscribe'],
    '<https://db.example/functions/v1/unsubscribe?token=u1.expense_added.sig>, <https://potluck.example/unsubscribe?token=u1.expense_added.sig>',
  )
  assert.match(
    e.text,
    /Stop emails about new expenses: https:\/\/potluck\.example\/unsubscribe\?token=u1\.expense_added\.sig/,
  )
  assert.match(
    e.text,
    /Stop all Potluck email: https:\/\/potluck\.example\/unsubscribe\?token=u1\.all\.sig2/,
  )
  assert.match(e.html, /unsubscribe\?token=u1\.all\.sig2/)
  assert.match(e.text, /https:\/\/potluck\.example\/me/)
})

test('deleted and restored expenses, payments and being added to a group read naturally', () => {
  const base = { group_name: 'Hike crew', actor_name: 'Cleo', group_id: 'g1', expense_id: 'x1' }
  assert.equal(
    renderEmail(
      job('expense.deleted', { ...base, description: 'Gas', amount_cents: 4200, currency: 'EUR' }),
      links,
    ).subject,
    'Cleo deleted "Gas" in Hike crew',
  )
  assert.match(
    renderEmail(
      job('expense.deleted', { ...base, description: 'Gas', amount_cents: 4200, currency: 'EUR' }),
      links,
    ).text,
    /it was €42\.00/,
  )
  assert.equal(
    renderEmail(job('expense.restored', { ...base, description: 'Gas' }), links).subject,
    'Cleo restored "Gas" in Hike crew',
  )
  const paid = renderEmail(
    job(
      'settlement.created',
      { ...base, amount_cents: 1500, currency: 'USD' },
      { category: 'payments' },
    ),
    links,
  )
  assert.equal(paid.subject, 'Cleo recorded a payment in Hike crew')
  assert.match(paid.text, /https:\/\/potluck\.example\/groups\/g1\/balances/)
  assert.match(paid.text, /emails about payments are on/)
  assert.equal(
    renderEmail(
      job('member.added', { group_name: 'Book club', actor_name: 'Dev', group_id: 'g2' }),
      links,
    ).subject,
    'Dev added you to Book club',
  )
})

test('a recovery code sign in is reported and links to Me', () => {
  const e = renderEmail(job('account.mfa_removed', {}, { category: 'security' }), links)
  assert.equal(e.subject, 'Two-step sign in was turned off')
  assert.match(e.text, /Not you\? Change your password now/)
  assert.match(e.text, /Open Me: https:\/\/potluck\.example\/me/)
})

test('security emails cannot be unsubscribed from: no links, no headers, a word on why', () => {
  const e = renderEmail(
    job('account.mfa_removed', {}, { category: 'security', unsubscribe: 'u1.security.sig' }),
    links,
  )
  assert.deepEqual(e.headers, {})
  for (const body of [e.text, e.html]) {
    assert.doesNotMatch(body, /unsubscribe/i)
    assert.doesNotMatch(body, /Stop (all Potluck )?email/)
    assert.match(body, /We always send this: it is about the security of your Potluck account\./)
    assert.match(body, /https:\/\/potluck\.example\/me/)
  }
  // Every other category keeps its links and one-click header.
  const other = renderEmail(job('expense.created', { expense_id: 'x1' }), links)
  assert.match(other.headers['List-Unsubscribe'] ?? '', /u1\.expense_added\.sig/)
  assert.match(other.text, /Stop all Potluck email/)
})

test("plan times are shown in the reader's time zone", () => {
  const e = renderEmail(
    job(
      'event.scheduled',
      { event_id: 'e1', event_title: 'Taco night', starts_at: '2026-12-04T23:30:00Z' },
      { category: 'plans' },
    ),
    links,
  )
  assert.equal(e.subject, "It's a date: Taco night")
  assert.match(e.text, /Friday, December 4.*6:30\s?PM EST/)
  assert.match(e.text, /\/plans\/e1/)
})

test('the monthly summary lists each group balance in its own currency', () => {
  const e = renderEmail(
    job(
      'summary.monthly',
      {
        month: '2026-10-01',
        groups: [
          { name: 'Roommates', currency: 'USD', net_cents: 1250, expenses: 3, payments: 1 },
          { name: 'Tokyo trip', currency: 'JPY', net_cents: -4500, expenses: 1, payments: 0 },
          { name: 'Book club', currency: 'EUR', net_cents: 0, expenses: 0, payments: 1 },
        ],
      },
      { category: 'monthly_summary' },
    ),
    links,
  )
  assert.equal(e.subject, 'Your Potluck October 2026')
  assert.match(e.text, /Roommates: you are owed \$12\.50/)
  assert.match(e.text, /Tokyo trip: you owe ¥4,500/)
  assert.match(e.text, /Book club: all settled up/)
  assert.match(e.text, /4 new expenses and 2 payments involved you/)
  assert.match(e.text, /https:\/\/potluck\.example\/home/)
  assert.match(e.text, /emails about the monthly summary are on/)
})

test('names and descriptions are escaped in the HTML', () => {
  const e = renderEmail(
    job('expense.created', { actor_name: '<b>Eve</b>', description: 'Fish & "chips"' }),
    links,
  )
  assert.ok(!e.html.includes('<b>Eve</b>'))
  assert.match(e.html, /&lt;b&gt;Eve&lt;\/b&gt; added &quot;Fish &amp; &quot;chips&quot;&quot;/)
  assert.equal(escapeHtml(`'`), '&#39;')
})

test('unknown types fall back to a generic email, and a missing name to a plain greeting', () => {
  const e = renderEmail(job('something.new', {}, { name: null, category: 'reminders' }), links)
  assert.equal(e.subject, 'Something new in Potluck')
  assert.match(e.text, /^Hi,/)
  assert.match(e.text, /emails about reminders are on/)
})

test('payment edits, deletions, restores and debt reminders from settle up have their own copy', () => {
  const data = { actor_name: 'Ben', group_name: 'Flat', amount_cents: 2500, currency: 'USD' }
  const payments = { category: 'payments' }
  assert.equal(
    renderEmail(job('settlement.updated', data, payments), links).subject,
    'Ben changed a payment in Flat',
  )
  assert.match(
    renderEmail(job('settlement.deleted', data, payments), links).text,
    /Ben deleted a payment of \$25\.00 in Flat\./,
  )
  assert.equal(
    renderEmail(job('settlement.restored', data, payments), links).subject,
    'Ben restored a payment in Flat',
  )
  const nudge = renderEmail(job('debt.reminder', data, { category: 'reminders' }), links)
  assert.equal(nudge.subject, 'Ben sent you a reminder')
  assert.match(nudge.text, /Ben is waiting on \$25\.00 in Flat\./)
  const withNote = renderEmail(
    job('debt.reminder', { ...data, note: 'Rent is due Friday' }, { category: 'reminders' }),
    links,
  )
  assert.match(withNote.text, /"Rent is due Friday"/)
})

test('money keeps every minor digit for 0, 2 and 3 digit currencies', () => {
  assert.equal(formatMoney(123456, 'USD'), '$1,234.56')
  assert.equal(formatMoney(5, 'USD'), '$0.05')
  assert.equal(formatMoney(-500, 'USD'), '-$5.00')
  assert.equal(formatMoney(1500, 'JPY'), '¥1,500')
  assert.equal(formatMoney(1250, 'BHD'), 'BHD 1.250')
  assert.equal(formatMoney(100, 'NOPE'), '100 NOPE')
})

test('a repeating expense heads-up says the date it goes in, until when it can change, and links to it', () => {
  const e = renderEmail(
    job(
      'recurring.upcoming',
      {
        recurring_id: 'r1',
        group_id: 'g1',
        group_name: 'Flat',
        description: 'Rent',
        amount_cents: 150000,
        currency: 'USD',
        share_cents: 50000,
        posts_on: '2026-12-01',
        deadline: '2026-12-01T00:10:00+00:00',
      },
      { category: 'reminders' },
    ),
    links,
  )
  assert.equal(e.subject, '"Rent" goes in on Tue, Dec 1 in Flat')
  // America/New_York: 00:10 UTC on the 1st is the evening of November 30.
  assert.match(e.text, /You can until Monday, November 30 at 7:10 PM EST\./)
  assert.match(e.text, /Total: \$1,500\.00\./)
  assert.match(e.text, /Your share: \$500\.00\./)
  assert.match(e.text, /https:\/\/potluck\.example\/recurring\/r1/)
  assert.match(e.text, /reminders/)
})

test('a repeating expense the job paused says why', () => {
  const e = renderEmail(
    job(
      'recurring.paused',
      { recurring_id: 'r1', group_name: 'Flat', description: 'Internet' },
      {
        category: 'expense_changed',
      },
    ),
    links,
  )
  assert.equal(e.subject, '"Internet" is paused in Flat')
  assert.match(e.text, /Someone in it left the group/)
})

test('someone not on Potluck yet gets their claim link, and the one reminder says so', () => {
  const data = {
    group_id: 'g1',
    group_name: 'Roommates',
    actor_name: 'Ava',
    placeholder: true,
    claim_code: 'seat-code-123',
  }
  const invite = renderEmail(job('member.added', data, { category: 'groups', name: 'Sam' }), links)
  assert.equal(invite.subject, 'Ava added you to Roommates on Potluck')
  assert.match(invite.text, /^Hi Sam,/)
  assert.match(invite.text, /Take your seat: https:\/\/potluck\.example\/join\/seat-code-123/)
  assert.match(invite.html, /href="https:\/\/potluck\.example\/join\/seat-code-123"/)

  const reminder = renderEmail(
    job('member.added', { ...data, reminder: true }, { category: 'groups' }),
    links,
  )
  assert.equal(reminder.subject, 'Reminder: Ava saved you a seat in Roommates')
})

test('a member added by someone else is sent to the group', () => {
  const e = renderEmail(
    job(
      'member.added',
      { group_id: 'g1', group_name: 'Roommates', actor_name: 'Ava' },
      { category: 'groups' },
    ),
    links,
  )
  assert.equal(e.subject, 'Ava added you to Roommates')
  assert.match(e.text, /https:\/\/potluck\.example\/groups\/g1/)
})

test('an accepted friend link opens the new friend', () => {
  const e = renderEmail(
    job('friend.added', { user_id: 'u2', actor_name: 'Cleo' }, { category: 'groups' }),
    links,
  )
  assert.equal(e.subject, 'Cleo is now your friend on Potluck')
  assert.match(e.text, /https:\/\/potluck\.example\/friends\/u2/)
})

test('a changed seat invite tells whoever added the seat and opens the members page', () => {
  const e = renderEmail(
    job(
      'member.invite_changed',
      { group_id: 'g1', group_name: 'Roommates', user_id: 'p1', actor_name: 'Ava' },
      { category: 'groups' },
    ),
    links,
  )
  assert.equal(e.subject, 'Ava changed an invite in Roommates')
  assert.match(e.text, /new address/)
  assert.match(e.text, /https:\/\/potluck\.example\/groups\/g1\/members/)
})
