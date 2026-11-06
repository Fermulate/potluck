// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { message } from './message.ts'

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
