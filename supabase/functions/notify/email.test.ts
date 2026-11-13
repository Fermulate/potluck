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
  const e = renderEmail(job('debt.reminder', {}, { name: null, category: 'reminders' }), links)
  assert.equal(e.subject, 'Something new in Potluck')
  assert.match(e.text, /^Hi,/)
  assert.match(e.text, /emails about reminders are on/)
})

test('money keeps every minor digit for 0, 2 and 3 digit currencies', () => {
  assert.equal(formatMoney(123456, 'USD'), '$1,234.56')
  assert.equal(formatMoney(5, 'USD'), '$0.05')
  assert.equal(formatMoney(-500, 'USD'), '-$5.00')
  assert.equal(formatMoney(1500, 'JPY'), '¥1,500')
  assert.equal(formatMoney(1250, 'BHD'), 'BHD 1.250')
  assert.equal(formatMoney(100, 'NOPE'), '100 NOPE')
})
