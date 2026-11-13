// Run with `pnpm test:functions` (Node's test runner; the module has no Deno imports).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { escapeText, fold, liveGroupIds } from './ics.ts'

const octets = (s: string) => new TextEncoder().encode(s).length

test('escapes backslashes, separators and every kind of line break', () => {
  assert.equal(escapeText('a\\b, c; d'), 'a\\\\b\\, c\\; d')
  assert.equal(escapeText('one\ntwo'), 'one\\ntwo')
  assert.equal(escapeText('one\r\ntwo'), 'one\\ntwo')
  assert.equal(escapeText('one\rtwo'), 'one\\ntwo')
  // A bare CR must never reach the feed: it would end the content line.
  assert.ok(!escapeText('a\rb\r\nc').includes('\r'))
})

test('leaves short lines alone', () => {
  assert.equal(fold('SUMMARY:Tacos'), 'SUMMARY:Tacos')
  assert.equal(fold('X'.repeat(75)), 'X'.repeat(75))
})

test('folds long ASCII lines at 75 octets', () => {
  const folded = fold('DESCRIPTION:' + 'a'.repeat(200))
  const lines = folded.split('\r\n')
  assert.ok(lines.length > 2)
  for (const line of lines) assert.ok(octets(line) <= 75, `${octets(line)} octets`)
  assert.equal(folded.replace(/\r\n /g, ''), 'DESCRIPTION:' + 'a'.repeat(200))
})

test('folds multi-byte text by octets without splitting a character', () => {
  // Each of these is 2 to 4 bytes in UTF-8; counting UTF-16 units would overrun 75 octets.
  const text = 'SUMMARY:' + 'Café 🍕 Zürich 東京 '.repeat(20)
  const folded = fold(text)
  const lines = folded.split('\r\n')
  for (const line of lines) {
    assert.ok(octets(line) <= 75, `${octets(line)} octets`)
    assert.ok(!line.includes('�'))
    // No lone surrogate halves at the edges.
    assert.ok(!/^ ?[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(line))
  }
  assert.equal(folded.replace(/\r\n /g, ''), text)
})

test('leaves deleted groups out of the feed', () => {
  assert.deepEqual(
    liveGroupIds([
      { group_id: 'live', groups: { deleted_at: null } },
      { group_id: 'deleted', groups: { deleted_at: '2026-11-13T10:00:00Z' } },
      { group_id: 'listed', groups: [{ deleted_at: null }] },
      { group_id: 'unreadable', groups: null },
    ]),
    ['live', 'listed'],
  )
})
