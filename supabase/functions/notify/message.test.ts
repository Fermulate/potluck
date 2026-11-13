// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { localMoment, message, postingDay } from './message.ts'

const row = (type: string, data: Record<string, string | null>) => ({
  id: 'n1',
  user_id: 'u1',
  type,
  data,
})

test('a comment push shows the comment the trigger stored as excerpt', () => {
  const m = message(
    row('comment.created', {
      group_id: 'g1',
      expense_id: 'x1',
      excerpt: 'Who had the extra fries?',
    }),
  )
  assert.equal(m.body, 'Who had the extra fries?')
  assert.equal(m.url, '/expenses/x1')
})

test('a comment on a plan links to the plan, with a fallback line when there is no excerpt', () => {
  const m = message(row('comment.created', { group_id: 'g1', event_id: 'e1' }))
  assert.equal(m.body, 'Someone replied')
  assert.equal(m.url, '/plans/e1')
})

test('other types keep their copy and links', () => {
  assert.deepEqual(message(row('expense.created', { expense_id: 'x1', description: 'Tacos' })), {
    title: 'New expense',
    body: 'Tacos',
    url: '/expenses/x1',
  })
  assert.equal(message(row('settlement.created', { group_id: 'g1' })).url, '/groups/g1/balances')
  assert.equal(message(row('something.new', {})).url, '/notifications')
})

test('deleted and restored expenses and being added to a group', () => {
  assert.deepEqual(message(row('expense.deleted', { expense_id: 'x1', description: 'Gas' })), {
    title: 'Expense deleted',
    body: 'Gas',
    url: '/expenses/x1',
  })
  assert.equal(message(row('expense.restored', { expense_id: 'x1' })).body, 'An expense is back')
  assert.equal(message(row('member.added', { group_id: 'g1' })).url, '/groups/g1')
})

test('a recovery that turned two-step sign in off links to Me', () => {
  const removed = row('account.mfa_removed', {})
  assert.equal(message(removed).title, 'Two-step sign in is off')
  assert.equal(message(removed).url, '/me')
  assert.equal(message(removed, 'de').title, 'Die Anmeldung in zwei Schritten ist aus')
})

test('copy follows the recipient language, English when it is missing or unknown', () => {
  const joined = row('member.joined', { group_id: 'g1' })
  assert.equal(message(joined, 'es').title, 'Nuevo miembro')
  assert.equal(message(joined, 'de').body, 'Jemand ist deiner Gruppe beigetreten.')
  assert.equal(message(joined, 'pt-BR').title, 'Novo membro')
  assert.equal(message(row('event.created', { event_id: 'e1' }), 'fr').body, 'Un plan se prépare')
  assert.equal(message(joined, 'xx').title, 'New member')
  assert.equal(message(joined, null).title, 'New member')
  // What people typed stays as they typed it.
  const tacos = row('expense.created', { expense_id: 'x1', description: 'Tacos' })
  assert.equal(message(tacos, 'fr').body, 'Tacos')
  assert.equal(message(tacos, 'fr').title, 'Nouvelle dépense')
})

test('payment pushes open the payment, and a comment on one does too', () => {
  for (const type of [
    'settlement.created',
    'settlement.updated',
    'settlement.deleted',
    'settlement.restored',
  ]) {
    assert.equal(message(row(type, { group_id: 'g1', settlement_id: 's1' })).url, '/payments/s1')
  }
  assert.equal(message(row('settlement.deleted', {}), 'es').title, 'Pago eliminado')
  assert.equal(
    message(row('comment.created', { group_id: 'g1', settlement_id: 's1' })).url,
    '/payments/s1',
  )
})

test('a reminder opens settle up with the person owed picked, and shows their note', () => {
  const m = message(row('debt.reminder', { group_id: 'g1', from_user: 'u2' }))
  assert.equal(m.title, 'A friendly nudge')
  assert.equal(m.url, '/new/settle?groupId=g1&to=u2')
  assert.equal(message(row('debt.reminder', {})).url, '/home')
  assert.equal(
    message(row('debt.reminder', {}), 'pt').body,
    'Alguém está esperando um pagamento seu.',
  )
  assert.equal(message(row('debt.reminder', { note: 'Rent is due' }), 'fr').body, 'Rent is due')
})

test("a repeating expense heads-up names the posting date and the deadline in the person's zone", () => {
  const m = message(
    row('recurring.upcoming', {
      recurring_id: 'r1',
      group_id: 'g1',
      description: 'Rent',
      posts_on: '2030-01-10',
      deadline: '2030-01-10T00:10:00+00:00',
      timezone: 'Etc/GMT+12',
    }),
  )
  assert.equal(m.title, 'Rent goes in on Thu, Jan 10')
  // 00:10 UTC is lunchtime the day before at UTC-12.
  assert.equal(m.body, 'Skip or change it before Wed, Jan 9, 12:10 PM.')
  assert.equal(m.url, '/recurring/r1')
  const bare = message(row('recurring.upcoming', { group_id: 'g1' }))
  assert.equal(bare.url, '/groups/g1')
  assert.equal(bare.title, 'A repeating expense goes in soon')
  assert.equal(bare.body, 'Skip or change it before it goes in.')
  assert.equal(localMoment('2030-01-10T00:10:00Z', 'Not/AZone'), 'Thu, Jan 10, 12:10 AM')
  assert.equal(postingDay('soon'), 'soon')
})

test('a repeating expense heads-up speaks the reader’s language', () => {
  const m = message(
    row('recurring.upcoming', {
      recurring_id: 'r1',
      description: 'Alquiler',
      posts_on: '2030-01-10',
      deadline: '2030-01-10T00:10:00+00:00',
      timezone: 'Europe/Madrid',
    }),
    'es',
  )
  assert.match(m.title, /^Alquiler se añade el /)
  assert.match(m.body, /^Sáltalo o cámbialo antes del /)
})

test('a repeating expense paused because someone left opens it', () => {
  const m = message(row('recurring.paused', { recurring_id: 'r1', description: 'Internet' }))
  assert.equal(m.title, '"Internet" is paused')
  assert.equal(m.url, '/recurring/r1')
})

test('a saved seat opens its claim link, a new friend their page', () => {
  assert.equal(
    message(row('member.added', { group_id: 'g1', claim_code: 'abc_DEF-123' })).url,
    '/join/abc_DEF-123',
  )
  assert.equal(message(row('friend.added', { user_id: 'u2' })).url, '/friends/u2')
  assert.equal(message(row('friend.added', {})).url, '/friends')
  assert.equal(message(row('friend.added', { user_id: 'u2' }), 'es').title, 'Nuevo amigo')
})
